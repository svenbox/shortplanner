/* Shortplanner – skal: inloggning, projekt, autospar, versioner. */
"use strict";
window.App = (function () {

const state = {
  authed: false,
  projects: [],
  project: null,      // { id, name }
  stripboard: null,
  callsheet: null,
  script: null,
  dpr: null,
  versions: [],
  tab: "stripboard",
  dirty: { stripboard: false, callsheet: false, script: false, dpr: false, meta: false },
  docUpdatedAt: {},        // { kind: iso } — senast kända serverversion per dokument
  saveBlocked: false,      // sant efter en 409 tills användaren laddar om / skriver över
  forceOverwrite: false,   // nästa flushSave hoppar över versionskollen
  undo: { stripboard: [], callsheet: [] },        // stack av tidigare sparade lägen
  undoBase: { stripboard: null, callsheet: null }, // senast sparade läget (jämförelsepunkt)
  suppressUndoPush: { stripboard: false, callsheet: false }, // sparet kommer från en ångra
  saveTimer: null,
  activeCsDayLabel: "",
  bootVersion: null,       // serverns build-id vid sidladdning; skiljer det sig senare -> "ny version"-banner
  site: null,              // sajtinställningar (publik delmängd): company, hasLogo, features, locale
  logoVer: Date.now()      // cache-bust för /logo, bumpas när man laddar upp en ny
};

/* ---------- API ---------- */
async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: "same-origin"
  });
  noteServerVersion(res.headers.get("X-App-Version"));
  if (res.status === 401) { showLogin(); throw new Error("Ej inloggad"); }
  const txt = await res.text();
  let data = null;
  try { data = txt ? JSON.parse(txt) : null; } catch { data = null; }
  if (!res.ok) {
    const err = new Error((data && data.error) || ("HTTP " + res.status));
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

/* ---------- småfunktioner ---------- */
const $ = (id) => document.getElementById(id);
const clone = (o) => JSON.parse(JSON.stringify(o));
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
let toastTimer;
function toast(msg) {
  const el = $("toast");
  el.textContent = msg; el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2000);
}
function fmtDateTime(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return iso || "";
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function openOv(id) { $(id).classList.add("open"); }
function closeOv(id) { $(id).classList.remove("open"); }

function setSaveState(cls, text) {
  const el = $("saveState");
  el.className = "save-state " + (cls || "");
  el.textContent = text || "";
}

/* ---------- inloggning ---------- */
function showLogin() {
  state.authed = false;
  $("login").classList.remove("hidden");
  $("app").classList.add("hidden");
}
function showApp() {
  state.authed = true;
  $("login").classList.add("hidden");
  $("app").classList.remove("hidden");
}

async function doLogin(ev) {
  ev.preventDefault();
  const pw = $("loginPw").value;
  $("loginErr").textContent = "";
  try {
    await api("POST", "/api/login", { password: pw });
    $("loginPw").value = "";
    showApp();
    await goProjects();
  } catch (e) {
    $("loginErr").textContent = e.message;
  }
}
async function logout() {
  await api("POST", "/api/logout").catch(() => {});
  location.reload();
}

/* ---------- projekt ---------- */
async function goProjects() {
  state.project = null;
  state.activeCsDayLabel = "";
  document.title = "Shortplanner";
  flushSave(true);
  $("view-project").classList.add("hidden");
  $("view-projects").classList.add("active");
  $("tabbar").classList.add("hidden");
  $("crumb").innerHTML = "";
  setSaveState("", "");
  ["btnCast", "btnProjectSettings", "btnVersions", "btnSaveVersion", "btnExport", "btnShare"].forEach(id => $(id).classList.add("hidden"));
  await loadProjects();
  history.replaceState(null, "", "/");
}

async function loadProjects() {
  state.projects = await api("GET", "/api/projects");
  const grid = $("projGrid");
  grid.innerHTML = state.projects.map(p => `
    <div class="proj-card" onclick="App.openProject(${p.id})">
      <div class="proj-name">${esc(p.name)}</div>
      <div class="proj-meta">
        <span>${p.days} dag${p.days === 1 ? "" : "ar"}</span>
        <span>${p.scenes} scener</span>
        <span>${p.versions} version${p.versions === 1 ? "" : "er"}</span>
      </div>
      <div class="proj-meta">Ändrad ${esc(fmtDateTime(p.updated_at))}</div>
      <div class="proj-actions" onclick="event.stopPropagation()">
        <button class="btn btn-sm" onclick="App.renameProject(${p.id})">Byt namn</button>
        <button class="btn btn-sm" onclick="App.duplicateProject(${p.id})">Duplicera</button>
        <button class="btn btn-sm btn-danger" onclick="App.deleteProject(${p.id})">Ta bort</button>
      </div>
    </div>`).join("");
  $("projEmpty").classList.toggle("hidden", state.projects.length > 0);
}

function openNewProject() {
  $("npName").value = "";
  openOv("ovNewProject");
  setTimeout(() => $("npName").focus(), 50);
}
async function createProject() {
  const name = $("npName").value.trim() || "Nytt projekt";
  const p = await api("POST", "/api/projects", { name });
  closeOv("ovNewProject");
  toast("Projekt skapat");
  await openProject(p.id);
}
async function renameProject(id) {
  const p = state.projects.find(x => x.id === id);
  const name = prompt("Nytt namn", p ? p.name : "");
  if (name == null) return;
  await api("PATCH", "/api/projects/" + id, { name: name.trim() });
  await loadProjects();
}
async function duplicateProject(id) {
  await api("POST", `/api/projects/${id}/duplicate`, {});
  toast("Kopia skapad");
  await loadProjects();
}
async function deleteProject(id) {
  const p = state.projects.find(x => x.id === id);
  if (!confirm(`Ta bort "${p ? p.name : id}" med alla versioner? Går inte att ångra.`)) return;
  await api("DELETE", "/api/projects/" + id);
  toast("Projekt borttaget");
  await loadProjects();
}

async function openProject(id) {
  const d = await api("GET", "/api/projects/" + id);
  state.project = d.project;
  state.stripboard = d.stripboard;
  state.callsheet = d.callsheet;
  state.script = d.script;
  state.dpr = d.dpr;
  state.meta = d.meta || null;
  state.versions = d.versions;
  state.dirty = { stripboard: false, callsheet: false, script: false, dpr: false, meta: false };
  state.docUpdatedAt = d.docUpdatedAt || {};
  state.saveBlocked = false;
  state.forceOverwrite = false;
  state.undo = { stripboard: [], callsheet: [] };
  state.undoBase = { stripboard: clone(state.stripboard), callsheet: clone(state.callsheet) };
  state.suppressUndoPush = { stripboard: false, callsheet: false };
  $("conflictBar").classList.add("hidden");

  $("view-projects").classList.remove("active");
  $("view-project").classList.remove("hidden");
  $("tabbar").classList.remove("hidden");
  ["btnCast", "btnProjectSettings", "btnVersions", "btnSaveVersion", "btnExport", "btnShare"].forEach(x => $(x).classList.remove("hidden"));
  $("crumb").innerHTML = `<span>›</span><strong>${esc(state.project.name)}</strong>`;
  setSaveState("saved", "Sparat");

  mountStripboard();
  CS.mount($("tab-callsheet"), state.callsheet, csMountOpts());
  SC.mount($("tab-manus"), state.script, {
    onChange: (data) => { state.script = data; markDirty("script"); SC.refreshRullplan(); },
    getStripboard: () => state.stripboard,
    toast
  });
  SC.mountSides($("tab-sides"), state.script, {
    getStripboard: () => state.stripboard
  });
  SC.mountRullplan($("tab-rullplan"), state.script, {
    getStripboard: () => state.stripboard
  });
  DPR.mount($("tab-dpr"), state.dpr, {
    onChange: () => markDirty("dpr"),
    onScriptChange: () => { markDirty("script"); SC.refreshRullplan(); },
    getScript: () => state.script,
    getCallsheet: () => state.callsheet,
    toast
  });
  renderVersions();
  updateCounts();
  setTab("stripboard");
  /* Rullar till dagens datum i stripboardet när projektet öppnas -- ett
     rAF-varv så layouten hunnit räknas ut sedan fliken faktiskt blev
     synlig (den var display:none ett ögonblick tidigare i samma anrop). */
  requestAnimationFrame(() => SB.scrollToClosestDay());
  history.replaceState(null, "", "/p/" + id);
}

/* ---------- stripboard → call sheet ---------- */
function onCallSheetFromStripboard(payload) {
  /* fyll i produktionsuppgifter från stripboardet om call sheeten är tom */
  const prod = state.callsheet.production || (state.callsheet.production = {});
  const sbProd = (state.stripboard && state.stripboard.production) || {};
  const m = state.meta || {};
  if (!prod.film) prod.film = m.title || sbProd.film || state.project.name;
  if (!prod.producent) prod.producent = m.producer || sbProd.producent || "";
  if (!prod.regi) prod.regi = m.director || sbProd.regi || "";
  const metaFill = { producent_tel: m.producerPhone, foto: m.dop, ad: m.firstAD, platschef: m.locationManager };
  ["producent_tel", "foto", "ad", "platschef"].forEach(k => { if (prod[k] == null || prod[k] === "—") prod[k] = metaFill[k] || prod[k] || "—"; });

  const r = CS.upsertDayFromStripboard(payload);
  markDirty("callsheet");
  CS.mount($("tab-callsheet"), state.callsheet, csMountOpts());
  CS.setActiveDay(r.index);
  updateCounts();
  setTab("callsheet");
  toast(r.replaced ? `${payload.label} uppdaterad i call sheet` : `${payload.label} tillagd som call sheet`);
}

/* ---------- autospar ---------- */
function markDirty(kind) {
  state.dirty[kind] = true;
  setSaveState("saving", "Sparar…");
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(flushSave, 700);
}

async function flushSave(silent) {
  clearTimeout(state.saveTimer);
  if (!state.project || state.saveBlocked) return;
  const kinds = Object.keys(state.dirty).filter(k => state.dirty[k]);
  if (!kinds.length) return;
  const docFor = { stripboard: state.stripboard, callsheet: state.callsheet, script: state.script, dpr: state.dpr, meta: state.meta };
  try {
    for (const kind of kinds) {
      const r = await api("PUT", `/api/projects/${state.project.id}/doc/${kind}`, {
        data: docFor[kind],
        baseUpdatedAt: state.forceOverwrite ? null : (state.docUpdatedAt[kind] || null)
      });
      state.dirty[kind] = false;
      if (r && r.updatedAt) state.docUpdatedAt[kind] = r.updatedAt;
      recordUndoSnapshot(kind, docFor[kind]);
      state.suppressUndoPush[kind] = false;
    }
    state.forceOverwrite = false;
    if (!silent) {
      const t = new Date();
      const p = (n) => String(n).padStart(2, "0");
      setSaveState("saved", `Sparat ${p(t.getHours())}:${p(t.getMinutes())}`);
    }
  } catch (e) {
    if (e && e.status === 409) { showConflict(); return; }
    setSaveState("error", "Kunde inte spara");
    console.error(e);
  }
}

/* ---------- ångra (Cmd/Ctrl+Z) för stripboard och call sheet ----------
   Autosparet är aggressivt och det finns ingen ångra i modulerna själva.
   Varje lyckat spar lägger det föregående sparade läget på en stack (max
   30). Ctrl+Z på stripboard-/call sheet-fliken plockar tillbaka det.
   Ett spar som i sin tur kommer FRÅN en ångra hoppas över (suppress-flagg)
   så stacken inte äter sig själv och flera ångra i rad går bakåt. */
function recordUndoSnapshot(kind, savedDoc) {
  if (kind !== "stripboard" && kind !== "callsheet") return;
  const savedJson = JSON.stringify(savedDoc);
  if (!state.suppressUndoPush[kind]) {
    const base = state.undoBase[kind];
    if (base != null && JSON.stringify(base) !== savedJson) {
      state.undo[kind].push(base);
      if (state.undo[kind].length > 30) state.undo[kind].shift();
    }
  }
  state.undoBase[kind] = JSON.parse(savedJson);
}

function undoDoc(kind) {
  if (kind !== "stripboard" && kind !== "callsheet") return;
  const stack = state.undo[kind];
  if (!stack || !stack.length) { toast("Inget att ångra"); return; }
  const prev = stack.pop();
  state[kind] = prev;
  state.undoBase[kind] = clone(prev);
  state.suppressUndoPush[kind] = true;
  if (kind === "stripboard") { remountStripboard(); }
  else { remountCallSheet(); DPR.refreshDpr(); }
  markDirty(kind);
  toast("Ångrade senaste ändringen");
}

/* En annan enhet (eller flik) har sparat samma projekt. Autospar pausas så
   vi inte tyst skriver över den; användaren väljer att ladda om eller att
   skriva över med det som står här. */
function showConflict() {
  state.saveBlocked = true;
  clearTimeout(state.saveTimer);
  setSaveState("error", "Ändrad på annan enhet");
  $("conflictBar").classList.remove("hidden");
}
async function reloadAfterConflict() {
  if (!confirm("Ladda om projektet? Ändringar du gjort här som inte hunnit sparas försvinner.")) return;
  $("conflictBar").classList.add("hidden");
  state.saveBlocked = false;
  state.forceOverwrite = false;
  await openProject(state.project.id);
}
async function overwriteAfterConflict() {
  $("conflictBar").classList.add("hidden");
  state.saveBlocked = false;
  state.forceOverwrite = true;   // nästa flushSave hoppar över versionskollen
  await flushSave();
  toast("Dina ändringar skrevs över");
}

window.addEventListener("beforeunload", (e) => {
  if (Object.values(state.dirty).some(Boolean)) {
    flushSave(true);
    e.preventDefault();
    e.returnValue = "";
  }
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) flushSave(true);
  else checkVersion();
});
window.addEventListener("online", checkVersion);
setInterval(checkVersion, 10 * 60 * 1000);

