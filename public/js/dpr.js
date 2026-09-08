/* DPR-modul (Daglig produktionsrapport). Exponeras som window.DPR.
   Ett eget dokument, en post per inspelningsdag -- till skillnad från
   Dagsmanus/Rullplan som räknas om varje gång, är DPR:s scenlista en
   ögonblicksbild tagen vid genereringstillfället (samma princip som Call
   sheet redan använder mot stripboardet): den frusna planen för dagen,
   inte ett levande facit som ändras om call sheeten redigeras i efterhand.

   Källa: call sheeten (inte stripboardet) -- DPR:s hela poäng är att
   jämföra verkligheten mot den plan som faktiskt gick ut till
   besättningen den dagen, inte mot ett schema som kan ha ändrats sedan
   dess. Se motivering i projektminnet/chatten 2026-08-31.

   MVP-omfång (första byggomgången, enligt beslut): scen-avbockning
   (klar/delvis/flyttad) + sidor tagna + faktiska tider (call/first shot/
   lunch/wrap). Filmlagerlogg (rullar/exponering, jämfört mot Rullplans
   budget), förseningsspårning och incidentanteckningar är medvetet
   uteslutna än så länge -- kommer i en senare omgång.

   Internt bara -- INTE med i den publika delade vyn (innehåller
   förseningsorsaker/kostnadsavvikelser som inte är för alla). */
