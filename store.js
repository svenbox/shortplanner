"use strict";
/* Dokument- och versionslager. Bruten ut ur server.js så att
   återställningen (restore) kan köras och testas som en enda atomär
   SQLite-transaktion utan att dra igång HTTP-servern.

   All åtkomst går via `db` från ./db (better-sqlite3 = synkront, så en
   db.transaction()-wrap ger allt-eller-inget: kastas något inuti görs
   ROLLBACK, och dör processen mitt i en transaktion rullas den
   ocommittade transaktionen tillbaka när databasen öppnas igen (WAL)). */

const { db } = require("./db");

const now = () => new Date().toISOString();

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

/* ---------- dokument ---------- */
function getDoc(projectId, kind) {
  const r = db.prepare("SELECT data FROM docs WHERE project_id = ? AND kind = ?").get(projectId, kind);
  if (!r) return null;
  try { return JSON.parse(r.data); } catch { return null; }
}
function putDoc(projectId, kind, obj, ts) {
  ts = ts || now();
  db.prepare(`INSERT INTO docs (project_id, kind, data, updated_at) VALUES (?,?,?,?)
    ON CONFLICT(project_id, kind) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`)
    .run(projectId, kind, JSON.stringify(obj), ts);
  db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(ts, projectId);
  return ts;
}
function docUpdatedAtMap(projectId) {
  const map = {};
  for (const r of db.prepare("SELECT kind, updated_at FROM docs WHERE project_id = ?").all(projectId)) {
    map[r.kind] = r.updated_at;
  }
  return map;
}
function shareUpdatedAt(projectId) {
  const vals = Object.values(docUpdatedAtMap(projectId));
  return vals.length ? vals.sort().slice(-1)[0] : null;
}

/* ---------- versioner ---------- */
function listVersions(projectId) {
  return db.prepare(`SELECT id, label, note, created_at,
      length(stripboard) AS sb_size, length(callsheet) AS cs_size
    FROM versions WHERE project_id = ? ORDER BY created_at DESC, id DESC`).all(projectId);
}

/* De fyra dok-typer en version fryser, och deras tomdefault. */
const VERSIONED = [
  ["stripboard", EMPTY_STRIPBOARD],
  ["callsheet", EMPTY_CALLSHEET],
  ["script", EMPTY_SCRIPT],
  ["dpr", EMPTY_DPR]
];

/* Skapar en namngiven ögonblicksbild av projektets nuvarande arbetsläge.
   En INSERT + en UPDATE — wrappad så projektet inte kan få en version utan
   att updated_at-stämpeln följer med (eller tvärtom). */
const createVersion = db.transaction((projectId, label, note) => {
  label = String(label || "").trim() || ("Version " + (listVersions(projectId).length + 1));
  note = String(note || "").trim();
  const ts = now();
  const info = db.prepare(`INSERT INTO versions (project_id, label, note, stripboard, callsheet, script, dpr, created_at)
    VALUES (?,?,?,?,?,?,?,?)`).run(
    projectId, label, note,
    JSON.stringify(getDoc(projectId, "stripboard") || EMPTY_STRIPBOARD()),
    JSON.stringify(getDoc(projectId, "callsheet") || EMPTY_CALLSHEET()),
    JSON.stringify(getDoc(projectId, "script") || EMPTY_SCRIPT()),
    JSON.stringify(getDoc(projectId, "dpr") || EMPTY_DPR()),
    ts);
  db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(ts, projectId);
  return { id: info.lastInsertRowid, label, note, created_at: ts };
});

/* Återställer en version ATOMISKT: säkerhetskopian ("Före återställning") av
   nuvarande läge OCH återläsningen av alla dokument sker i EN transaktion.
   Går något fel (trasig JSON i en version, processen dör mitt i) blir varken
   säkerhetskopian eller återställningen delvis applicerad — databasen är
   antingen helt före eller helt efter, aldrig mitt emellan.

   Äldre versioner (från innan Manus/DPR frystes) har NULL i script/dpr —
   då lämnas nuvarande Manus/DPR orörda istället för att nollas. */