/* ---------- versionskoll: upptäck en ny deploy i en flik som stått öppen ----------
   Serverns build-id kommer med som X-App-Version på varje svar (så autosparet
   märker det inom sekunder) och kan pollas via /api/version vid fokus/online/
   var 10:e min. Vi tvingar inte fram omladdning -- bannern väntar på ett klick
   så inget osparat går förlorat. */
async function fetchServerVersion() {
  try {
    const r = await fetch("/api/version", { cache: "no-store", credentials: "same-origin" });
    if (!r.ok) return null;
    return (await r.json()).version || null;
  } catch { return null; }
}
function noteServerVersion(v) {
  if (!v) return;
  if (!state.bootVersion) { state.bootVersion = v; return; }
  if (v !== state.bootVersion) {
    $("updateBar").classList.remove("hidden");
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage("refreshShell");
    }
  }
}
async function checkVersion() { noteServerVersion(await fetchServerVersion()); }

/* ---------- sajtinställningar ---------- */
async function loadSite() {
  try {
    const r = await fetch("/api/site/public", { cache: "no-store", credentials: "same-origin" });
    state.site = r.ok ? await r.json() : null;
  } catch (e) { state.site = null; }
  applySiteFeatures();
  applySiteBranding();
}
function applySiteFeatures() {
  const f = (state.site && state.site.features) || {};
  const hide = { rullplan: f.rullplan === false, dpr: f.dpr === false, manus: f.manus === false, sides: f.manus === false };
  Object.keys(hide).forEach(k => {
    const tab = document.querySelector('.tabbar .tab[data-tab="' + k + '"]');
    if (tab) tab.hidden = hide[k];
  });
  const active = document.querySelector('.tabbar .tab.active');
  if (active && active.hidden) setTab("stripboard");
}
function applySiteBranding() {
  const name = state.site && state.site.company && state.site.company.name;
  const span = document.querySelector('.topbar .brand span');
  if (span && name) span.textContent = name;
}
async function openSiteSettings() {
  let c;
  try { c = await api("GET", "/api/site"); } catch (e) { return alert("Kunde inte hämta inställningar: " + e.message); }
  $("ssName").value = c.company.name || "";
  $("ssOrg").value = c.company.orgnr || "";
  $("ssAddr").value = c.company.address || "";
  $("ssPhone").value = c.company.phone || "";
  $("ssEmail").value = c.company.email || "";
  $("ssWeb").value = c.company.website || "";
  $("ssRullplan").checked = c.features.rullplan !== false;
  $("ssDpr").checked = c.features.dpr !== false;
  $("ssLocale").value = c.locale || "sv";
  $("ssLogoFile").value = "";
  renderLogoPreview(!!(c.logo && c.logo.ext));
  openOv("ovSiteSettings");
}
function renderLogoPreview(hasLogo) {
  $("ssLogoPreview").innerHTML = hasLogo
    ? `<img src="/logo?v=${state.logoVer}" alt="Logotyp">`
    : `<span class="imp-hint">Ingen egen logga uppladdad.</span>`;
}
async function saveSiteSettings() {
  const patch = {
    company: {
      name: $("ssName").value.trim(), orgnr: $("ssOrg").value.trim(), address: $("ssAddr").value.trim(),
      phone: $("ssPhone").value.trim(), email: $("ssEmail").value.trim(), website: $("ssWeb").value.trim()
    },
    features: { rullplan: $("ssRullplan").checked, dpr: $("ssDpr").checked },
    locale: $("ssLocale").value
  };
  try {
    await api("PUT", "/api/site", patch);
    closeOv("ovSiteSettings");
    await loadSite();
    if (state.project) { applySiteFeatures(); remountCallSheet(); }
    toast("Inställningar sparade");
  } catch (e) { alert("Kunde inte spara: " + e.message); }
}
async function uploadLogo() {
  const f = $("ssLogoFile").files[0];
  if (!f) return alert("Välj en bildfil först.");
  if (f.size > 2 * 1024 * 1024) return alert("Loggan är för stor (max 2 MB).");
  const dataUrl = await new Promise((res, rej) => {
    const rd = new FileReader();
    rd.onload = () => res(rd.result); rd.onerror = () => rej(new Error("Kunde inte läsa filen"));
    rd.readAsDataURL(f);
  });
  try {
    await api("POST", "/api/site/logo", { dataUrl });
    state.logoVer = Date.now();
    if (state.site) state.site.hasLogo = true;
    $("ssLogoFile").value = "";
    renderLogoPreview(true);
    if (state.project) remountCallSheet();
    toast("Logga uppladdad");
  } catch (e) { alert("Uppladdning misslyckades: " + e.message); }
}
async function removeLogo() {
  if (!confirm("Ta bort den uppladdade loggan?")) return;
  try {
    await api("DELETE", "/api/site/logo");
    state.logoVer = Date.now();
    if (state.site) state.site.hasLogo = false;
    renderLogoPreview(false);
    if (state.project) remountCallSheet();
    toast("Logga borttagen");
  } catch (e) { alert("Kunde inte ta bort: " + e.message); }
}

