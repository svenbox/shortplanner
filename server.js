"use strict";
const express = require("express");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const { db, sessionSecret, getSiteConfig, setSiteConfig, DATA_DIR } = require("./db");

const PORT = parseInt(process.env.PORT || "3000", 10);
const PASSWORD = process.env.APP_PASSWORD || "";
const SESSION_DAYS = parseInt(process.env.SESSION_DAYS || "30", 10);
const COOKIE = "sp_session";

/* Build-id: en hash av de statiska tillgångarna. Ändras vid varje ombyggnad
   som rör client-koden, så en flik som stått öppen kan upptäcka att den kör
   en gammal version (X-App-Version-headern + GET /api/version) och erbjuda
   omladdning. Överstyrs med BUILD_ID i miljön om man hellre vill ha t.ex.
   en git-sha. */
function computeBuildId() {
  try {
    const dir = path.join(__dirname, "public");
    const files = [
      "index.html", "view.html", "sw.js", "manifest.json", "css/app.css",
      "js/app.js", "js/view.js", "js/stripboard.js", "js/callsheet.js", "js/script.js", "js/dpr.js",
      "js/vendor/qrcode-generator.js", "js/vendor/pdf.min.js"
    ];
    const h = crypto.createHash("sha1");
    for (const f of files) {
      try { h.update(f + "\0"); h.update(fs.readFileSync(path.join(dir, f))); } catch (_) { /* saknas -> hoppa */ }
    }
    return h.digest("hex").slice(0, 12);
  } catch (_) {
    return String(Date.now());
  }
}
const BUILD_ID = process.env.BUILD_ID || computeBuildId();

if (!PASSWORD) {
  console.error("FEL: APP_PASSWORD är inte satt. Sätt den i .env och starta om.");
  process.exit(1);
}
if (PASSWORD.length < 8) {
  console.warn("VARNING: APP_PASSWORD är kortare än 8 tecken.");
}

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", true);
app.use(express.json({ limit: "8mb" }));

/* Hela appen är privat (lösenordsskyddad, eller delad via ett hemligt
   token-baserat share-läge) -- inget ska någonsin dyka upp i en
   sökmotor. HTTP-headern är ett komplement till <meta name="robots">-
   taggarna i index.html/view.html, inte en ersättning: den fångar även
   robotar/scanners som inte kör JS eller inte bryr sig om att parsa
   HTML-huvudet. */
app.use((req, res, next) => {
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive, nosnippet");
  res.setHeader("X-App-Version", BUILD_ID);
  next();
});

/* ---------- hjälpare ---------- */
const now = () => new Date().toISOString();
const b64u = (b) => Buffer.from(b).toString("base64url");