"use strict";
window.DPR = (function () {

let DATA = null;
let root = null;
let opts = { onChange() {}, toast() {}, getCallsheet: () => ({ production: {}, days: [] }), getScript: () => ({ scenes: [] }), onScriptChange() {} };
let readOnly = false;
let activeDay = 0;
let editMode = false;

function notify() { opts.onChange(DATA); }
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

function emptyDpr() {
  return { id: null, projectId: null, days: [] };
}

/* ===== koppling mot call sheeten ===== */
function findDayIndexByLabel(label) {
  return (DATA.days || []).findIndex(d => d.label === label);
}

/* Tar en ögonblicksbild av call sheetens dag -- scenlista, planerade tider,
   planerad väderprognos -- som startpunkt för dagens rapport. Kör man om
   detta på en redan existerande DPR-dag frågas det innan den ersätts,
   precis som call sheetens egen "skapa från stripboard"-knapp gör. */
function generateFromCallsheet(csDayIndex) {
  if (readOnly) return;
  const cs = opts.getCallsheet() || {};
  const csDay = (cs.days || [])[csDayIndex];
  if (!csDay) return;

  const existingIdx = findDayIndexByLabel(csDay.label);
  if (existingIdx >= 0 && !confirm(`Det finns redan en rapport för ${csDay.label}. Ersätta scenlistan med call sheetens nuvarande version? (Ifyllda status/sidor/tider för scener som finns kvar bevaras.)`)) {
    return;
  }

  const oldScenes = existingIdx >= 0 ? DATA.days[existingIdx].scenes : [];
  const oldByNum = {};
  const oldInfoByPos = {};
  oldScenes.forEach((s, i) => {
    if (s.type === "info") oldInfoByPos[i] = s;
    else if (s.num) oldByNum[s.num] = s;
  });

  /* Behåll alla rader i call sheetens ordning -- scener OCH lunch/förflyttning
     (type:"info") -- så Inspelningsläget kan gå igenom dem som egna steg.
     "total"-raden hoppas över. Klassiska DPR-vyn renderar bara scenraderna.
     Faktiska tider och +10/+20-slip lever per rad (actualStart/actualEnd/
     slipMin) och används av Inspelningsläget. */
  const scenes = (csDay.scenes || []).filter(s => s.type !== "total").map((s, i) => {
    if (s.type === "info") {
      const prev = oldInfoByPos[i];
      return {
        type: "info",
        label: s.label || s.set || "Info", est: s.est || "", time: s.time || s.start || "",
        kind: s.kind || "",
        status: (prev && prev.status) || "",
        actualStart: (prev && prev.actualStart) || "",
        actualEnd: (prev && prev.actualEnd) || "",
        slipMin: (prev && prev.slipMin) || 0,
        note: (prev && prev.note) || ""
      };
    }
    const prev = s.num ? oldByNum[s.num] : null;
    return {
      type: "scene",
      num: s.num, ie: s.ie, set: s.set, dn: s.dn, pages: s.pages, est: s.est, start: s.start || "",
      status: (prev && prev.status) || "",
      pagesShot: (prev && prev.pagesShot) || "",
      actualStart: (prev && prev.actualStart) || "",
      actualEnd: (prev && prev.actualEnd) || "",
      slipMin: (prev && prev.slipMin) || 0,
      note: (prev && prev.note) || ""
    };
  });

  const dayObj = {
    label: csDay.label,
    date: csDay.date,
    date_iso: csDay.date_iso,
    plannedCrewCall: csDay.gcall || "",
    plannedFirstShot: csDay.forsta_bild || "",
    plannedWrapEnd: (String(csDay.arbetstid || "").split("–")[1] || "").trim(),
    plannedWeatherIcon: csDay.weather_icon || "",
    plannedWeatherTemp: csDay.weather_temp || "",
    times: existingIdx >= 0 ? DATA.days[existingIdx].times : { crewCall: "", firstShot: "", lunchOut: "", lunchIn: "", campWrap: "", cameraWrap: "" },
    weatherActual: existingIdx >= 0 ? DATA.days[existingIdx].weatherActual : { icon: "", temp: "", note: "" },
    notes: existingIdx >= 0 ? DATA.days[existingIdx].notes : "",
    currentIdx: existingIdx >= 0 ? (DATA.days[existingIdx].currentIdx || 0) : 0,
    scenes
  };

  if (existingIdx >= 0) { DATA.days[existingIdx] = dayObj; activeDay = existingIdx; }
  else { DATA.days.push(dayObj); activeDay = DATA.days.length - 1; }

  notify();
  renderDpr();
  opts.toast(existingIdx >= 0 ? `${csDay.label} uppdaterad` : `Rapport skapad för ${csDay.label}`);
}

/* ===== fältsparning ===== */
function saveTime(el, di, key) {
  if (readOnly) return;
  DATA.days[di].times[key] = el.innerText.trim();
  notify();
}
function saveWeatherActual(el, di, key) {
  if (readOnly) return;
  DATA.days[di].weatherActual[key] = el.innerText.trim();
  notify();
}
function saveDayNotes(el, di) {
  if (readOnly) return;
  DATA.days[di].notes = el.innerText.trim();
  notify();
}
function saveScenePagesShot(el, di, si) {
  if (readOnly) return;
  DATA.days[di].scenes[si].pagesShot = el.innerText.trim();
  notify();
}
function saveSceneNote(el, di, si) {
  if (readOnly) return;
  DATA.days[di].scenes[si].note = el.innerText.trim();
  notify();
}
/* Skrivs till manus-scenen (via scennummer), inte till DPR-doket -- samma
   fält Rullplan använder. onScriptChange() markerar script-doket smutsigt. */
function saveSceneNegActual(el, di, si) {
  if (readOnly) return;
  const num = DATA.days[di].scenes[si].num;
  const scr = opts.getScript() || null;
  if (!scr || !Array.isArray(scr.scenes)) return;
  const s = scr.scenes.find(x => x.number === num);
  if (!s) { opts.toast("Scenen finns inte i manuset — kan inte spara neg-utfall"); return; }
  const raw = el.innerText.trim().replace(",", ".");
  const n = raw === "" ? null : parseFloat(raw);
  s.negActualMin = (n == null || isNaN(n)) ? null : n;
  opts.onScriptChange();
}
function setSceneStatus(di, si, status) {
  if (readOnly || !editMode) return;
  const sc = DATA.days[di].scenes[si];
  if (!sc || sc.type === "info") return;
  sc.status = sc.status === status ? "" : status; // klicka igen för att avmarkera
  /* Bekvämlighet: markerar man en scen som klar och ingen sidsiffra är
     ifylld än, förifyll med schemalagd sidlängd -- man justerar hellre
     ett fel värde än skriver in samma sak 30 gånger. */
  if (sc.status === "done" && !sc.pagesShot) sc.pagesShot = sc.pages;
  notify();
  rerenderDay();
}
function markAllDone(di) {
  if (readOnly || !editMode) return;
  DATA.days[di].scenes.forEach(sc => {
    if (sc.type === "info") return;
    if (!sc.status) {
      sc.status = "done";
      if (!sc.pagesShot) sc.pagesShot = sc.pages;
    }
  });
  notify();
  rerenderDay();
}

function toggleEdit(on) {
  if (readOnly) return;
  editMode = on;
  root.classList.toggle("edit-mode", on);
  const out = root.querySelector('[data-dpr="output"]');
  if (out) setEditable(out);
}
function setEditable(container) {
  container.querySelectorAll(".editable").forEach(el => el.setAttribute("contenteditable", editMode ? "true" : "false"));
}

/* ===== rendering ===== */
const STATUS_LABEL = { done: "✓ Klar", partial: "◐ Delvis", moved: "→ Flyttad", cut: "✕ Struken" };

function timeRow(di, key, label, plannedVal) {
  const val = (DATA.days[di].times || {})[key] || "";
  return `
    <div class="dpr-time-row">
      <span class="dpr-time-label">${esc(label)}</span>
      <span class="dpr-time-planned">${esc(plannedVal || "—")}</span>
      <span class="editable dpr-time-val" contenteditable="false" data-ph="00:00" onblur="DPR.saveTime(this,${di},'${key}')">${esc(val)}</span>
    </div>`;
}

function sceneCard(di, si, sc) {
  const statusCls = sc.status ? ` dpr-scene-${sc.status}` : "";
  const btns = ["done", "partial", "moved", "cut"].map(st => `
    <button type="button" class="dpr-status-btn dpr-status-${st}${sc.status === st ? " active" : ""}"
      onclick="DPR.setSceneStatus(${di},${si},'${st}')">${STATUS_LABEL[st]}</button>
  `).join("");
  /* Neg-utfall bor på manus-scenen (Rullplan äger fältet) -- vi läser/skriver
     samma ställe via scennumret, så det man knappar in vid wrap syns direkt
     i Rullplans utfallskolumn. */
  const scrScene = ((opts.getScript() || {}).scenes || []).find(x => x.number === sc.num);
  const negActual = scrScene && scrScene.negActualMin != null ? scrScene.negActualMin : null;
  return `
    <div class="dpr-scene-card${statusCls}">
      <div class="dpr-scene-head">
        <span class="dpr-scene-num">${esc(sc.num || "?")}</span>
        <span class="dpr-scene-ie">${esc(sc.ie || "")}</span>
        <span class="dpr-scene-set">${esc(sc.set || "")}</span>
      </div>
      <div class="dpr-scene-status-row">${btns}</div>
      <div class="dpr-scene-pages-row">
        <span class="dpr-scene-pages-label">Sidor tagna</span>
        <span class="editable dpr-scene-pages-val" contenteditable="false" data-ph="${esc(sc.pages || "0")}" onblur="DPR.saveScenePagesShot(this,${di},${si})">${esc(sc.pagesShot || "")}</span>
        <span class="dpr-scene-pages-planned">av ${esc(sc.pages || "0")} planerat</span>
      </div>
      <div class="dpr-scene-pages-row">
        <span class="dpr-scene-pages-label">Neg rullat</span>
        <span class="editable dpr-scene-pages-val" contenteditable="false" data-ph="min" onblur="DPR.saveSceneNegActual(this,${di},${si})">${negActual != null ? esc(String(negActual)) : ""}</span>
        <span class="dpr-scene-pages-planned">min · synkas med Rullplan</span>
      </div>
      <div class="editable dpr-scene-note" contenteditable="false" data-ph="Anteckning om scenen (valfritt)" onblur="DPR.saveSceneNote(this,${di},${si})">${esc(sc.note || "")}</div>
    </div>`;
}

function renderDay(di) {
  const d = DATA.days[di];
  const realScenes = d.scenes.filter(s => s.type !== "info");
  const scenesDone = realScenes.filter(s => s.status === "done").length;
  const pagesShotTotal = realScenes.reduce((a, s) => a + (window.SB ? SB.parsePages(s.pagesShot) : 0), 0);
  const pagesPlannedTotal = realScenes.reduce((a, s) => a + (window.SB ? SB.parsePages(s.pages) : 0), 0);
  const fmtP = (e) => (window.SB && SB.fmtPages) ? (SB.fmtPages(e) || "0/8") : e;

  return `
    <div class="dpr-summary">
      <span>${scenesDone} av ${realScenes.length} scener klara</span> ·
      <span>${fmtP(pagesShotTotal)} av ${fmtP(pagesPlannedTotal)} sidor tagna</span>
    </div>

    <div class="dpr-section">
      <div class="dpr-section-head">
        <h3>Tider</h3>
      </div>
      <div class="dpr-time-row dpr-time-header">
        <span></span>
        <span class="dpr-time-col-label">Plan</span>
        <span class="dpr-time-col-label">Faktiskt</span>
      </div>
      ${timeRow(di, "crewCall", "Crew call", d.plannedCrewCall)}
      ${timeRow(di, "firstShot", "Första tagning", d.plannedFirstShot)}
      ${timeRow(di, "lunchOut", "Lunch ut", "")}
      ${timeRow(di, "lunchIn", "Lunch in", "")}
      ${timeRow(di, "campWrap", "Wrap (inspelning)", d.plannedWrapEnd)}
      ${timeRow(di, "cameraWrap", "Wrap (kamera/rigg)", "")}
    </div>

    <div class="dpr-section">
      <div class="dpr-section-head">
        <h3>Scener</h3>
        ${readOnly ? "" : `<button class="btn btn-sm" onclick="App.openShootDay()">🎬 Inspelningsläge</button>`}
        ${readOnly || !editMode ? "" : `<button class="btn btn-sm ml-auto" onclick="DPR.markAllDone(${di})">Markera alla som klara</button>`}
      </div>
      <div class="dpr-scene-list">
        ${d.scenes.map((sc, si) => sc.type === "info" ? "" : sceneCard(di, si, sc)).join("") || `<p class="muted">Inga scener på den här dagens call sheet.</p>`}
      </div>
    </div>

    <div class="dpr-section">
      <div class="dpr-section-head"><h3>Anteckningar</h3></div>
      <div class="editable dpr-notes" contenteditable="false" data-ph="Allmänna anteckningar om dagen (valfritt)" onblur="DPR.saveDayNotes(this,${di})">${esc(d.notes || "")}</div>
    </div>

    <div class="dpr-section">
      <div class="dpr-section-head"><h3>Väder</h3></div>
      <div class="dpr-time-row">
        <span class="dpr-time-label">Faktiskt väder</span>
        <span class="editable dpr-time-val" contenteditable="false" data-ph="${esc((d.plannedWeatherIcon || "") + " " + (d.plannedWeatherTemp || "") || "Ange väder")}" onblur="DPR.saveWeatherActual(this,${di},'icon')">${esc(d.weatherActual.icon || "")}</span>
      </div>
      <div class="editable dpr-weather-note" contenteditable="false" data-ph="Övrig väderanteckning (valfritt)" onblur="DPR.saveWeatherActual(this,${di},'note')">${esc(d.weatherActual.note || "")}</div>
    </div>`;
}

function buildTabs() {
  const tabs = root.querySelector('[data-dpr="tabs"]');
  if (!tabs) return;
  tabs.innerHTML = "";
  DATA.days.forEach((d, i) => {
    const t = document.createElement("button");
    t.className = "day-tab" + (i === activeDay ? " active" : "");
    t.textContent = d.label;
    t.onclick = () => { activeDay = i; buildTabs(); rerenderDay(); };
    tabs.appendChild(t);
  });
}

function rerenderDay() {
  const out = root.querySelector('[data-dpr="output"]');
  if (!out) return;
  if (!DATA.days.length) {
    out.innerHTML = "";
    return;
  }
  activeDay = Math.max(0, Math.min(activeDay, DATA.days.length - 1));
  const _scrollY = (typeof window !== "undefined") ? window.scrollY : 0;
  out.innerHTML = renderDay(activeDay);
  if (typeof window !== "undefined" && window.scrollY !== _scrollY) window.scrollTo(0, _scrollY);
  root.classList.toggle("edit-mode", editMode);
  setEditable(out);
}

function renderDpr() {
  if (!root) return;
  const cs = opts.getCallsheet() || {};
  const csDays = cs.days || [];

  if (!csDays.length) {
    root.innerHTML = `
      <div class="dpr-page">
        <div class="page-head"><h2>DPR</h2></div>
        <div class="sc-import-empty">
          <p>Ingen call sheet skapad ännu — DPR genereras utifrån en dags call sheet.</p>
          ${readOnly ? "" : `<button class="btn btn-add" onclick="App.setTab('callsheet')">Gå till Call sheets-fliken →</button>`}
        </div>
      </div>`;
    return;
  }

  /* Dagsflikarna speglar call sheetens dagar (i den ordningen), inte bara
     de dagar som redan fått en genererad rapport -- annars finns ingen
     synlig ingång till att skapa en rapport för en ny dag. */
  const genButtons = csDays.map((csDay, csIdx) => {
    const has = findDayIndexByLabel(csDay.label) >= 0;
    if (readOnly && !has) return "";
    return `<button type="button" class="btn btn-sm" onclick="DPR.generateFromCallsheet(${csIdx})">${has ? "↻" : "+"} ${esc(csDay.label)}</button>`;
  }).filter(Boolean).join(" ");

  root.innerHTML = `
    <div class="dpr-page">
      <div class="page-head">
        <h2>DPR — daglig produktionsrapport</h2>
        <div class="ml-auto dpr-head-actions">
          ${readOnly ? "" : `
          <label class="edit-toggle">
            <span>Redigera</span>
            <label class="toggle">
              <input type="checkbox" data-dpr="edit"${editMode ? " checked" : ""} onchange="DPR.toggleEdit(this.checked)">
              <span class="slider"></span>
            </label>
          </label>`}
          <button class="btn btn-sm" onclick="window.print()">🖨 Skriv ut</button>
        </div>
      </div>
      <p class="dpr-intro">Internt dokument — inte med i den delade vyn. Genereras från en dags call sheet (fryser scenlistan vid genereringstillfället, precis som call sheeten själv görs från stripboardet); kör om knappen om schemat ändrats i efterhand.</p>
      ${!readOnly || genButtons ? `<div class="dpr-gen-row">${genButtons || "<span class=\"muted\">Inga rapporter att visa.</span>"}</div>` : ""}
      <div class="day-tabs" data-dpr="tabs"></div>
      <div data-dpr="output"></div>
    </div>`;

  buildTabs();
  rerenderDay();
}

function refreshDpr() { if (root) renderDpr(); }

function mount(el, data, options) {
  root = el;
  DATA = data || emptyDpr();
  if (!DATA.days) DATA.days = [];
  opts = Object.assign({ onChange() {}, toast() {}, getCallsheet: () => ({ production: {}, days: [] }), getScript: () => ({ scenes: [] }), onScriptChange() {} }, opts, options || {});
  if (options && options.readOnly) readOnly = true;
  renderDpr();
}
function unmount() { root = null; DATA = null; }
function getData() { return DATA; }

return {
  mount, unmount, getData, refreshDpr,
  generateFromCallsheet, saveTime, saveWeatherActual, saveDayNotes,
  saveScenePagesShot, saveSceneNote, saveSceneNegActual, setSceneStatus, markAllDone, toggleEdit
};
})();