/* ---------- projektinfo (meta-doket) ---------- */
const PS_FIELDS = {
  psTitle: "title", psCompany: "company", psProducer: "producer", psProducerPhone: "producerPhone",
  psDirector: "director", psDop: "dop", psFirstAD: "firstAD", psLocationManager: "locationManager",
  psShootStart: "shootStart", psShootEnd: "shootEnd", psFormat: "format", psAspect: "aspectRatio"
};
function openProjectSettings() {
  if (!state.project) return;
  const m = state.meta || {};
  Object.keys(PS_FIELDS).forEach(id => { $(id).value = m[PS_FIELDS[id]] || ""; });
  openOv("ovProjectSettings");
}
function saveProjectSettings() {
  const m = state.meta || (state.meta = {});
  Object.keys(PS_FIELDS).forEach(id => { m[PS_FIELDS[id]] = $(id).value.trim(); });
  markDirty("meta");
  closeOv("ovProjectSettings");
  toast("Projektinfo sparad");
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("/sw.js").catch(() => {});
  navigator.serviceWorker.addEventListener("message", (e) => {
    if (e.data && e.data.type === "shell-updated") $("updateBar").classList.remove("hidden");
  });
  checkShellFreshness();
}
/* SW:n cachar app-skalet cache-först. Efter en deploy räcker det inte att
   jämföra X-App-Version header mot header (den nya är ju "baslinjen" direkt)
   -- jämför istället build-id:t på det CACHADE skalet mot /api/version, och
   be SW:n hämta nytt skal om de skiljer sig. */