function sign(payload) {
  const body = b64u(JSON.stringify(payload));
  const mac = crypto.createHmac("sha256", sessionSecret()).update(body).digest("base64url");
  return body + "." + mac;
}
function verify(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const [body, mac] = token.split(".");
  const expect = crypto.createHmac("sha256", sessionSecret()).update(body).digest("base64url");
  const a = Buffer.from(mac || "");
  const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString());
    if (!p.exp || p.exp < Date.now()) return null;
    return p;
  } catch { return null; }
}
function readCookie(req, name) {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}
function secureCookie(req) {
  return req.secure || req.headers["x-forwarded-proto"] === "https";
}
function equalConst(a, b) {
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/* enkel bruteforce-broms per IP */
const attempts = new Map();
function throttled(ip) {
  const rec = attempts.get(ip);
  if (!rec) return false;
  if (Date.now() - rec.first > 15 * 60 * 1000) { attempts.delete(ip); return false; }
  return rec.n >= 10;
}
function noteFail(ip) {
  const rec = attempts.get(ip);
  if (!rec || Date.now() - rec.first > 15 * 60 * 1000) attempts.set(ip, { n: 1, first: Date.now() });
  else rec.n++;
}

function auth(req, res, next) {
  if (verify(readCookie(req, COOKIE))) return next();
  res.status(401).json({ error: "Ej inloggad" });
}

/* ---------- startdata ---------- */
const EMPTY_STRIPBOARD = () => ({
  production: { film: "", version: "", producent: "", regi: "" },
  cast: [],
  days: [{ label: "Dag 1", date: "", start: "08:00", strips: [] }],
  unscheduled: []
});
const EMPTY_CALLSHEET = () => ({
  production: { film: "", producent: "", producent_tel: "", regi: "", foto: "", ad: "", platschef: "" },
  days: []
});
const EMPTY_SCRIPT = () => ({
  id: null, projectId: null, title: "", draft: "", draftDate: "",
  source: null, importedAt: null, scenes: []
});
const EMPTY_DPR = () => ({ id: null, projectId: null, days: [] });
const EMPTY_META = () => ({ title: "", company: "", producer: "", producerPhone: "", director: "", dop: "", firstAD: "", locationManager: "", shootStart: "", shootEnd: "", format: "", aspectRatio: "" });

/* ---------- auth-endpoints ---------- */
app.post("/api/login", (req, res) => {
  const ip = req.ip || "?";
  if (throttled(ip)) return res.status(429).json({ error: "För många försök. Vänta 15 minuter." });
  const pw = (req.body && req.body.password) || "";
  if (!equalConst(pw, PASSWORD)) {
    noteFail(ip);
    return res.status(401).json({ error: "Fel lösenord" });
  }
  attempts.delete(ip);
  const token = sign({ exp: Date.now() + SESSION_DAYS * 864e5 });
  res.setHeader("Set-Cookie",
    `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}` +
    (secureCookie(req) ? "; Secure" : ""));
  res.json({ ok: true });
});

app.post("/api/logout", (req, res) => {
  res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  res.json({ ok: true });
});

app.get("/api/me", (req, res) => {
  res.json({ authed: !!verify(readCookie(req, COOKIE)) });
});

/* Versionskoll. Klienten hämtar den vid start och pollar vid fokus / online /
   var 10:e min. Ingen auth -- även den publika share-vyn behöver den, och den
   läcker inget. `disabled` är nödbroms för service workern (SW_DISABLED=1 i
   miljön -> SW:n avregistrerar sig själv). */
app.get("/api/version", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ version: BUILD_ID, disabled: process.env.SW_DISABLED === "1" });
});

/* ---------- sajtinställningar ---------- */
const LOGO_EXTS = ["png", "jpg", "svg", "webp"];
function logoFile() {
  const c = getSiteConfig();
  return c.logo && c.logo.ext ? path.join(DATA_DIR, "logo." + c.logo.ext) : null;
}

app.get("/api/site", auth, (req, res) => res.json(getSiteConfig()));
app.put("/api/site", auth, (req, res) => res.json(setSiteConfig(req.body || {})));

/* Publik delmängd -- inloggningssidan och share-vyn hämtar den utan auth.
   Bara det som ändå syns publikt (namn/webb/logga/aktiva flikar/språk). */
app.get("/api/site/public", (req, res) => {
  const c = getSiteConfig();
  res.json({
    company: { name: c.company.name, website: c.company.website },
    hasLogo: !!(c.logo && c.logo.ext),
    features: c.features,
    locale: c.locale
  });
});

app.post("/api/site/logo", auth, (req, res) => {
  const dataUrl = String((req.body && req.body.dataUrl) || "");
  const m = dataUrl.match(/^data:image\/(png|jpeg|jpg|svg\+xml|webp);base64,(.+)$/);
  if (!m) return res.status(400).json({ error: "Skicka bilden som data-URL (png/jpg/svg/webp)" });
  const ext = m[1] === "jpeg" ? "jpg" : m[1] === "svg+xml" ? "svg" : m[1];
  const buf = Buffer.from(m[2], "base64");
  if (!buf.length) return res.status(400).json({ error: "Tom bild" });
  if (buf.length > 2 * 1024 * 1024) return res.status(413).json({ error: "Loggan är för stor (max 2 MB)" });
  LOGO_EXTS.forEach(e => { if (e !== ext) { try { fs.unlinkSync(path.join(DATA_DIR, "logo." + e)); } catch (_) {} } });
  fs.writeFileSync(path.join(DATA_DIR, "logo." + ext), buf);
  res.json(setSiteConfig({ logo: { ext } }));
});

