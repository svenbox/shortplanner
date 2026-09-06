/* Manus/Dagsmanus-modul. Exponeras som window.SC.
   Manus: importera manuset och visa det med koppling till planen.
   Dagsmanus: härlett direkt ur stripboarden + manuset varje gång det ritas om
   — inget eget tillstånd, ingen egen sortering. Flyttar man en strip i
   stripboardet är det stripboardets ordning som gäller nästa gång Dagsmanus
   ritas, aldrig en sparad kopia. */
"use strict";
window.SC = (function () {

let DATA = null;        // Script-objektet, delas mellan Manus-, Dagsmanus- och Rullplan-vyn
let root = null;        // Manus-tabbens rotelement
let sidesRoot = null;   // Dagsmanus-tabbens rotelement
let rullplanRoot = null; // Rullplan-tabbens rotelement
let opts = { onChange() {}, toast() {}, getStripboard: () => ({ production: {}, cast: [], days: [], unscheduled: [] }) };
let readOnly = false;
let activeSidesDay = 0;
let rullplanEdit = false; // Rullplan har ett eget redigeraläge (som DPR/call sheet)

function notify() { opts.onChange(DATA); }
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

/* ===== datamodell =====
   Script    = { id, projectId, title, draft, draftDate, source, importedAt,
                 targetLengthSec, scenes: ScriptScene[] }
     targetLengthSec = filmens måltid i sekunder (Rullplan), null tills satt.
   ScriptScene = { number, slugline, scriptPage, scriptPageEnd, body: ScriptLine[],
                   screenTimeSec? }
     number är STRÄNG ("35", "12A") — scennummer i produktion är inte heltal.
     screenTimeSec = manuellt satt skärmtid (Rullplan); saknas den visas ett
     föreslaget värde (måltid × scenens andel av total manuslängd) men inget
     sparas förrän man faktiskt skriver ett eget värde.
   ScriptLine  = { kind: action|character|dialogue|parenthetical|transition|shot|blank, text, revised? } */
function emptyScript() {
  return { id: null, projectId: null, title: "", draft: "", draftDate: "", source: null, importedAt: null, targetLengthSec: null, scenes: [] };
}

/* Kopplingen till stripen hålls lös — scennumret är joinnyckeln, inget annat. */
function sceneForNumber(num, script) {
  if (!script || !num) return null;
  const n = String(num);
  return (script.scenes || []).find(s => s.number === n) || null;
}

/* ===== Fountain-import =====
   Ren text. Scenrubrik: INT/EXT/EST/I-E-prefix, eller tvingad med inledande
   punkt. Ett explicit scennummer skrivs #35# sist på raden — Fountains egen
   konvention. Saknas det gissar vi inte, se "Gör inte" i uppdraget. */
const SCENE_HEAD_RE = /^(int|ext|est|i\/e|int\.\/ext)[.\s]/i;
const SCENE_NUM_RE = /#([^#\n]+)#\s*$/;

function parseFountain(text) {
  const rawLines = String(text).replace(/\r\n/g, "\n").split("\n");

  /* ev. title-page-block (Key: Value-rader längst upp, avslutas med tom rad) */
  let start = 0;
  if (rawLines.length && /^[A-Za-zÅÄÖåäö][A-Za-zÅÄÖåäö _-]*:\s?/.test(rawLines[0])) {
    let i = 0;
    while (i < rawLines.length && rawLines[i].trim() !== "") i++;
    start = i + 1;
  }
  const lines = rawLines.slice(start);

  const scenes = [];
  let current = null;
  let inDialogueBlock = false;

  function pushLine(kind, txt, revised) {
    if (!current) return;
    const line = { kind, text: txt };
    if (revised) line.revised = true;
    current.body.push(line);
  }

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    const trimmed = line.trim();

    if (SCENE_HEAD_RE.test(trimmed) || /^\.[A-ZÅÄÖ0-9]/.test(trimmed)) {
      if (current) scenes.push(current);
      let heading = trimmed.replace(/^\./, "");
      let number = null;
      const numMatch = heading.match(SCENE_NUM_RE);
      if (numMatch) { number = numMatch[1].trim(); heading = heading.replace(SCENE_NUM_RE, "").trim(); }
      current = { number, slugline: heading, scriptPage: null, scriptPageEnd: null, body: [] };
      inDialogueBlock = false;
      continue;
    }
    if (!current) continue; // text före första scenrubriken (t.ex. kvarglömd titelsida) ignoreras

    if (trimmed === "") { pushLine("blank", ""); inDialogueBlock = false; continue; }

    let revised = false;
    let content = trimmed;
    if (content.endsWith("*") && !content.endsWith("**")) { revised = true; content = content.slice(0, -1).trim(); }

    const isAllCaps = content === content.toUpperCase() && /[A-ZÅÄÖ]/.test(content);
    if (isAllCaps && (content.startsWith(">") || /(TO|TILL):$/.test(content))) {
      pushLine("transition", content.replace(/^>\s*/, ""), revised);
      inDialogueBlock = false;
      continue;
    }
    if (isAllCaps && !inDialogueBlock && content.length < 60) {
      pushLine("character", content, revised);
      inDialogueBlock = true;
      continue;
    }
    if (inDialogueBlock && /^\(.*\)$/.test(content)) {
      pushLine("parenthetical", content, revised);
      continue;
    }
    if (inDialogueBlock) {
      pushLine("dialogue", content, revised);
      continue;
    }
    pushLine("action", content, revised);
  }
  if (current) scenes.push(current);
  return scenes;
}

/* Hål i den rena heltalsserien (12A/12B räknas som 12, en bokstavssvit
   maskerar inte ett hål på det egna heltalet eftersom scenen ändå finns). */
function findHoles(numbers) {
  const ints = numbers.map(n => parseInt(n, 10)).filter(n => !isNaN(n));
  if (!ints.length) return [];
  const min = Math.min(...ints), max = Math.max(...ints);
  const have = new Set(ints);
  const holes = [];
  for (let n = min; n <= max; n++) if (!have.has(n)) holes.push(n);
  return holes;
}

/* ===== koppling till planen ===== */
function buildPlanIndex(stripboard) {
  const index = {};
  (stripboard.days || []).forEach((day) => {
    (day.strips || []).forEach(s => {
      if (s.type === "scene" && s.num) index[String(s.num)] = { status: "scheduled", dayLabel: day.label, start: s.start };
    });
  });
  (stripboard.unscheduled || []).forEach(s => {
    if (s.type === "scene" && s.num && !index[String(s.num)]) index[String(s.num)] = { status: "boneyard" };
  });
  return index;
}
function shortDayLabel(label) {
  const m = String(label || "").match(/Dag\s*\d+/i);
  return m ? m[0] : label;
}
function planStatus(number, planIndex) {
  if (!number) return { text: "inget scennummer i manuset", cls: "sc-missing" };
  const entry = planIndex[number];
  if (!entry) return { text: "saknas i planen", cls: "sc-missing" };
  if (entry.status === "boneyard") return { text: "boneyard", cls: "sc-boneyard" };
  return { text: `${shortDayLabel(entry.dayLabel)}, ${entry.start}`, cls: "sc-scheduled" };
}

/* ===== gemensam radrendering (Manus-vyn och Dagsmanus-scenblock) ===== */
function renderScriptLine(line) {
  if (line.kind === "blank") return `<div class="sl-blank"></div>`;
  const revisedMark = line.revised ? `<span class="sl-revised">*</span>` : "";
  return `<div class="sl-${line.kind}">${esc(line.text)}${revisedMark}</div>`;
}
function renderScriptBody(lines) {
  return `<div class="sc-body">${(lines || []).map(renderScriptLine).join("")}</div>`;
}

/* ===== Manus-fliken ===== */
function renderManus() {
  if (!root) return;
  const stripboard = opts.getStripboard() || {};
  const planIndex = buildPlanIndex(stripboard);
  const hasScript = DATA && DATA.scenes && DATA.scenes.length;
  const importBtn = readOnly ? "" : `
    <input type="file" id="scImportFile" accept=".pdf,.fountain,.txt" style="display:none" onchange="SC.handleImport(this)">
    <button class="btn ${hasScript ? "" : "btn-add"}" onclick="document.getElementById('scImportFile').click()">
      ${hasScript ? "Importera nytt manus" : "Importera manus (PDF eller .fountain)"}
    </button>`;

  if (!hasScript) {
    root.innerHTML = `
      <div class="sc-page">
        <div class="page-head"><h2>Manus</h2></div>
        <div class="sc-import-empty">
          <p>Inget manus importerat ännu.</p>
          ${importBtn}
        </div>
      </div>`;
    return;
  }

  const numbered = DATA.scenes.filter(s => s.number);
  const holes = findHoles(numbered.map(s => s.number));
  const scheduled = numbered.filter(s => (planIndex[s.number] || {}).status === "scheduled").length;
  const boneyard = numbered.filter(s => (planIndex[s.number] || {}).status === "boneyard").length;
  const missing = numbered.filter(s => !planIndex[s.number]).length;

  root.innerHTML = `
    <div class="sc-page">
      <div class="page-head">
        <h2>${esc(DATA.title || "Manus")}</h2>
        <span class="sc-draft">${esc(DATA.draft || "")} ${esc(DATA.draftDate || "")}</span>
        <div class="ml-auto">${importBtn}</div>
      </div>
      <div class="sc-summary">
        <span>${DATA.scenes.length} scener</span> · <span>${scheduled} schemalagda</span> ·
        <span>${boneyard} i boneyard</span> ·
        <span class="${missing > 0 ? "sc-warn" : ""}">${missing} saknas i planen</span>
      </div>
      ${readOnly ? "" : `<div class="sc-actions">
        <button class="btn ${missing === DATA.scenes.length ? "btn-add" : ""}" onclick="App.stripboardFromManus()" title="Skapar en strip per scen i stripboardets 'Ej schemalagt'">↳ Skapa stripboard av scenerna</button>
      </div>`}
      ${holes.length ? `<div class="sc-hole-warning">⚠️ Hål i nummerserien: ${holes.join(", ")} saknas. Troligen ett parserfel, inte ett manusfel — kontrollera innan ni går vidare.</div>` : ""}
      <div class="sc-scene-list">
        ${DATA.scenes.map(sc => renderManusScene(sc, planIndex)).join("")}
      </div>
    </div>`;
}

function renderManusScene(sc, planIndex) {
  const status = planStatus(sc.number, planIndex);
  const pageTxt = sc.scriptPage ? `manussida ${sc.scriptPage}${sc.scriptPageEnd && sc.scriptPageEnd !== sc.scriptPage ? "–" + sc.scriptPageEnd : ""}` : "";
  return `
    <div class="sc-scene">
      <div class="sc-scene-head">
        <span class="sc-scene-num">SCEN ${esc(sc.number || "?")}</span>
        <span class="sc-scene-slug">${esc(sc.slugline)}</span>
        <span class="sc-scene-page">${esc(pageTxt)}</span>
        <span class="sc-scene-status ${status.cls}">▸ ${esc(status.text)}</span>
      </div>
      ${renderScriptBody(sc.body)}
    </div>`;
}

/* ===== PDF-import =====
   Textlagret finns i PDF:en, men indraget bär betydelsen — en numrerad
   tagningslista har scennumret både i vänster- och högermarginalen på
   rubrikraden: "35   INT. MUSIKER I EN LADA - DAG   35". Revisionsasterisken
   hänger efter det andra numret och bryter annars matchningen. Sidnummer
   står ensamma på en rad högst upp — de filtreras ur brödtexten men värdet
   sparas som scriptPage/scriptPageEnd. */
const PDF_SCENE_HEAD_RE = /^(\d{1,3}[A-Z]{0,2})\s+(.*?)\s+\1(\s*\*)?\s*$/;
const PDF_PAGE_NUM_RE = /^\s*\d{1,3}\.\s*$/;

async function extractPdfLines(arrayBuffer) {
  if (!window.pdfjsLib) throw new Error("PDF-motorn (pdf.js) kunde inte laddas.");
  if (!window.pdfjsLib.GlobalWorkerOptions.workerSrc) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = "/js/vendor/pdf.worker.min.js";
  }
  const doc = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const items = content.items
      .map(it => ({ text: it.str, x: it.transform[4], y: it.transform[5], width: it.width || 0 }))
      .filter(it => it.text !== "");
    const Y_TOL = 2;
    const lines = [];
    items.forEach(it => {
      let line = lines.find(l => Math.abs(l.y - it.y) <= Y_TOL);
      if (!line) { line = { y: it.y, x: it.x, parts: [] }; lines.push(line); }
      line.parts.push(it);
      line.x = Math.min(line.x, it.x);
    });
    lines.sort((a, b) => b.y - a.y);
    /* Separata textkörningar på samma rad (t.ex. rubrikens vänster- och
       högernummer) hänger ihop i PDF:ens positioneringsström utan mellanslag
       — sätt in ett om det är ett verkligt glapp mellan föregående körnings
       slut och nästa körnings start, annars smälter "...DAG" och "34" ihop
       till "DAG34". */
    const GAP_TOL = 2;
    const textLines = lines
      .map(l => {
        const parts = l.parts.sort((a, b) => a.x - b.x);
        let text = "";
        let prevEnd = null;
        parts.forEach(p => {
          if (prevEnd != null && p.x - prevEnd > GAP_TOL && !/\s$/.test(text) && !/^\s/.test(p.text)) text += " ";
          text += p.text;
          prevEnd = p.x + p.width;
        });
        return { text: text.replace(/\s+/g, " ").trim(), x: l.x };
      })
      .filter(l => l.text !== "");
    pages.push({ pageNum: p, lines: textLines });
  }
  return pages;
}