async function checkShellFreshness() {
  try {
    if (!("caches" in window)) return;
    const shells = (await caches.keys()).filter(k => k.indexOf("sp-shell-") === 0);
    if (!shells.length) return;
    const srv = await fetchServerVersion();
    if (!srv) return;
    /* Vilket som helst cachat skal med ett annat build-id än serverns
       innebär stale kod (flera hopar sig om SW:n aldrig re-installerats). */
    const stale = shells.some(k => { const id = k.slice("sp-shell-".length); return id !== "boot" && id !== srv; });
    if (stale) {
      if (navigator.serviceWorker.controller) navigator.serviceWorker.controller.postMessage("refreshShell");
      $("updateBar").classList.remove("hidden");
    }
  } catch (e) { /* ignoreras */ }
}

/* ---------- flikar ---------- */
function setTab(name) {
  /* Avstängda flikar (site-inställningarna) går inte att öppna. */
  const target = document.querySelector('.tabbar .tab[data-tab="' + name + '"]');
  if (target && target.hidden) name = "stripboard";
  state.tab = name;
  document.querySelectorAll(".tabbar .tab").forEach(t => t.classList.toggle("active", t.dataset.tab === name));
  ["stripboard", "callsheet", "manus", "sides", "rullplan", "dpr", "versions"].forEach(n =>
    $("tab-" + n).classList.toggle("active", n === name));
  /* Byter man flik ska man landa högst upp på den nya fliken, inte kvar
     på den scrollposition förra fliken råkade lämnas i (samma dokument,
     en delad scrollbar). Görs synkront här -- openProject()s egen
     "hoppa till dagens datum"-scroll körs i en rAF EFTER sitt setTab-anrop
     och vinner därför över den här nollställningen, som avsett. */
  window.scrollTo(0, 0);
  /* Manus/Dagsmanus/Rullplan ritas om vid varje flikbyte, inte bara vid mount
     — de ska alltid spegla stripboardets just nu gällande ordning. DPR är
     inte lika levande (dess scenlista är en frusen ögonblicksbild), men
     ritas om ändå så den speglar ev. nya call sheet-dagar. */
  if (name === "manus") SC.refreshManus();
  if (name === "sides") SC.refreshSides();
  if (name === "rullplan") SC.refreshRullplan();
  if (name === "dpr") DPR.refreshDpr();
  updateDocTitle();
}