app.delete("/api/site/logo", auth, (req, res) => {
  LOGO_EXTS.forEach(e => { try { fs.unlinkSync(path.join(DATA_DIR, "logo." + e)); } catch (_) {} });
  res.json(setSiteConfig({ logo: null }));
});

app.get("/logo", (req, res) => {
  const p = logoFile();
  if (!p || !fs.existsSync(p)) return res.status(404).end();
  res.setHeader("Cache-Control", "no-cache");
  res.sendFile(p);
});

/* ---------- projekt ---------- */
app.get("/api/projects", auth, (req, res) => {
  const rows = db.prepare(`
    SELECT p.id, p.name, p.created_at, p.updated_at,
           (SELECT COUNT(*) FROM versions v WHERE v.project_id = p.id) AS versions
    FROM projects p ORDER BY p.updated_at DESC`).all();
  res.json(rows.map(r => {
    const sb = getDoc(r.id, "stripboard");
    const days = sb && Array.isArray(sb.days) ? sb.days.length : 0;
    const scenes = sb && Array.isArray(sb.days)
      ? sb.days.reduce((a, d) => a + (d.strips || []).filter(s => s.type === "scene").length, 0) : 0;
    return { ...r, days, scenes };
  }));
});

app.post("/api/projects", auth, (req, res) => {
  const name = String((req.body && req.body.name) || "").trim() || "Nytt projekt";
  const ts = now();
  const info = db.prepare("INSERT INTO projects (name, created_at, updated_at) VALUES (?,?,?)").run(name, ts, ts);
  const id = info.lastInsertRowid;
  const sb = EMPTY_STRIPBOARD(); sb.production.film = name;
  const cs = EMPTY_CALLSHEET(); cs.production.film = name;
  putDoc(id, "stripboard", sb);
  putDoc(id, "callsheet", cs);
  res.json({ id, name });
});

app.patch("/api/projects/:id", auth, (req, res) => {
  const p = db.prepare("SELECT * FROM projects WHERE id = ?").get(req.params.id);
  if (!p) return res.status(404).json({ error: "Finns inte" });
  const name = String((req.body && req.body.name) || p.name).trim() || p.name;
  db.prepare("UPDATE projects SET name = ?, updated_at = ? WHERE id = ?").run(name, now(), p.id);
  res.json({ ok: true });
});