/* Vänstermarginalerna klustras för att gissa radtyp (rubrik/dialog/karaktär/
   parentes) — screenplay-layout signalerar elementtyp via indrag, inte
   genom formatering. Fungerar bäst på en konsekvent formaterad tagningslista;
   avvikande layouter kan behöva justerad marginal-tolerans. */
function buildMarginClusters(pages) {
  const margins = [];
  pages.forEach(pg => pg.lines.forEach(l => {
    if (PDF_PAGE_NUM_RE.test(l.text) || PDF_SCENE_HEAD_RE.test(l.text)) return;
    margins.push(Math.round(l.x));
  }));
  const uniq = [...new Set(margins)].sort((a, b) => a - b);
  const clusters = [];
  uniq.forEach(m => {
    const last = clusters[clusters.length - 1];
    if (last && m - last.max <= 10) last.max = m;
    else clusters.push({ min: m, max: m });
  });
  return clusters;
}
function marginLevel(clusters, x) {
  const idx = clusters.findIndex(c => x >= c.min - 5 && x <= c.max + 5);
  return idx < 0 ? 0 : idx;
}
/* Innehållet är den robusta signalen (TO:/TILL: = transition, parenteser =
   parenthetical, versaler = karaktär) — vänstermarginalen avgör bara
   action (helt oindragen) mot allt annat. Att gissa "sista klustret =
   transition" positionellt är skört: saknas transitions helt i den delen
   av manuset blir karaktärsnamnet (ofta det mest indragna elementet)
   felklassat, vilket hände i tester. */