/* Sidtiteln styr både flikrubriken och webbläsarens föreslagna filnamn vid
   utskrift/spara som PDF — därför speglar den vad man faktiskt tittar på. */
function updateDocTitle() {
  const name = (state.project && state.project.name) || "Shortplanner";
  if (state.tab === "callsheet" && state.activeCsDayLabel) {
    document.title = `${name} – Call sheet – ${state.activeCsDayLabel}`;
  } else if (state.tab === "stripboard") {
    document.title = `${name} – Stripboard`;
  } else if (state.tab === "manus") {
    document.title = `${name} – Manus`;
  } else if (state.tab === "sides") {
    document.title = `${name} – Dagsmanus`;
  } else if (state.tab === "rullplan") {
    document.title = `${name} – Rullplan`;
  } else if (state.tab === "dpr") {
    document.title = `${name} – DPR`;
  } else {
    document.title = name;
  }
}
function updateCounts() {
  $("csCount").textContent = CS.dayCount();
  $("verCount").textContent = state.versions.length;
}

/* ---------- versioner ---------- */
function openVersions() { setTab("versions"); }

function openSaveVersion() {
  const n = state.versions.length + 1;
  $("svLabel").value = "Version " + n;
  $("svNote").value = "";
  openOv("ovSaveVersion");
  setTimeout(() => { const el = $("svLabel"); el.focus(); el.select(); }, 50);
}