app.delete("/api/projects/:id", auth, (req, res) => {
  db.prepare("DELETE FROM projects WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

app.post("/api/projects/:id/duplicate", auth, (req, res) => {
  const p = db.prepare("SELECT * FROM projects WHERE id = ?").get(req.params.id);
  if (!p) return res.status(404).json({ error: "Finns inte" });
  const ts = now();
  const name = String((req.body && req.body.name) || (p.name + " (kopia)")).trim();
  const id = db.prepare("INSERT INTO projects (name, created_at, updated_at) VALUES (?,?,?)").run(name, ts, ts).lastInsertRowid;
  putDoc(id, "stripboard", getDoc(p.id, "stripboard") || EMPTY_STRIPBOARD());
  putDoc(id, "callsheet", getDoc(p.id, "callsheet") || EMPTY_CALLSHEET());
  const script = getDoc(p.id, "script");
  if (script) putDoc(id, "script", script);
  const dpr = getDoc(p.id, "dpr");
  if (dpr) putDoc(id, "dpr", dpr);
  const meta = getDoc(p.id, "meta");
  if (meta) putDoc(id, "meta", meta);
  res.json({ id, name });
});

/* ---------- delning (skrivskyddad visning) ---------- */
function genShareToken() { return crypto.randomBytes(18).toString("base64url"); }

app.post("/api/projects/:id/share", auth, (req, res) => {
  const p = db.prepare("SELECT * FROM projects WHERE id = ?").get(req.params.id);
  if (!p) return res.status(404).json({ error: "Finns inte" });
  let token = p.share_token;
  if (!token) {
    token = genShareToken();
    db.prepare("UPDATE projects SET share_token = ? WHERE id = ?").run(token, p.id);
  }
  res.json({ token, url: `${req.protocol}://${req.get("host")}/share/${token}` });
});

app.delete("/api/projects/:id/share", auth, (req, res) => {
  db.prepare("UPDATE projects SET share_token = NULL WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

app.get("/api/share/:token", (req, res) => {
  const p = db.prepare("SELECT * FROM projects WHERE share_token = ?").get(req.params.token);
  if (!p) return res.status(404).json({ error: "Länken är ogiltig eller borttagen" });
  const sc = getSiteConfig();
  res.json({
    project: { id: p.id, name: p.name },
    stripboard: getDoc(p.id, "stripboard") || EMPTY_STRIPBOARD(),
    callsheet: getDoc(p.id, "callsheet") || EMPTY_CALLSHEET(),
    script: getDoc(p.id, "script") || EMPTY_SCRIPT(),
    site: { company: { name: sc.company.name }, hasLogo: !!(sc.logo && sc.logo.ext), features: sc.features, locale: sc.locale },
    updatedAt: shareUpdatedAt(p.id)
  });
});

app.get("/api/projects/:id", auth, (req, res) => {
  const p = db.prepare("SELECT * FROM projects WHERE id = ?").get(req.params.id);
  if (!p) return res.status(404).json({ error: "Finns inte" });
  res.json({
    project: p,
    stripboard: getDoc(p.id, "stripboard") || EMPTY_STRIPBOARD(),
    callsheet: getDoc(p.id, "callsheet") || EMPTY_CALLSHEET(),
    script: getDoc(p.id, "script") || EMPTY_SCRIPT(),
    dpr: getDoc(p.id, "dpr") || EMPTY_DPR(),
    meta: getDoc(p.id, "meta") || EMPTY_META(),
    docUpdatedAt: docUpdatedAtMap(p.id),
    versions: listVersions(p.id)
  });
});

app.put("/api/projects/:id/doc/:kind", auth, (req, res) => {
  const kind = req.params.kind;
  if (["stripboard", "callsheet", "script", "dpr", "meta"].indexOf(kind) === -1) return res.status(400).json({ error: "Okänd typ" });
  const p = db.prepare("SELECT id FROM projects WHERE id = ?").get(req.params.id);
  if (!p) return res.status(404).json({ error: "Finns inte" });
  const data = req.body && req.body.data;
  if (!data || typeof data !== "object") return res.status(400).json({ error: "Saknar data" });
  /* Optimistisk låsning: klienten skickar med den updated_at den senast kände
     till för dokumentet. Har en annan enhet hunnit spara emellan stämmer den
     inte -> 409 istället för tyst överskrivning. baseUpdatedAt utelämnas av
     äldre klienter och vid tvingad överskrivning ("Skriv över ändå") -> ingen
     koll då. */
  const base = req.body.baseUpdatedAt;
  if (base) {
    const cur = db.prepare("SELECT updated_at FROM docs WHERE project_id = ? AND kind = ?").get(p.id, kind);
    if (cur && cur.updated_at !== base) {
      return res.status(409).json({ error: "Projektet har ändrats på en annan enhet", code: "conflict", currentUpdatedAt: cur.updated_at });
    }
  }
  const updatedAt = putDoc(p.id, kind, data);
  res.json({ ok: true, saved_at: updatedAt, updatedAt });
});

/* ---------- versioner ---------- */
app.get("/api/projects/:id/versions", auth, (req, res) => res.json(listVersions(req.params.id)));

app.post("/api/projects/:id/versions", auth, (req, res) => {
  const p = db.prepare("SELECT id FROM projects WHERE id = ?").get(req.params.id);
  if (!p) return res.status(404).json({ error: "Finns inte" });
  const label = String((req.body && req.body.label) || "").trim() || ("Version " + (listVersions(p.id).length + 1));
  const note = String((req.body && req.body.note) || "").trim();
  const ts = now();
  const info = db.prepare(`INSERT INTO versions (project_id, label, note, stripboard, callsheet, script, dpr, created_at)
    VALUES (?,?,?,?,?,?,?,?)`).run(
    p.id, label, note,
    JSON.stringify(getDoc(p.id, "stripboard") || EMPTY_STRIPBOARD()),
    JSON.stringify(getDoc(p.id, "callsheet") || EMPTY_CALLSHEET()),
    JSON.stringify(getDoc(p.id, "script") || EMPTY_SCRIPT()),
    JSON.stringify(getDoc(p.id, "dpr") || EMPTY_DPR()),
    ts);
  db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(ts, p.id);
  res.json({ id: info.lastInsertRowid, label, note, created_at: ts });
});

app.get("/api/versions/:vid", auth, (req, res) => {
  const v = db.prepare("SELECT * FROM versions WHERE id = ?").get(req.params.vid);
  if (!v) return res.status(404).json({ error: "Finns inte" });
  res.json({
    ...v,
    stripboard: JSON.parse(v.stripboard),
    callsheet: JSON.parse(v.callsheet),
    script: v.script ? JSON.parse(v.script) : null,
    dpr: v.dpr ? JSON.parse(v.dpr) : null
  });
});

app.post("/api/versions/:vid/restore", auth, (req, res) => {
  const v = db.prepare("SELECT * FROM versions WHERE id = ?").get(req.params.vid);
  if (!v) return res.status(404).json({ error: "Finns inte" });
  /* spara nuvarande arbetsläge först så inget går förlorat */
  const ts = now();
  db.prepare(`INSERT INTO versions (project_id, label, note, stripboard, callsheet, script, dpr, created_at)
    VALUES (?,?,?,?,?,?,?,?)`).run(
    v.project_id, "Före återställning", "Automatiskt sparad innan »" + v.label + "« återställdes",
    JSON.stringify(getDoc(v.project_id, "stripboard") || EMPTY_STRIPBOARD()),
    JSON.stringify(getDoc(v.project_id, "callsheet") || EMPTY_CALLSHEET()),
    JSON.stringify(getDoc(v.project_id, "script") || EMPTY_SCRIPT()),
    JSON.stringify(getDoc(v.project_id, "dpr") || EMPTY_DPR()),
    ts);
  putDoc(v.project_id, "stripboard", JSON.parse(v.stripboard));
  putDoc(v.project_id, "callsheet", JSON.parse(v.callsheet));
  /* Äldre versioner (från innan Manus/DPR frystes) har NULL här -- lämna
     nuvarande Manus/DPR orörda i så fall istället för att nolla dem. */
  if (v.script) putDoc(v.project_id, "script", JSON.parse(v.script));
  if (v.dpr) putDoc(v.project_id, "dpr", JSON.parse(v.dpr));
  res.json({ ok: true });
});

app.patch("/api/versions/:vid", auth, (req, res) => {
  const v = db.prepare("SELECT * FROM versions WHERE id = ?").get(req.params.vid);
  if (!v) return res.status(404).json({ error: "Finns inte" });
  const label = String((req.body && req.body.label) || v.label).trim() || v.label;
  const note = req.body && req.body.note != null ? String(req.body.note) : v.note;
  db.prepare("UPDATE versions SET label = ?, note = ? WHERE id = ?").run(label, note, v.id);
  res.json({ ok: true });
});

app.delete("/api/versions/:vid", auth, (req, res) => {
  db.prepare("DELETE FROM versions WHERE id = ?").run(req.params.vid);
  res.json({ ok: true });
});

/* ---------- export / import ---------- */
app.get("/api/projects/:id/export", auth, (req, res) => {
  const p = db.prepare("SELECT * FROM projects WHERE id = ?").get(req.params.id);
  if (!p) return res.status(404).json({ error: "Finns inte" });
  const payload = {
    format: "shortplanner/project@1",
    name: p.name,
    exported_at: now(),
    stripboard: getDoc(p.id, "stripboard"),
    callsheet: getDoc(p.id, "callsheet"),
    script: getDoc(p.id, "script"),
    dpr: getDoc(p.id, "dpr"),
    meta: getDoc(p.id, "meta"),
    versions: db.prepare("SELECT label, note, stripboard, callsheet, script, dpr, created_at FROM versions WHERE project_id = ? ORDER BY created_at").all(p.id)
      .map(v => ({
        ...v,
        stripboard: JSON.parse(v.stripboard),
        callsheet: JSON.parse(v.callsheet),
        script: v.script ? JSON.parse(v.script) : null,
        dpr: v.dpr ? JSON.parse(v.dpr) : null
      }))
  };
  res.setHeader("Content-Disposition", `attachment; filename="${p.name.replace(/[^\w\-. ]+/g, "_")}.json"`);
  res.json(payload);
});

app.post("/api/projects/import", auth, (req, res) => {
  const b = req.body || {};
  if (!b.stripboard) return res.status(400).json({ error: "Filen saknar stripboard" });
  const ts = now();
  const name = String(b.name || "Importerat projekt").trim();
  const id = db.prepare("INSERT INTO projects (name, created_at, updated_at) VALUES (?,?,?)").run(name, ts, ts).lastInsertRowid;
  putDoc(id, "stripboard", b.stripboard);
  putDoc(id, "callsheet", b.callsheet || EMPTY_CALLSHEET());
  if (b.script) putDoc(id, "script", b.script);
  if (b.dpr) putDoc(id, "dpr", b.dpr);
  if (b.meta) putDoc(id, "meta", b.meta);
  (b.versions || []).forEach(v => {
    db.prepare(`INSERT INTO versions (project_id, label, note, stripboard, callsheet, script, dpr, created_at) VALUES (?,?,?,?,?,?,?,?)`)
      .run(id, String(v.label || "Version"), String(v.note || ""),
        JSON.stringify(v.stripboard || {}), JSON.stringify(v.callsheet || {}),
        v.script ? JSON.stringify(v.script) : null, v.dpr ? JSON.stringify(v.dpr) : null,
        String(v.created_at || ts));
  });
  res.json({ id, name });
});

/* ---------- doc-hjälpare ---------- */
function getDoc(projectId, kind) {
  const r = db.prepare("SELECT data FROM docs WHERE project_id = ? AND kind = ?").get(projectId, kind);
  if (!r) return null;
  try { return JSON.parse(r.data); } catch { return null; }
}
function putDoc(projectId, kind, obj) {
  const ts = now();
  db.prepare(`INSERT INTO docs (project_id, kind, data, updated_at) VALUES (?,?,?,?)
    ON CONFLICT(project_id, kind) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`)
    .run(projectId, kind, JSON.stringify(obj), ts);
  db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(ts, projectId);
  return ts;
}
/* Per-dokument updated_at -- klienten får den vid projektöppning och skickar
   tillbaka den vid varje spar, så servern kan upptäcka att en annan enhet
   hunnit spara samma dokument emellan (optimistisk låsning i PUT .../doc/:kind). */
/* Senaste ändringstidpunkten över alla dokument i projektet -- share-vyn
   pollar den för att veta om den behöver hämta om datat (ISO-strängar
   sorteras lexikalt = kronologiskt). */
function shareUpdatedAt(projectId) {
  const vals = Object.values(docUpdatedAtMap(projectId));
  return vals.length ? vals.sort().slice(-1)[0] : null;
}
function docUpdatedAtMap(projectId) {
  const map = {};
  for (const r of db.prepare("SELECT kind, updated_at FROM docs WHERE project_id = ?").all(projectId)) {
    map[r.kind] = r.updated_at;
  }
  return map;
}
function listVersions(projectId) {
  return db.prepare(`SELECT id, label, note, created_at,
      length(stripboard) AS sb_size, length(callsheet) AS cs_size
    FROM versions WHERE project_id = ? ORDER BY created_at DESC, id DESC`).all(projectId);
}

/* ---------- väder ---------- */
const WEATHER_UA = "Shortplanner/1.0 (self-hosted stripboard-verktyg; kontakt: " + (process.env.WEATHER_CONTACT || "ej angiven, se WEATHER_CONTACT i .env") + ")";

function wsymb2Icon(code) {
  const map = {
    1: "☀️", 2: "🌤️", 3: "⛅", 4: "🌥️", 5: "☁️", 6: "☁️", 7: "🌫️",
    8: "🌦️", 9: "🌧️", 10: "🌧️", 11: "⛈️",
    12: "🌨️", 13: "🌨️", 14: "🌨️",
    15: "🌨️", 16: "❄️", 17: "❄️",
    18: "🌧️", 19: "🌧️", 20: "🌧️",
    21: "⛈️",
    22: "🌨️", 23: "🌨️", 24: "🌨️",
    25: "❄️", 26: "❄️", 27: "❄️"
  };
  return map[code] || "🌡️";
}
function metSymbolIcon(sym) {
  if (!sym) return "🌡️";
  if (sym.startsWith("clearsky")) return "☀️";
  if (sym.startsWith("fair")) return "🌤️";
  if (sym.startsWith("partlycloudy")) return "⛅";
  if (sym.startsWith("cloudy")) return "☁️";
  if (sym.startsWith("fog")) return "🌫️";
  if (sym.includes("thunder")) return "⛈️";
  if (sym.includes("sleet")) return "🌨️";
  if (sym.includes("snow")) return "❄️";
  if (sym.includes("rain")) return "🌧️";
  return "🌡️";
}

/* UTC-tidpunkten som motsvarar kl 12:00 lokal tid i Stockholm ett givet datum
   (hanterar sommar-/vintertid korrekt, till skillnad från ett fast +01:00/+02:00). */
function stockholmNoonUtcMs(dateStr) {
  const guess = new Date(dateStr + "T12:00:00Z").getTime();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Stockholm", hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit"
  }).formatToParts(guess);
  const get = (t) => parts.find(p => p.type === t).value;
  const wallClockAsUtcMs = Date.parse(`${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}Z`);
  const offsetMs = wallClockAsUtcMs - guess;
  return guess - offsetMs;
}

async function geocodeAddress(address) {
  const url = "https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" + encodeURIComponent(address);
  const res = await fetch(url, { headers: { "User-Agent": WEATHER_UA } });
  if (!res.ok) return null;
  const arr = await res.json();
  if (!arr.length) return null;
  return { lat: parseFloat(arr[0].lat), lon: parseFloat(arr[0].lon), label: arr[0].display_name };
}

function closestSeries(list, getTime, targetMs, maxDiffMs) {
  let best = null, bestDiff = Infinity;
  for (const item of list) {
    const diff = Math.abs(getTime(item) - targetMs);
    if (diff < bestDiff) { bestDiff = diff; best = item; }
  }
  return bestDiff <= maxDiffMs ? best : null;
}

async function fetchSmhiWeather(lat, lon, targetMs) {
  const url = `https://opendata-download-metfcst.smhi.se/api/category/pmp3g/version/2/geotype/point/lon/${lon.toFixed(4)}/lat/${lat.toFixed(4)}/data.json`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  const best = closestSeries(data.timeSeries || [], ts => new Date(ts.validTime).getTime(), targetMs, 20 * 3600 * 1000);
  if (!best) return null;
  const params = Object.fromEntries(best.parameters.map(p => [p.name, p.values[0]]));
  if (params.t == null) return null;
  return { temp: params.t, icon: wsymb2Icon(params.Wsymb2) };
}

async function fetchMetWeather(lat, lon, targetMs) {
  const url = `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`;
  const res = await fetch(url, { headers: { "User-Agent": WEATHER_UA } });
  if (!res.ok) return null;
  const data = await res.json();
  const series = (data.properties && data.properties.timeseries) || [];
  const best = closestSeries(series, ts => new Date(ts.time).getTime(), targetMs, 20 * 3600 * 1000);
  if (!best) return null;
  const inst = best.data.instant.details;
  const symbol = (best.data.next_1_hours && best.data.next_1_hours.summary && best.data.next_1_hours.summary.symbol_code)
    || (best.data.next_6_hours && best.data.next_6_hours.summary && best.data.next_6_hours.summary.symbol_code) || "";
  if (inst.air_temperature == null) return null;
  return { temp: inst.air_temperature, icon: metSymbolIcon(symbol) };
}

async function fetchSunTimes(lat, lon, dateStr) {
  const url = `https://api.sunrise-sunset.org/json?lat=${lat}&lng=${lon}&date=${dateStr}&formatted=0`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  if (data.status !== "OK") return null;
  const fmt = (iso) => new Intl.DateTimeFormat("sv-SE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Stockholm", hour12: false }).format(new Date(iso));
  return { sunrise: fmt(data.results.sunrise), sunset: fmt(data.results.sunset) };
}

app.get("/api/geocode", auth, async (req, res) => {
  const address = String(req.query.address || "").trim();
  if (!address) return res.status(400).json({ error: "Adress saknas" });
  try {
    const geo = await geocodeAddress(address);
    if (!geo) return res.status(404).json({ error: "Kunde inte hitta adressen \"" + address + "\"" });
    res.json({ lat: geo.lat, lng: geo.lon, place: geo.label });
  } catch (e) {
    console.error("Geokodningsfel:", e);
    res.status(502).json({ error: "Geokodning misslyckades: " + e.message });
  }
});

/* Korta Google Maps-länkar (maps.app.goo.gl, goo.gl/...) bär inga
   koordinater i själva URL:en -- de finns bara i sidan länken egentligen
   pekar på, efter en eller flera redirects. Följer redirectkedjan
   server-sidan och lämnar tillbaka den slutgiltiga URL:en, som klienten
   sedan kör samma coordsFromMapsUrl-extrahering på som redan finns för
   fulla länkar. Domän-allowlistad -- annars blir det en öppen SSRF-proxy
   för inloggade användare att hämta godtyckliga URL:er genom servern. */
const MAPS_LINK_HOSTS = new Set(["maps.app.goo.gl", "goo.gl", "maps.google.com", "www.google.com", "google.com", "g.co"]);
app.get("/api/resolve-maps-link", auth, async (req, res) => {
  const url = String(req.query.url || "").trim();
  let parsed;
  try { parsed = new URL(url); } catch { return res.status(400).json({ error: "Ogiltig länk" }); }
  if (parsed.protocol !== "https:" || !MAPS_LINK_HOSTS.has(parsed.hostname)) {
    return res.status(400).json({ error: "Bara Google Maps-länkar stöds" });
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const r = await fetch(parsed.href, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; Shortplanner/1.0)" }
    });
    clearTimeout(timeout);
    res.json({ url: r.url });
  } catch (e) {
    console.error("Kunde inte slå upp maps-länk:", e);
    res.status(502).json({ error: "Kunde inte slå upp länken: " + e.message });
  }
});

app.get("/api/weather", auth, async (req, res) => {
  const address = String(req.query.address || "").trim();
  const date = String(req.query.date || "").trim();
  if (!address) return res.status(400).json({ error: "Adress saknas" });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: "Ogiltigt datum" });
  try {
    const geo = await geocodeAddress(address);
    if (!geo) return res.status(404).json({ error: "Kunde inte hitta adressen \"" + address + "\"" });
    const targetMs = stockholmNoonUtcMs(date);
    let w = await fetchSmhiWeather(geo.lat, geo.lon, targetMs).catch(() => null);
    if (!w) w = await fetchMetWeather(geo.lat, geo.lon, targetMs).catch(() => null);
    if (!w) {
      return res.status(404).json({ error: "Ingen väderprognos tillgänglig ännu för det datumet (för långt fram i tiden, eller adressen ligger utanför täckningen)" });
    }
    const sun = await fetchSunTimes(geo.lat, geo.lon, date).catch(() => null);
    res.json({
      weather_icon: w.icon,
      weather_temp: Math.round(w.temp) + "°C",
      sunrise: sun ? sun.sunrise : "",
      sunset: sun ? sun.sunset : "",
      place: geo.label
    });
  } catch (e) {
    console.error("Väderfel:", e);
    res.status(502).json({ error: "Väderhämtning misslyckades: " + e.message });
  }
});

/* ---------- statiska filer ----------
   Explicit no-cache-header (inte bara maxAge:0) så att mellanliggande CDN/proxy
   inte sätter sin egen cache-tid på JS/CSS baserat på filändelse. */
app.use(express.static(path.join(__dirname, "public"), {
  extensions: ["html"],
  etag: true,
  setHeaders: (res) => res.setHeader("Cache-Control", "no-cache")
}));
app.get("/share/:token", (req, res) => {
  res.setHeader("Cache-Control", "no-cache");
  res.sendFile(path.join(__dirname, "public", "view.html"));
});
app.get("*", (req, res) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ error: "Okänd endpoint" });
  res.setHeader("Cache-Control", "no-cache");
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.use((err, req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Serverfel" });
});

app.listen(PORT, "0.0.0.0", () => console.log(`Shortplanner kör på port ${PORT}`));