function kindForLevel(level, numLevels, content, isAllCaps) {
  if (isAllCaps && /(TO|TILL):\s*$/.test(content)) return "transition";
  if (/^\(.*\)$/.test(content)) return "parenthetical";
  if (level === 0) return "action";
  if (isAllCaps && content.length < 40) return "character";
  return "dialogue";
}

function parsePdfScenes(pages) {
  const clusters = buildMarginClusters(pages);
  const scenes = [];
  let current = null;
  let lastPage = 1;

  pages.forEach(pg => {
    lastPage = pg.pageNum;
    pg.lines.forEach(l => {
      const text = l.text;
      if (PDF_PAGE_NUM_RE.test(text)) return;

      const headMatch = text.match(PDF_SCENE_HEAD_RE);
      if (headMatch) {
        if (current) { current.scriptPageEnd = pg.pageNum; scenes.push(current); }
        current = {
          number: headMatch[1].trim(),
          slugline: headMatch[2].trim(),
          scriptPage: pg.pageNum,
          scriptPageEnd: pg.pageNum,
          body: []
        };
        return;
      }
      if (!current) return;

      let revised = false;
      let content = text;
      if (content.endsWith("*")) { revised = true; content = content.slice(0, -1).trim(); }
      const isAllCaps = content === content.toUpperCase() && /[A-ZÅÄÖ]/.test(content);
      const level = marginLevel(clusters, l.x);
      const kind = kindForLevel(level, clusters.length, content, isAllCaps);
      const line = { kind, text: content };
      if (revised) line.revised = true;
      current.body.push(line);
    });
  });
  if (current) { current.scriptPageEnd = lastPage; scenes.push(current); }
  return scenes;
}