async function saveVersion() {
  await flushSave(true);
  const label = $("svLabel").value.trim();
  const note = $("svNote").value.trim();
  await api("POST", `/api/projects/${state.project.id}/versions`, { label, note });
  closeOv("ovSaveVersion");
  await reloadVersions();
  toast("Version sparad");
  setTab("versions");
}

async function reloadVersions() {
  state.versions = await api("GET", `/api/projects/${state.project.id}/versions`);
  renderVersions();
  updateCounts();
}

function renderVersions() {
  const el = $("verList");
  if (!state.versions.length) {
    el.innerHTML = `<div class="empty-state">Inga sparade versioner ännu.<br>
      Arbetet sparas löpande — klicka <strong>Spara version</strong> när du vill frysa ett läge.</div>`;
    return;
  }
  el.innerHTML = state.versions.map((v, i) => `
    <div class="ver-row${i === 0 ? " ver-current" : ""}">
      <span class="v-label">${esc(v.label)}</span>
      <span class="v-date">${esc(fmtDateTime(v.created_at))}</span>
      <span class="v-actions">
        <button class="btn btn-sm" onclick="App.renameVersion(${v.id})">Byt namn</button>
        <button class="btn btn-sm" onclick="App.restoreVersion(${v.id})">Återställ</button>
        <button class="btn btn-sm" onclick="App.downloadVersion(${v.id})">Ladda ner</button>
        <button class="btn btn-sm btn-danger" onclick="App.deleteVersion(${v.id})">Ta bort</button>
      </span>
      ${v.note ? `<span class="v-note">${esc(v.note)}</span>` : ""}
    </div>`).join("");
}

async function restoreVersion(id) {
  const v = state.versions.find(x => x.id === id);
  if (!confirm(`Återställ "${v ? v.label : id}"?\n\nNuvarande läge sparas automatiskt som en egen version först.`)) return;
  await flushSave(true);
  await api("POST", `/api/versions/${id}/restore`, {});
  toast("Version återställd");
  await openProject(state.project.id);
  setTab("stripboard");
}
async function renameVersion(id) {
  const v = state.versions.find(x => x.id === id);
  const label = prompt("Nytt namn på versionen", v ? v.label : "");
  if (label == null) return;
  await api("PATCH", "/api/versions/" + id, { label: label.trim() });
  await reloadVersions();
}
async function deleteVersion(id) {
  const v = state.versions.find(x => x.id === id);
  if (!confirm(`Ta bort versionen "${v ? v.label : id}"?`)) return;
  await api("DELETE", "/api/versions/" + id);
  await reloadVersions();
  toast("Version borttagen");
}
async function downloadVersion(id) {
  const v = await api("GET", "/api/versions/" + id);
  download(`${slug(state.project.name)}_${slug(v.label)}.json`, JSON.stringify(v, null, 2));
}

/* ---------- export / import ---------- */
function slug(s) { return String(s).toLowerCase().replace(/[^\w\d]+/g, "-").replace(/^-|-$/g, ""); }
function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function exportProject() {
  await flushSave(true);
  window.location = `/api/projects/${state.project.id}/export`;
}
function openImportProject() {
  $("ipText").value = "";
  $("ipFile").value = "";
  openOv("ovImportProject");
}
async function importProject() {
  let txt = $("ipText").value.trim();
  const f = $("ipFile").files[0];
  if (f) txt = await f.text();
  if (!txt) return alert("Välj en fil eller klistra in JSON.");
  let payload;
  try { payload = JSON.parse(txt); } catch (e) { return alert("Ogiltig JSON: " + e.message); }
  const p = await api("POST", "/api/projects/import", payload);
  closeOv("ovImportProject");
  toast("Projekt importerat");
  await openProject(p.id);
}