const restoreVersion = db.transaction((vid) => {
  const v = db.prepare("SELECT * FROM versions WHERE id = ?").get(vid);
  if (!v) { const e = new Error("Versionen finns inte"); e.code = "NOT_FOUND"; throw e; }
  const ts = now();

  // 1. säkerhetskopiera nuvarande arbetsläge
  db.prepare(`INSERT INTO versions (project_id, label, note, stripboard, callsheet, script, dpr, created_at)
    VALUES (?,?,?,?,?,?,?,?)`).run(
    v.project_id, "Före återställning", "Automatiskt sparad innan »" + v.label + "« återställdes",
    JSON.stringify(getDoc(v.project_id, "stripboard") || EMPTY_STRIPBOARD()),
    JSON.stringify(getDoc(v.project_id, "callsheet") || EMPTY_CALLSHEET()),
    JSON.stringify(getDoc(v.project_id, "script") || EMPTY_SCRIPT()),
    JSON.stringify(getDoc(v.project_id, "dpr") || EMPTY_DPR()),
    ts);

  // 2. läs tillbaka varje dokument (JSON.parse här inne så trasig data → ROLLBACK)
  for (const [kind] of VERSIONED) {
    if (v[kind] == null) continue;                 // NULL på gamla versioner: hoppa
    putDoc(v.project_id, kind, JSON.parse(v[kind]), ts);
  }
  return { ok: true, project_id: v.project_id, restored_at: ts };
});

/* Skapar ett helt projekt ur en (redan validerad) export-payload ATOMISKT:
   projektraden, alla dokument och alla versioner i EN transaktion. Går något
   fel skapas ingenting alls — ingen halv projektrad utan dokument.
   Anropa BARA efter validate.validateImport(). */
const importProject = db.transaction((payload) => {
  const ts = now();
  const name = String(payload.name || "Importerat projekt").trim().slice(0, 200) || "Importerat projekt";
  const id = db.prepare("INSERT INTO projects (name, created_at, updated_at) VALUES (?,?,?)").run(name, ts, ts).lastInsertRowid;

  putDoc(id, "stripboard", payload.stripboard, ts);
  putDoc(id, "callsheet", payload.callsheet || EMPTY_CALLSHEET(), ts);
  if (payload.script != null) putDoc(id, "script", payload.script, ts);
  if (payload.dpr != null) putDoc(id, "dpr", payload.dpr, ts);
  if (payload.meta != null) putDoc(id, "meta", payload.meta, ts);

  const insVer = db.prepare(`INSERT INTO versions (project_id, label, note, stripboard, callsheet, script, dpr, created_at)
    VALUES (?,?,?,?,?,?,?,?)`);
  for (const v of (payload.versions || [])) {
    insVer.run(id,
      String(v.label || "Version").slice(0, 200),
      String(v.note || "").slice(0, 2000),
      JSON.stringify(v.stripboard || {}),
      JSON.stringify(v.callsheet || {}),
      v.script != null ? JSON.stringify(v.script) : null,
      v.dpr != null ? JSON.stringify(v.dpr) : null,
      String(v.created_at || ts).slice(0, 40));
  }
  return { id, name };
});

/* Vad delningsrouten får skicka av script-doket beroende på vilka
   komponenter länken visar. Upphovsrätten till manuset ligger sällan hos
   produktionen — full brödtext (scenernas `body`) och `draft`-texten går
   BARA ut när Manus eller Dagsmanus faktiskt delas. Rullplan behöver bara
   siffror/struktur (nummer, slugline, sidor, skärmtid) — inte texten. */
function redactScriptForShare(script, comps) {
  const c = Array.isArray(comps) ? comps : [];
  if (!script) return EMPTY_SCRIPT();
  if (c.includes("manus") || c.includes("sides")) return script;      // texten är hela poängen
  if (c.includes("rullplan")) {
    return Object.assign({}, script, {
      draft: "", draftDate: "",
      scenes: (script.scenes || []).map(s => ({
        number: s.number, slugline: s.slugline,
        scriptPage: s.scriptPage, scriptPageEnd: s.scriptPageEnd,
        screenTimeSec: s.screenTimeSec, negActualMin: s.negActualMin
      }))
    });
  }
  return EMPTY_SCRIPT();
}

module.exports = {
  now,
  EMPTY_STRIPBOARD, EMPTY_CALLSHEET, EMPTY_SCRIPT, EMPTY_DPR, EMPTY_META,
  getDoc, putDoc, docUpdatedAtMap, shareUpdatedAt,
  listVersions, createVersion, restoreVersion, importProject, redactScriptForShare, VERSIONED
};