/* ===== gemensamt för båda importformaten ===== */
function confirmAndApplyImport(scenes, source, input) {
  if (!scenes.length) {
    alert("Hittade inga scener i filen." + (source === "pdf" ? " Kontrollera att scenrubriker har scennumret i både vänster- och högermarginalen (t.ex. \"35   INT. ... - DAG   35\")." : " Kontrollera att scenrubriker börjar med INT./EXT."));
    if (input) input.value = "";
    return;
  }
  const numbered = scenes.filter(s => s.number);
  const withoutNumber = scenes.length - numbered.length;
  const holes = findHoles(numbered.map(s => s.number));

  let msg = `${scenes.length} scener importerade.`;
  msg += holes.length
    ? `\n\n⚠️ Hål i nummerserien: ${holes.join(", ")} saknas.`
    : (numbered.length ? `\n\nNummerserien är komplett. Inga hål.` : "");
  if (withoutNumber) msg += `\n\n${withoutNumber} scen(er) saknar scennummer helt — kopplingen till planen blir tom för dem.`;
  msg += DATA && DATA.scenes && DATA.scenes.length
    ? "\n\nDetta ersätter hela det tidigare importerade manuset. Fortsätta?"
    : "\n\nFortsätta?";
  if (!confirm(msg)) { if (input) input.value = ""; return; }

  /* Muterar DATA på plats (istället för att byta ut hela objektet) så att
     referensen appen fick vid mount() förblir giltig -- annars tappar
     appens state.script kopplingen till den nya importen och sparar
     kvar den gamla (tomma) versionen vid nästa flushSave. */
  if (!DATA) DATA = emptyScript();
  DATA.source = source;
  DATA.importedAt = new Date().toISOString();
  DATA.scenes = scenes;
  notify();
  renderManus();
  if (sidesRoot) renderSides();
  opts.toast("Manus importerat: " + scenes.length + " scener");
  if (input) input.value = "";
}

function handleImport(input) {
  if (readOnly) return;
  const file = input.files && input.files[0];
  if (!file) return;
  const isPdf = /\.pdf$/i.test(file.name) || file.type === "application/pdf";

  if (isPdf) {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const pages = await extractPdfLines(reader.result);
        const scenes = parsePdfScenes(pages);
        confirmAndApplyImport(scenes, "pdf", input);
      } catch (e) {
        alert("Kunde inte tolka PDF-filen: " + e.message);
        input.value = "";
      }
    };
    reader.onerror = () => { alert("Kunde inte läsa filen."); input.value = ""; };
    reader.readAsArrayBuffer(file);
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    let scenes;
    try { scenes = parseFountain(reader.result); }
    catch (e) { alert("Kunde inte tolka filen: " + e.message); input.value = ""; return; }
    confirmAndApplyImport(scenes, "fountain", input);
  };
  reader.onerror = () => { alert("Kunde inte läsa filen."); input.value = ""; };
  reader.readAsText(file, "utf-8");
}

/* ===== Dagsmanus-fliken =====
   Härlett live ur stripboarden + manuset. Renderas om varje gång man byter
   dag, varje gång stripboardet ändras (via opts.onChange-kedjan i app.js)
   och varje gång fliken öppnas — aldrig ur ett eget sparat tillstånd. */
function renderSides() {
  if (!sidesRoot) return;
  const stripboard = opts.getStripboard() || {};
  const days = stripboard.days || [];

  if (!days.length) {
    sidesRoot.innerHTML = `<div class="sc-page"><div class="page-head"><h2>Dagsmanus</h2></div><div class="sc-import-empty"><p>Inga inspelningsdagar i stripboardet ännu.</p></div></div>`;
    return;
  }
  activeSidesDay = Math.max(0, Math.min(activeSidesDay, days.length - 1));

  const tabsHtml = days.map((d, i) =>
    `<button class="day-tab${i === activeSidesDay ? " active" : ""}" onclick="SC.setSidesDay(${i})">${esc(d.label)}</button>`
  ).join("");

  const hasScript = DATA && DATA.scenes && DATA.scenes.length;
  if (!hasScript) {
    sidesRoot.innerHTML = `
      <div class="sc-page">
        <div class="page-head"><h2>Dagsmanus</h2></div>
        <div class="day-tabs">${tabsHtml}</div>
        <div class="sc-import-empty">
          <p>Inget manus importerat ännu — dagsmanus kan inte genereras.</p>
          ${readOnly ? "" : `<button class="btn btn-add" onclick="App.setTab('manus')">Gå till Manus-fliken →</button>`}
        </div>
      </div>`;
    return;
  }

  const day = days[activeSidesDay];
  const scriptByNum = {};
  DATA.scenes.forEach(s => { if (s.number) scriptByNum[s.number] = s; });

  sidesRoot.innerHTML = `
    <div class="sc-page">
      <div class="page-head"><h2>Dagsmanus</h2><button class="btn ml-auto" onclick="window.print()">🖨 Skriv ut</button></div>
      <div class="day-tabs">${tabsHtml}</div>
      <div class="sides-doc">
        ${renderSidesCover(day, activeSidesDay, days, stripboard, scriptByNum)}
        <div class="sc-scene-blocks">
          ${day.strips.filter(s => s.type === "scene").map(s => renderSceneBlock(s, scriptByNum)).join("")}
        </div>
      </div>
    </div>`;
}