/* ---------- importera scener till stripboardet ---------- */
function openImportStrips() {
  $("isFile").value = ""; $("isText").value = "";
  state.importStripsMode = "append";
  document.querySelectorAll("#isMode .radio-card").forEach(c => c.classList.toggle("sel", c.dataset.mode === "append"));
  const n = (state.script && state.script.scenes) ? state.script.scenes.length : 0;
  $("isManusInfo").textContent = n
    ? `Manuset har ${n} scen${n === 1 ? "" : "er"}. Skapar en strip per scen i "Ej schemalagt", i manusordning.`
    : "Inget manus importerat än — gå till Manus-fliken och importera först.";
  $("isManusBtn").disabled = !n;
  openOv("ovImportStrips");
}
function afterStripImport(msg) {
  closeOv("ovImportStrips");
  markDirty("stripboard");
  SC.refreshSides(); SC.refreshRullplan(); DPR.refreshDpr();
  updateCounts();
  setTab("stripboard");
  toast(msg);
}
function stripsFromManus() {
  const scenes = (state.script && state.script.scenes) || [];
  if (!scenes.length) return;
  const mode = state.importStripsMode || "append";
  if (mode === "replace" && !confirm("Ersätt hela stripboardet med manusets scener?")) return;
  const r = SB.generateFromScript(scenes, mode);
  afterStripImport(r.added
    ? `${r.added} scen${r.added === 1 ? "" : "er"} lades till i "Ej schemalagt"`
    : "Inga nya scener att lägga till (alla scennummer fanns redan)");
}
async function importStripsFile() {
  let txt = $("isText").value.trim();
  const f = $("isFile").files[0];
  if (f) txt = await f.text();
  if (!txt) return alert("Välj en fil eller klistra in JSON.");
  let obj;
  try { obj = JSON.parse(txt); } catch (e) { return alert("Ogiltig JSON: " + e.message); }
  const cur = state.stripboard;
  const hasScenes = cur && (cur.days || []).some(d => (d.strips || []).some(s => s.type === "scene"))
    || (cur && (cur.unscheduled || []).some(s => s.type === "scene"));
  if (hasScenes && !confirm("Det här ersätter hela nuvarande stripboard. Fortsätta?")) return;
  const r = SB.loadStripboard(obj);
  if (!r.ok) return alert(r.error);
  afterStripImport(`Stripboard inläst: ${r.days} dag${r.days === 1 ? "" : "ar"}, ${r.scenes} scener`);
}

/* Anropas från "Skapa stripboard"-knappen på Manus-fliken. */
function stripboardFromManus() {
  const scenes = (state.script && state.script.scenes) || [];
  if (!scenes.length) { toast("Importera ett manus först"); return; }
  const present = SB.scenesPresent();
  const already = scenes.filter(s => present.has(String(s.number || ""))).length;
  let mode = "append";
  if (already) {
    mode = confirm(`${already} av manusets scennummer finns redan i stripboardet.\n\nOK = lägg bara till de nya.\nAvbryt = ersätt hela stripboardet.`)
      ? "append" : "replace";
  }
  const r = SB.generateFromScript(scenes, mode);
  afterStripImport(r.added
    ? `${r.added} scen${r.added === 1 ? "" : "er"} lades till i "Ej schemalagt"`
    : "Alla manusets scener fanns redan i stripboardet");
}

/* ---------- skådespelare ---------- */
function openCast() {
  renderCastList();
  openOv("ovCast");
  setTimeout(() => $("cmRole").focus(), 50);
}
function renderCastList() {
  const list = state.stripboard.cast || [];
  $("castManageList").innerHTML = list.length
    ? list.map(c => `
      <div class="cast-manage-row">
        <span class="cm-id">${esc(c.id)}</span>
        <span class="cm-role" contenteditable="true" spellcheck="false" data-id="${esc(c.id)}" data-field="role" data-ph="Roll" onblur="App.editCastMember(this)" onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}">${esc(c.role || "")}</span>
        <span class="cm-name" contenteditable="true" spellcheck="false" data-id="${esc(c.id)}" data-field="name" data-ph="— (inget namn ännu)" onblur="App.editCastMember(this)" onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}">${esc(c.name || "")}</span>
        <button class="btn btn-sm btn-danger" onclick="App.removeCastMember('${c.id}')">Ta bort</button>
      </div>`).join("")
    : '<div class="empty-note">Inga skådespelare tillagda ännu.</div>';
}
function editCastMember(el) {
  const id = el.dataset.id, field = el.dataset.field;
  const val = el.textContent.trim();
  const c = (state.stripboard.cast || []).find(x => String(x.id) === String(id));
  if (!c) return;
  if (c[field] === val) return;
  c[field] = val;
  markDirty("stripboard");
}
function addCastMember() {
  const role = $("cmRole").value.trim();
  const name = $("cmName").value.trim();
  if (!role) return alert("Ange en roll/karaktär.");
  if (!state.stripboard.cast) state.stripboard.cast = [];
  const nextId = String(state.stripboard.cast.reduce((m, c) => Math.max(m, parseInt(c.id, 10) || 0), 0) + 1);
  state.stripboard.cast.push({ id: nextId, name, role });
  $("cmRole").value = "";
  $("cmName").value = "";
  markDirty("stripboard");
  renderCastList();
  toast("Skådespelare tillagd");
  $("cmRole").focus();
}
function removeCastMember(id) {
  if (!confirm("Ta bort skådespelaren?")) return;
  state.stripboard.cast = (state.stripboard.cast || []).filter(c => String(c.id) !== String(id));
  markDirty("stripboard");
  renderCastList();
  toast("Skådespelare borttagen");
}