function setSidesDay(i) { activeSidesDay = i; renderSides(); }
function refreshSides() { if (sidesRoot) renderSides(); }
function refreshManus() { if (root) renderManus(); }

/* ===== Rullplan =====
   Post-produktionens skärmtidsbudget: hur lång varje scen ska bli i det
   färdiga klippet, och vad det kostar i negativ/rullar givet ett
   skjutförhållande. Skärmtid är ett kreativt, manuellt fält (kolumn G i
   uppdragets förlaga styr allt annat) — föreslås proportionellt mot scenens
   andel av manusets totala sidlängd tills man skriver in ett eget värde.
   Efterrapportering (exponerat/diff/rulle nr) och redaktionella fält
   (klippenhet, roller, anteckning) är medvetet uteslutna, se DPR istället. */
const DEFAULT_SHOOTING_RATIO = 14; // skjutförhållande neg:färdig film — kan sättas per projekt (DATA.shootingRatio)
const REEL_CAPACITY_MIN = 11;   // minuter per rulle
const DEFAULT_TARGET_SEC = 15 * 60; // måltid tills något annat skrivs in

function fmtMSS(sec) {
  sec = Math.round(sec || 0);
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
function parseMSS(str) {
  const s = String(str || "").trim();
  const m = s.match(/^(\d+):(\d{1,2})$/);
  if (m) return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  const n = s.match(/^\d+$/);
  return n ? parseInt(s, 10) : null;
}

/* Bygger en rad per manusscen, taggad med var den hör hemma: schemalagd
   dag, boneyard, eller helt saknad i planen. `order` är scenens plats i
   stripboardets faktiska inspelningsordning för den dagen (inte
   manusordning) -- annars sorteras dagens rader i scennummerordning i
   renderRullplan(), vilket inte stämmer med den kronologiska ordning
   call sheeten (och verkligheten) visar. */
function buildRullplanRows(stripboard) {
  const stripByNum = {};
  const dayOfNum = {};
  (stripboard.days || []).forEach((day, di) => {
    let order = 0;
    (day.strips || []).forEach(s => {
      if (s.type === "scene" && s.num) {
        stripByNum[s.num] = s;
        dayOfNum[s.num] = { dayIndex: di, dayLabel: day.label, order: order++ };
      }
    });
  });
  (stripboard.unscheduled || []).forEach(s => {
    if (s.type === "scene" && s.num && !stripByNum[s.num]) stripByNum[s.num] = s;
  });

  const rows = (DATA.scenes || []).map(sc => {
    const strip = sc.number ? stripByNum[sc.number] : null;
    const dayInfo = sc.number ? dayOfNum[sc.number] : null;
    const pages = strip ? SB.parsePages(strip.pages) : 0;
    let group;
    if (dayInfo) group = { kind: "day", dayIndex: dayInfo.dayIndex, dayLabel: dayInfo.dayLabel, order: dayInfo.order };
    else if (strip) group = { kind: "boneyard" };
    else group = { kind: "missing" };
    return { scene: sc, strip, group, pages };
  });

  const totalPages = rows.reduce((a, r) => a + r.pages, 0) || 1;
  return { rows, totalPages };
}

function screenTimeFor(row, totalPages, targetSec) {
  if (row.scene.screenTimeSec != null) return row.scene.screenTimeSec;
  if (!targetSec) return 0;
  return Math.round(targetSec * (row.pages / totalPages));
}

function saveTargetLength(el) {
  if (readOnly || !rullplanEdit) return;
  const sec = parseMSS(el.innerText);
  DATA.targetLengthSec = sec;
  notify();
  renderRullplan();
}
function saveScreenTime(el, number) {
  if (readOnly || !rullplanEdit) return;
  const sc = DATA.scenes.find(s => s.number === number);
  if (!sc) return;
  const raw = el.innerText.trim();
  sc.screenTimeSec = raw === "" ? null : parseMSS(raw);
  notify();
  renderRullplan();
}
/* Faktisk exponerad neg för scenen, i minuter. Lagras på manus-scenen
   (samma ställe som screenTimeSec) så DPR kan läsa/skriva samma fält via
   scennumret. Tomt fält -> null -> visar den budgeterade siffran igen. */
function saveNegActual(el, number) {
  if (readOnly || !rullplanEdit) return;
  const sc = DATA.scenes.find(s => s.number === number);
  if (!sc) return;
  const raw = el.innerText.trim().replace(",", ".");
  const n = raw === "" ? null : parseFloat(raw);
  sc.negActualMin = (n == null || isNaN(n)) ? null : n;
  notify();
  renderRullplan();
}
function toggleRullplanWrapped(el) {
  if (readOnly || !rullplanEdit) return;
  DATA.rullplanWrapped = DATA.rullplanWrapped || {};
  DATA.rullplanWrapped[el.dataset.label] = el.checked;
  notify();
  renderRullplan();
}
/* Skjutförhållandet är per projekt (tomt / ogiltigt -> default 14). */
function saveShootingRatio(el) {
  if (readOnly || !rullplanEdit) return;
  const n = parseFloat(String(el.innerText).trim().replace(",", "."));
  DATA.shootingRatio = (isNaN(n) || n <= 0) ? null : n;
  notify();
  renderRullplan();
}

function renderRullplan() {
  if (!rullplanRoot) return;
  const stripboard = opts.getStripboard() || {};
  const hasScript = DATA && DATA.scenes && DATA.scenes.length;
  if (!hasScript) {
    rullplanRoot.innerHTML = `
      <div class="sc-page">
        <div class="page-head"><h2>Rullplan</h2></div>
        <div class="sc-import-empty">
          <p>Inget manus importerat ännu — Rullplan behöver manusets scener och sidlängder.</p>
          ${readOnly ? "" : `<button class="btn btn-add" onclick="App.setTab('manus')">Gå till Manus-fliken →</button>`}
        </div>
      </div>`;
    return;
  }

  const { rows, totalPages } = buildRullplanRows(stripboard);
  const targetSec = DATA.targetLengthSec != null ? DATA.targetLengthSec : DEFAULT_TARGET_SEC;
  const ratio = (DATA.shootingRatio != null && DATA.shootingRatio > 0) ? DATA.shootingRatio : DEFAULT_SHOOTING_RATIO;
  const days = stripboard.days || [];

  const withTimes = rows.map(r => ({ ...r, sec: screenTimeFor(r, totalPages, targetSec) }));
  const totalSec = withTimes.reduce((a, r) => a + r.sec, 0);
  const wrapped = DATA.rullplanWrapped || {};

  /* Neg-utfall per scen: budgeterad neg (skärmtid × förhållande) tills man
     skriver in ett eget värde -- samma autofyll-mönster som Skärmtid. */
  const budgetMinOf = (sec) => sec * ratio / 60;
  const actualMinOf = (r) => r.scene.negActualMin != null ? r.scene.negActualMin : budgetMinOf(r.sec);
  const diffCls = (d) => d > 0.05 ? "rp-diff-over" : d < -0.05 ? "rp-diff-under" : "";
  const diffTxt = (d) => (d >= 0 ? "+" : "") + d.toFixed(1);

  function rowHtml(r) {
    const sec = r.sec;
    const andel = totalSec ? (sec / totalSec * 100) : 0;
    const budgetMin = budgetMinOf(sec);
    const rullar = budgetMin / REEL_CAPACITY_MIN;
    const isOverride = r.scene.screenTimeSec != null;
    const actualSet = r.scene.negActualMin != null;
    const actualMin = actualSet ? r.scene.negActualMin : budgetMin;
    const diff = actualMin - budgetMin;
    return `
      <tr>
        <td>${r.group.kind === "day" ? esc(shortDayLabel(r.group.dayLabel)) : ""}</td>
        <td>${esc(r.scene.number || "?")}</td>
        <td>${esc(r.scene.slugline)}</td>
        <td class="rp-num${isOverride ? " rp-override" : ""}">
          <span class="editable" contenteditable="false" data-ph="0:00" onblur="SC.saveScreenTime(this,'${r.scene.number}')">${sec ? fmtMSS(sec) : ""}</span>
        </td>
        <td class="rp-num">${andel.toFixed(1)}%</td>
        <td class="rp-num">${budgetMin.toFixed(1)}</td>
        <td class="rp-num${actualSet ? " rp-override" : ""}">
          <span class="editable" contenteditable="false" data-ph="0.0" onblur="SC.saveNegActual(this,'${r.scene.number}')">${actualMin ? actualMin.toFixed(1) : ""}</span>
        </td>
        <td class="rp-num rp-diff ${actualSet ? diffCls(diff) : ""}">${actualSet ? diffTxt(diff) : ""}</td>
        <td class="rp-num">${rullar.toFixed(2)}</td>
      </tr>`;
  }

  function daySubtotalHtml(dayRows, label) {
    const daySec = dayRows.reduce((a, r) => a + r.sec, 0);
    const dayAndel = totalSec ? (daySec / totalSec * 100) : 0;
    const dayBudget = budgetMinOf(daySec);
    const dayActual = dayRows.reduce((a, r) => a + actualMinOf(r), 0);
    const dayDiff = dayActual - dayBudget;
    const dayRullarPlan = dayBudget / REEL_CAPACITY_MIN;
    const dayRullarAct = dayActual / REEL_CAPACITY_MIN;
    const isWrapped = !!wrapped[label];
    return `
      <tr class="rp-day-total-row${isWrapped ? " rp-wrapped" : ""}">
        <td colspan="3">Summa dag${isWrapped ? " · wrappad ✓" : ""}</td>
        <td class="rp-num">${fmtMSS(daySec)}</td>
        <td class="rp-num">${dayAndel.toFixed(1)}%</td>
        <td class="rp-num">${dayBudget.toFixed(1)}</td>
        <td class="rp-num">${dayActual.toFixed(1)}</td>
        <td class="rp-num rp-diff ${diffCls(dayDiff)}">${diffTxt(dayDiff)}</td>
        <td class="rp-num">${dayRullarAct.toFixed(2)} / ${dayRullarPlan.toFixed(2)}</td>
      </tr>`;
  }

  const byDay = days.map((d, di) => withTimes
    .filter(r => r.group.kind === "day" && r.group.dayIndex === di)
    .sort((a, b) => a.group.order - b.group.order));
  const boneyard = withTimes.filter(r => r.group.kind === "boneyard");
  const missing = withTimes.filter(r => r.group.kind === "missing");

  let bodyHtml = "";
  days.forEach((d, di) => {
    if (!byDay[di].length) return;
    const isWrapped = !!wrapped[d.label];
    const wrapCtl = (!readOnly && rullplanEdit)
      ? ` <label class="rp-wrap-toggle"><input type="checkbox"${isWrapped ? " checked" : ""} data-label="${esc(d.label)}" onchange="SC.toggleRullplanWrapped(this)"> dagen wrappad</label>`
      : (isWrapped ? ` <span class="rp-wrap-tag">wrappad ✓</span>` : "");
    bodyHtml += `<tr class="rp-group-row"><td colspan="9">${esc(d.label)}${wrapCtl}</td></tr>`;
    bodyHtml += byDay[di].map(rowHtml).join("");
    bodyHtml += daySubtotalHtml(byDay[di], d.label);
  });
  if (boneyard.length) {
    bodyHtml += `<tr class="rp-group-row"><td colspan="9">Boneyard / ej schemalagt</td></tr>`;
    bodyHtml += boneyard.map(rowHtml).join("");
  }
  if (missing.length) {
    bodyHtml += `<tr class="rp-group-row rp-group-missing"><td colspan="9">Saknas i schemat</td></tr>`;
    bodyHtml += missing.map(rowHtml).join("");
  }

  const totalBudget = totalSec * ratio / 60;
  const totalRullar = totalBudget / REEL_CAPACITY_MIN;
  const totalActual = withTimes.reduce((a, r) => a + actualMinOf(r), 0);
  const totalActualDiff = totalActual - totalBudget;
  const targetDiffSec = totalSec - targetSec;

  /* Förbrukat = utfall (inskrivet eller budgeterat) för scener i dagar som
     markerats wrappade. Kvar = totalbudget minus det. */
  const spentActualMin = withTimes.reduce((a, r) => {
    if (r.group.kind !== "day") return a;
    const label = (days[r.group.dayIndex] || {}).label;
    return wrapped[label] ? a + actualMinOf(r) : a;
  }, 0);
  const spentRullar = spentActualMin / REEL_CAPACITY_MIN;
  const kvarRullar = totalRullar - spentRullar;

  rullplanRoot.innerHTML = `
    <div class="sc-page">
      <div class="page-head">
        <h2>Rullplan</h2>
        <div class="ml-auto rp-head-actions">
          ${readOnly ? "" : `
          <label class="edit-toggle">
            <span>Redigera</span>
            <label class="toggle">
              <input type="checkbox" data-rp="edit"${rullplanEdit ? " checked" : ""} onchange="SC.toggleRullplanEdit(this.checked)">
              <span class="slider"></span>
            </label>
          </label>`}
          <button class="btn btn-sm" onclick="window.print()">🖨 Skriv ut</button>
        </div>
      </div>
      <p class="rp-intro">Skjutförhållande <span class="editable rp-ratio" contenteditable="false" data-ph="14" onblur="SC.saveShootingRatio(this)">${Number.isInteger(ratio) ? ratio : ratio.toFixed(1)}</span>:1 · ${REEL_CAPACITY_MIN} min/rulle. Skärmtid är föreslagen (måltid × scenens andel av manusets sidlängd); Neg: utfall autofylls från budget tills du skriver in vad som faktiskt rullades${readOnly ? "." : ". Markera en dag som wrappad för att räkna in dess utfall i Förbrukat/Kvar nedan."}</p>
      <div class="schema-scroll">
        <table class="rp-table">
          <thead>
            <tr>
              <th>Dag</th><th>Scen</th><th>Rubrik</th>
              <th>Skärmtid</th><th>Andel</th><th>Neg: plan</th><th>Neg: utfall</th><th>&Delta;</th><th>Rullar</th>
            </tr>
          </thead>
          <tbody>${bodyHtml}</tbody>
          <tfoot>
            <tr class="rp-total-row">
              <td colspan="3">TOTALT</td>
              <td class="rp-num">${fmtMSS(totalSec)}</td>
              <td class="rp-num">100,0%</td>
              <td class="rp-num">${totalBudget.toFixed(1)}</td>
              <td class="rp-num">${totalActual.toFixed(1)}</td>
              <td class="rp-num rp-diff ${diffCls(totalActualDiff)}">${diffTxt(totalActualDiff)}</td>
              <td class="rp-num">${totalRullar.toFixed(2)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div class="rp-burn">
        <span>Budget: <b>${totalRullar.toFixed(1)}</b> rullar</span>
        <span>Förbrukat <span class="rp-burn-sub">(wrappade dagar)</span>: <b>${spentRullar.toFixed(1)}</b></span>
        <span class="${kvarRullar < 0 ? "rp-warn" : ""}">Kvar mot budget: <b>${kvarRullar.toFixed(1)}</b> rullar</span>
      </div>
      <div class="rp-target">
        <span class="rp-target-label">Måltid för filmen</span>
        <span class="editable" contenteditable="false" data-ph="0:00" onblur="SC.saveTargetLength(this)">${fmtMSS(targetSec)}</span>
        <span class="rp-target-diff ${Math.abs(targetDiffSec) > 5 ? "rp-warn" : ""}">Nuvarande summa: ${fmtMSS(totalSec)} (${targetDiffSec >= 0 ? "+" : ""}${fmtMSS(Math.abs(targetDiffSec))} ${targetDiffSec >= 0 ? "över" : "under"})</span>
      </div>
    </div>`;
  rullplanRoot.classList.toggle("rp-edit", rullplanEdit && !readOnly);
  setEditableRullplan();
}
function setEditableRullplan() {
  if (!rullplanRoot) return;
  const on = rullplanEdit && !readOnly;
  rullplanRoot.querySelectorAll(".editable").forEach(el => el.setAttribute("contenteditable", on ? "true" : "false"));
}
function toggleRullplanEdit(on) {
  if (readOnly) return;
  rullplanEdit = on;
  if (rullplanRoot) { rullplanRoot.classList.toggle("rp-edit", on); setEditableRullplan(); }
}
function refreshRullplan() { if (rullplanRoot) renderRullplan(); }
function mountRullplan(el, data, options) {
  rullplanRoot = el;
  if (data) DATA = data;
  if (!DATA) DATA = emptyScript();
  opts = Object.assign({ onChange() {}, toast() {}, getStripboard: () => ({ production: {}, cast: [], days: [], unscheduled: [] }) }, opts, options || {});
  if (options && options.readOnly) readOnly = true;
  renderRullplan();
}

function renderSidesCover(day, dayIndex, days, stripboard, scriptByNum) {
  let pages = 0, scenes = 0;
  const locs = new Set();
  const castSet = new Set();
  day.strips.forEach(s => {
    if (s.type === "scene") {
      scenes++;
      pages += (window.SB && SB.parsePages) ? SB.parsePages(s.pages) : 0;
      if (s.loc) locs.add(s.loc);
      String(s.cast || "").split(/[,;]/).forEach(c => { if (c.trim()) castSet.add(c.trim()); });
    }
  });
  const castBook = Object.fromEntries((stripboard.cast || []).map(c => [c.id, c]));
  const orderRows = day.strips.map(s => {
    if (s.type === "banner") return `<div class="sc-order-row sc-order-banner">${esc(s.start)} — ${esc(s.set)}</div>`;
    const sc = s.num ? scriptByNum[s.num] : null;
    return `<div class="sc-order-row"><b>${esc(s.start)} · Scen ${esc(s.num)}</b> ${esc(sc ? sc.slugline : s.set)}</div>`;
  }).join("");
  const production = stripboard.production || {};
  const pagesTxt = (window.SB && SB.fmtPages) ? SB.fmtPages(pages) : pages;
  return `
    <div class="sc-cover">
      <div class="sc-cover-title">${esc(production.film || "")}</div>
      <div class="sc-cover-sub">${production.regi ? "Regi: " + esc(production.regi) : ""}</div>
      <div class="sc-cover-heading">DAGSMANUS · DAG ${dayIndex + 1} AV ${days.length}</div>
      <div class="sc-cover-date">${esc(day.label)}${day.date ? " · " + esc((window.SB && SB.dateSv) ? SB.dateSv(day.date, true) : day.date) : ""}</div>
      <div class="sc-cover-stats"><span>${scenes} scener</span> · <span>${esc(String(pagesTxt))} sidor</span> · <span>${locs.size} platser</span></div>
      <div class="sc-cover-order">
        <div class="sc-cover-order-title">Dagens ordning</div>
        ${orderRows}
      </div>
      ${castSet.size ? `<div class="sc-cover-legend">${[...castSet].map(id => `<span class="sc-cast-chip">${esc(id)} ${esc(castBook[id] ? castBook[id].role : "")}</span>`).join("")}</div>` : ""}
      <div class="sc-cover-note">Utdrag ur planen — call sheeten gäller.</div>
    </div>`;
}

function renderSceneBlock(strip, scriptByNum) {
  const sc = strip.num ? scriptByNum[strip.num] : null;
  if (!sc) {
    return `
      <div class="sc-scene-block sc-scene-block-missing">
        <div class="sc-scene-bar">SCEN ${esc(strip.num)} — ${esc(strip.set)}</div>
        <div class="sc-missing-warning">⚠️ Scen ${esc(strip.num)} saknas i importerat manus.</div>
      </div>`;
  }
  const pageTxt = sc.scriptPage ? `${sc.scriptPage}${sc.scriptPageEnd && sc.scriptPageEnd !== sc.scriptPage ? "–" + sc.scriptPageEnd : ""}` : "?";
  const stripHead = String(strip.set || "").trim().toUpperCase();
  const slugHead = String(sc.slugline || "").trim().toUpperCase();
  const slugDiffers = stripHead && slugHead && !slugHead.includes(stripHead.slice(0, 12));
  return `
    <div class="sc-scene-block">
      <div class="sc-scene-bar">SCEN ${esc(sc.number)}&nbsp;&nbsp;${esc(sc.slugline)}&nbsp;&nbsp;manussida ${esc(pageTxt)}</div>
      <div class="sc-scene-meta">
        Roller ${esc(strip.cast || "—")} · ${esc(strip.loc || "—")}${slugDiffers ? ` · plan: ${esc(strip.set)}` : ""}
      </div>
      ${renderScriptBody(sc.body)}
    </div>`;
}

/* ===== mount ===== */
function mount(el, data, options) {
  root = el;
  if (data) DATA = data;
  if (!DATA) DATA = emptyScript();
  opts = Object.assign({ onChange() {}, toast() {}, getStripboard: () => ({ production: {}, cast: [], days: [], unscheduled: [] }) }, opts, options || {});
  if (options && options.readOnly) readOnly = true;
  renderManus();
}
function mountSides(el, data, options) {
  sidesRoot = el;
  if (data) DATA = data;
  if (!DATA) DATA = emptyScript();
  opts = Object.assign({ onChange() {}, toast() {}, getStripboard: () => ({ production: {}, cast: [], days: [], unscheduled: [] }) }, opts, options || {});
  if (options && options.readOnly) readOnly = true;
  /* Öppnar på den dag vars datum ligger närmast idag, inte alltid dag 1 --
     samma "dagens datum"-hjälp som Stripboard/Call sheet använder. */
  const sbDays = (opts.getStripboard() || {}).days || [];
  activeSidesDay = (window.SB && SB.closestDayIndex) ? SB.closestDayIndex(sbDays, "date") : 0;
  renderSides();
}
function unmount() { root = null; sidesRoot = null; DATA = null; }
function getData() { return DATA; }

return {
  mount, mountSides, mountRullplan, unmount, getData,
  handleImport, setSidesDay, refreshSides, refreshManus, refreshRullplan,
  saveTargetLength, saveScreenTime, saveNegActual, saveShootingRatio, toggleRullplanEdit, toggleRullplanWrapped,
  parseFountain, findHoles, extractPdfLines, parsePdfScenes
};
})();