/* ---------- delning ---------- */
function shareUrlFor() {
  return state.project && state.project.share_token
    ? location.origin + "/share/" + state.project.share_token
    : null;
}
async function openShare() {
  const r = await api("POST", `/api/projects/${state.project.id}/share`, {});
  state.project.share_token = r.token;
  $("shareLink").value = r.url;
  openOv("ovShare");
  setTimeout(() => $("shareLink").select(), 50);
  remountCallSheet();
}
function copyShareLink() {
  const el = $("shareLink");
  el.select();
  if (navigator.clipboard) navigator.clipboard.writeText(el.value).then(() => toast("Länk kopierad")).catch(() => {});
}
async function revokeShare() {
  if (!confirm("Ta bort delningslänken? Den slutar fungera direkt.")) return;
  await api("DELETE", `/api/projects/${state.project.id}/share`);
  state.project.share_token = null;
  closeOv("ovShare");
  toast("Delning borttagen");
  remountCallSheet();
}
function csMountOpts() {
  return {
    onChange: () => { markDirty("callsheet"); DPR.refreshDpr(); },
    castRoster: () => state.stripboard.cast || [],
    shareUrl: shareUrlFor(),
    onDayChange: (d) => { state.activeCsDayLabel = d.label; updateDocTitle(); },
    logoUrl: (state.site && state.site.hasLogo) ? ("/logo?v=" + state.logoVer) : null,
    companyName: (state.site && state.site.company && state.site.company.name) || "",
    toast
  };
}
function remountCallSheet() {
  CS.mount($("tab-callsheet"), state.callsheet, csMountOpts());
}

function mountStripboard() {
  SB.mount($("tab-stripboard"), state.stripboard, {
    onChange: () => { markDirty("stripboard"); SC.refreshSides(); SC.refreshRullplan(); },
    onCallSheet: onCallSheetFromStripboard,
    toast
  });
}
/* Efter en ångra: rita om stripboardet från det nya state.stripboard och
   låt de härledda vyerna (Dagsmanus, Rullplan, DPR) spegla det. */
function remountStripboard() {
  mountStripboard();
  SC.refreshSides();
  SC.refreshRullplan();
  DPR.refreshDpr();
}

/* ---------- start ---------- */
async function init() {
  $("loginForm").addEventListener("submit", doLogin);
  document.querySelectorAll("#isMode .radio-card").forEach(c => {
    c.addEventListener("click", () => {
      state.importStripsMode = c.dataset.mode;
      document.querySelectorAll("#isMode .radio-card").forEach(x => x.classList.toggle("sel", x === c));
    });
  });
  document.querySelectorAll(".overlay").forEach(o =>
    o.addEventListener("click", e => { if (e.target === o) o.classList.remove("open"); }));
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") document.querySelectorAll(".overlay.open").forEach(o => o.classList.remove("open"));
    if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); if (state.project) flushSave(); }
    if ((e.metaKey || e.ctrlKey) && (e.key === "z" || e.key === "Z") && !e.shiftKey && !e.altKey) {
      /* Står markören i ett redigerbart fält sköter webbläsaren sin egen
         text-ångra -- vi lägger oss bara i annars, och bara på de två
         flikar där ångra betyder något. */
      const ae = document.activeElement;
      if (ae && (ae.isContentEditable || /^(input|textarea|select)$/i.test(ae.tagName))) return;
      if (!state.project || (state.tab !== "stripboard" && state.tab !== "callsheet")) return;
      e.preventDefault();
      undoDoc(state.tab);
    }
  });

  registerServiceWorker();
  await loadSite();

  const me = await api("GET", "/api/me").catch(() => ({ authed: false }));
  if (!me.authed) return showLogin();
  showApp();
  const m = location.pathname.match(/^\/p\/(\d+)/);
  await loadProjects();
  if (m) {
    try { await openProject(parseInt(m[1], 10)); return; } catch (e) { /* projektet finns inte längre */ }
  }
  await goProjects();
}

document.addEventListener("DOMContentLoaded", init);

return {
  goProjects, openProject, openNewProject, createProject, renameProject, duplicateProject, deleteProject,
  setTab, openVersions, openSaveVersion, saveVersion, restoreVersion, renameVersion, deleteVersion, downloadVersion,
  exportProject, openImportProject, importProject, openImportStrips, stripsFromManus, importStripsFile, stripboardFromManus,
  openSiteSettings, saveSiteSettings, uploadLogo, removeLogo,
  openProjectSettings, saveProjectSettings,
  openShare, copyShareLink, revokeShare,
  openCast, addCastMember, editCastMember, removeCastMember, logout, closeOv, toast,
  reloadAfterConflict, overwriteAfterConflict
};
})();
