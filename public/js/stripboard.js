/* Stripboard-modul. Exponeras som window.SB.
   Renderar in i ett rot-element och rapporterar ändringar via onChange. */
"use strict";
window.SB = (function () {

let DATA = null;
let root = null;
let opts = { onChange() {}, onCallSheet() {}, toast() {} };
let readOnly = false;
let castPickerEl = null;

function notify() { opts.onChange(DATA); }

/* ===== hjälpfunktioner ===== */
const SV_DAYS = ["sön","mån","tis","ons","tors","fre","lör"];
const SV_DAYS_LONG = ["Söndag","Måndag","Tisdag","Onsdag","Torsdag","Fredag","Lördag"];
const SV_MON = ["jan","feb","mar","apr","maj","jun","jul","aug","sep","okt","nov","dec"];

function parseEst(s) {
  if (!s) return 0;
  s = String(s).trim().toLowerCase();
  let m = 0, hit = false;
  const h = s.match(/(\d+)\s*h/); if (h) { m += parseInt(h[1]) * 60; hit = true; }
  const mm = s.match(/(\d+)\s*m/); if (mm) { m += parseInt(mm[1]); hit = true; }
  if (!hit) { const n = s.match(/^(\d+)$/); if (n) m = parseInt(n[1]); }
  return m;
}
function fmtEst(min) {
  if (!min) return "";
  const h = Math.floor(min / 60), m = min % 60;
  return h ? (m ? `${h}h ${m}m` : `${h}h 0m`) : `${m}m`;
}
function parsePages(s) {
  if (!s) return 0;
  s = String(s).trim();
  const full = s.match(/^(\d+)\s+(\d+)\s*\/\s*8$/);
  if (full) return parseInt(full[1]) * 8 + parseInt(full[2]);
  const frac = s.match(/^(\d+)\s*\/\s*8$/);
  if (frac) return parseInt(frac[1]);
  const whole = s.match(/^(\d+)$/);
  if (whole) return parseInt(whole[1]) * 8;
  return 0;
}
function fmtPages(e) {
  if (!e) return "";
  const w = Math.floor(e / 8), f = e % 8;
  if (w && f) return `${w} ${f}/8`;
  if (w) return `${w} 0/8`;
  return `${f}/8`;
}
function t2m(s) {
  if (!s) return null;
  const m = String(s).match(/(\d{1,2})[:.](\d{2})/);
  if (!m) return null;
  return parseInt(m[1]) * 60 + parseInt(m[2]);
}
function m2t(min) {
  min = ((min % 1440) + 1440) % 1440;
  return String(Math.floor(min / 60)).padStart(2, "0") + ":" + String(min % 60).padStart(2, "0");
}
function dateSv(iso, long) {
  const d = new Date(iso + "T12:00:00");
  if (isNaN(d)) return iso || "";
  return `${long ? SV_DAYS_LONG[d.getDay()] : SV_DAYS[d.getDay()]} ${d.getDate()} ${SV_MON[d.getMonth()]} ${d.getFullYear()}`;
}
function dateShort(iso) {
  const d = new Date(iso + "T12:00:00");
  if (isNaN(d)) return { m: "", d: "" };
  return { m: SV_MON[d.getMonth()].toUpperCase(), d: String(d.getDate()).padStart(2, "0") };
}
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

/* ===== "dagens datum"-navigering =====
   Delad av Stripboard, Call sheet och Dagsmanus (alla anropar SB.closestDayIndex
   direkt, samma mönster som de redan återanvänder SB.parsePages/fmtPages).
   Exakt datummatchning vinner; annars den dag som ligger närmast i tid.
   Har HELA schemat redan passerat (idag efter sista dagen) återgår vi till
   första dagen istället för att fastna på den sista redan avklarade dagen —
   mer användbart att börja om från toppen än att visa gårdagens historia. */
function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function daysBetween(isoA, isoB) {
  const a = new Date(isoA + "T12:00:00"), b = new Date(isoB + "T12:00:00");
  if (isNaN(a) || isNaN(b)) return Infinity;
  return Math.round((a - b) / 86400000);
}
function closestDayIndex(days, field) {
  field = field || "date";
  const valid = (days || []).map((d, i) => ({ i, date: d[field] })).filter(x => x.date);
  if (!valid.length) return 0;
  const today = todayIso();
  const exact = valid.find(x => x.date === today);
  if (exact) return exact.i;
  const sorted = [...valid].sort((a, b) => a.date < b.date ? -1 : (a.date > b.date ? 1 : 0));
  if (today > sorted[sorted.length - 1].date) return sorted[0].i;
  if (today < sorted[0].date) return sorted[0].i;
  let best = sorted[0], bestDiff = Math.abs(daysBetween(today, sorted[0].date));
  sorted.forEach(x => {
    const diff = Math.abs(daysBetween(today, x.date));
    if (diff < bestDiff) { best = x; bestDiff = diff; }
  });
  return best.i;
}

/* ===== beräkningar ===== */
function stripClass(s) {
  const set = s.set || "";
  const extra = /rast|lunch/i.test(set) ? " break" : /förflyttning|flytt/i.test(set) ? " move" : "";
  if (s.type === "banner") return "banner" + extra;
  const night = /natt|night/i.test(s.dn || "");
  const ext = /^ext/i.test(s.ie || "");
  return (ext ? "ext-" : "int-") + (night ? "night" : "day") + extra;
}
function dayTotals(day) {
  let pages = 0, mins = 0, scenes = 0;
  day.strips.forEach(s => {
    mins += parseEst(s.est);
    if (s.type === "scene") { pages += parsePages(s.pages); scenes++; }
  });
  const start = t2m(day.start) ?? 0;
  let end = start + mins;
  const last = day.strips[day.strips.length - 1];
  if (last) {
    const ls = t2m(last.start);
    if (ls != null) {
      let le = ls + parseEst(last.est);
      if (le < start) le += 1440;
      end = Math.max(end, le);
    }
  }
  return { pages, mins, scenes, start, end, span: end - start };
}
function recalcDay(day) {
  let run = t2m(day.start);
  if (run == null) run = 0;
  day.strips.forEach(s => {
    if (s.lock && t2m(s.start) != null) run = t2m(s.start);
    s.start = m2t(run);
    run += parseEst(s.est);
  });
}
function recalcAll() {
  DATA.days.forEach(recalcDay);
  notify(); render(); opts.toast("Starttider omräknade");
}

/* ===== rendering ===== */
/* ===== dropdown-alternativ ===== */
const PAGE_OPTS = (() => {
  const o = [];
  for (let w = 0; w <= 10; w++) for (let f = 0; f < 8; f++) {
    if (w === 0 && f === 0) continue;
    o.push(fmtPages(w * 8 + f));
    if (w === 10) break;
  }
  return o;
})();
const TIME_OPTS = (() => {
  const o = [];
  for (let m = 5; m <= 60; m += 5) o.push(m);
  for (let m = 75; m <= 480; m += 15) o.push(m);
  for (let m = 510; m <= 720; m += 30) o.push(m);
  return o.map(fmtEst);
})();
const IE_OPTS = ["INT", "EXT", "INT/EXT", "–"];
const DN_OPTS = ["DAG", "NATT", "MORGON", "KVÄLL", "SKYMNING", "GRYNING", "–"];

function sel(cls, val, path, list, ph) {
  val = val == null ? "" : String(val).trim();
  const items = list.slice();
  if (val && !items.includes(val)) items.unshift(val);
  const opts = [`<option value=""${val ? "" : " selected"}>${esc(ph || "–")}</option>`]
    .concat(items.map(o => `<option value="${esc(o)}"${o === val ? " selected" : ""}>${esc(o)}</option>`))
    .join("");
  return `<div class="${cls}"><select class="cell-sel${val ? "" : " empty"}" data-path="${path}">${opts}</select></div>`;
}

function cell(cls, val, path, ph, extra) {
  return `<div class="${cls}"><span class="cell-ed" contenteditable="true" spellcheck="false" data-path="${path}" data-ph="${ph || ""}" ${extra || ""}>${esc(val)}</span></div>`;
}

function castCell(s, path) {
  const ids = String(s.cast || "").split(/[,;]/).map(x => x.trim()).filter(Boolean);
  const label = ids.length ? ids.join(", ") : "–";
  return `<div class="c-cast" data-path="${path}"><button type="button" class="c-cast-btn" onclick="SB.toggleCastPicker(this,event)">${esc(label)}</button></div>`;
}

function stripRow(s, dayIdx, i) {
  const base = `d${dayIdx}.${i}`;
  const isB = s.type === "banner";
  const lock = s.lock ? "on" : "";
  if (isB) {
    return `<div class="strip ${stripClass(s)} grid" data-day="${dayIdx}" data-idx="${i}" draggable="false">
      <div class="c-handle" onmousedown="SB.grabOn(this)">⋮⋮</div>
      <div class="c-num"><span class="banner-i">i</span></div>
      ${cell("c-set", s.set, base + ".set", "Info / förflyttning / lunch")}
      <div class="c-ie"></div><div class="c-dn"></div><div class="c-cast"></div>
      ${cell("c-loc", s.loc || "", base + ".loc", "")}
      <div class="c-pages"></div>
      ${sel("c-est", s.est, base + ".est", TIME_OPTS)}
      <div class="c-start"><span class="cell-ed" contenteditable="true" spellcheck="false" data-path="${base}.start" data-ph="–">${esc(s.start)}</span><span class="lock-dot ${lock}" onclick="SB.toggleLock(${dayIdx},${i})" title="Lås starttid">🔒</span></div>
      <div class="c-act"><button class="row-x" onclick="SB.delStrip(${dayIdx},${i})" title="Ta bort">×</button></div>
    </div>`;
  }
  return `<div class="strip ${stripClass(s)} grid" data-day="${dayIdx}" data-idx="${i}" draggable="false">
    <div class="c-handle" onmousedown="SB.grabOn(this)">⋮⋮</div>
    ${cell("c-num", s.num, base + ".num", "#")}
    ${cell("c-set", s.set, base + ".set", "Scenrubrik")}
    ${sel("c-ie", s.ie, base + ".ie", IE_OPTS)}
    ${sel("c-dn", s.dn, base + ".dn", DN_OPTS)}
    ${castCell(s, base + ".cast")}
    ${cell("c-loc", s.loc, base + ".loc", "–")}
    ${sel("c-pages", s.pages, base + ".pages", PAGE_OPTS)}
    ${sel("c-est", s.est, base + ".est", TIME_OPTS)}
    <div class="c-start"><span class="cell-ed" contenteditable="true" spellcheck="false" data-path="${base}.start" data-ph="–">${esc(s.start)}</span><span class="lock-dot ${lock}" onclick="SB.toggleLock(${dayIdx},${i})" title="Lås starttid">🔒</span></div>
    <div class="c-act"><button class="row-x" onclick="SB.delStrip(${dayIdx},${i})" title="Ta bort">×</button></div>
  </div>`;
}

function render() {
  root.querySelector('[data-sb="film"]').textContent = DATA.production.film || "Stripboard";
  root.querySelector('[data-sb="sub"]').textContent = [DATA.production.version, DATA.production.regi ? "Regi: " + DATA.production.regi : ""].filter(Boolean).join(" · ");

  // stats
  let tp = 0, ts = 0, tm = 0, longest = 0;
  DATA.days.forEach(d => { const t = dayTotals(d); tp += t.pages; ts += t.scenes; tm += t.mins; longest = Math.max(longest, t.span); });
  const unsPages = (DATA.unscheduled || []).filter(s => s.type === "scene").reduce((a, s) => a + parsePages(s.pages), 0);
  const unsScenes = (DATA.unscheduled || []).filter(s => s.type === "scene").length;
  root.querySelector('[data-sb="stats"]').innerHTML = `
    <div class="stat"><div class="stat-lbl">Inspelningsdagar</div><div class="stat-val">${DATA.days.length}</div></div>
    <div class="stat"><div class="stat-lbl">Scener schemalagda</div><div class="stat-val">${ts}</div></div>
    <div class="stat"><div class="stat-lbl">Sidor totalt</div><div class="stat-val">${fmtPages(tp) || "0"}</div></div>
    <div class="stat"><div class="stat-lbl">Snitt/dag</div><div class="stat-val">${fmtPages(Math.round(tp / Math.max(1, DATA.days.length))) || "0"}</div></div>
    <div class="stat ${longest > 12 * 60 ? "warn" : ""}"><div class="stat-lbl">Längsta dag</div><div class="stat-val">${fmtEst(longest) || "–"}</div></div>
    <div class="stat ${unsScenes ? "warn" : ""}"><div class="stat-lbl">Ej schemalagt</div><div class="stat-val">${unsScenes}</div></div>`;

  let html = `<div class="grid hdr">
    <div></div><div>Scen</div><div>Set / rubrik</div><div>I/E</div><div>D/N</div><div>Roller</div><div>Insp.plats</div><div>Sidor</div><div>Est. tid</div><div>Start</div><div></div>
  </div>`;

  DATA.days.forEach((day, di) => {
    const t = dayTotals(day);
    html += `<div class="day-hdr">
      <span class="day-name"><span class="cell-ed" contenteditable="true" data-path="day${di}.label">${esc(day.label)}</span></span>
      <span class="day-date"><input type="date" value="${esc(day.date)}" onchange="SB.setDayField(${di},'date',this.value)" style="font:inherit; color:inherit; background:transparent; border:1px solid var(--border); border-radius:4px; padding:1px 4px;"></span>
      <span class="day-start-wrap">Start <input type="time" value="${esc(day.start)}" onchange="SB.setDayField(${di},'start',this.value); SB.recalcOne(${di})" style="font:inherit; color:inherit; background:transparent; border:1px solid var(--border); border-radius:4px; padding:1px 4px;"></span>
      <span style="margin-left:auto; display:flex; gap:6px;">
        <button class="btn btn-sm" onclick="SB.recalcOne(${di})">⟳ Tider</button>
        <button class="btn btn-sm btn-danger" onclick="SB.delDay(${di})">Ta bort dag</button>
      </span>
    </div>`;
    html += `<div class="day-body" data-day="${di}">`;
    day.strips.forEach((s, i) => { html += stripRow(s, di, i); });
    html += `</div>`;
    html += `<div class="day-add">
      <button class="btn btn-sm btn-add" onclick="SB.addStrip(${di},'scene')">+ Scen</button>
      <button class="btn btn-sm" onclick="SB.addStrip(${di},'banner')">+ Info-strip</button>
    </div>`;
    const ds = dateShort(day.date);
    html += `<div class="day-foot">
      <span class="df-day">${ds.m} ${ds.d}</span>
      <span>Slut på ${esc(day.label)} av ${DATA.days.length}</span>
      <span style="color:#aaa">${dateSv(day.date)}</span>
      <span class="df-num">${m2t(t.start)} – ${m2t(t.end)}</span>
      <span class="df-num ${t.span > 12 * 60 ? "df-warn" : ""}">(${fmtEst(t.span) || "0m"}${t.span > 12 * 60 ? " ⚠" : ""})</span>
      <span class="df-num">${fmtPages(t.pages) || "0"} sidor</span>
      <span class="df-num" style="color:#aaa">${t.scenes} scen${t.scenes === 1 ? "" : "er"}</span>
      <button class="btn btn-sm ml-auto" onclick="SB.makeCallSheet(${di})">Skapa call sheet →</button>
    </div>`;
  });

  // ej schemalagt
  html += `<div class="unsched-hdr">Ej schemalagt <small>— dra hit strips du inte fått plats med</small>
    <span style="margin-left:auto; display:flex; gap:6px;">
      <button class="btn btn-sm btn-add" onclick="SB.addStrip(-1,'scene')">+ Scen</button>
      <button class="btn btn-sm" onclick="SB.addStrip(-1,'banner')">+ Info-strip</button>
    </span></div>`;
  html += `<div class="day-body" data-day="-1">`;
  (DATA.unscheduled || []).forEach((s, i) => { html += stripRow(s, -1, i); });
  if (!(DATA.unscheduled || []).length) html += `<div style="padding:14px; text-align:center; color:var(--text-muted); font-size:12px;">Tomt</div>`;
  html += `</div>`;

  root.querySelector('[data-sb="board"]').innerHTML = html;
  wireCells();
  wireSelects();
  wireDnD();
}

/* ===== redigering ===== */
function listFor(di) { return di === -1 ? (DATA.unscheduled = DATA.unscheduled || []) : DATA.days[di].strips; }

function applyEdit(path, v) {
  const dm = path.match(/^day(\d+)\.(\w+)$/);
  if (dm) { DATA.days[+dm[1]][dm[2]] = v; notify(); render(); return; }
  const m = path.match(/^d(-?\d+)\.(\d+)\.(\w+)$/);
  if (!m) return;
  const di = +m[1];
  const s = listFor(di)[+m[2]];
  if (!s) return;
  const key = m[3];
  let nv = v;
  if (key === "ie" || key === "dn") nv = v.toUpperCase();
  if (s[key] === nv) return;
  s[key] = nv;
  if (key === "start" && nv) s.lock = true;
  if (di >= 0 && (key === "est" || key === "start")) recalcDay(DATA.days[di]);
  notify(); render();
}

function onCastPickerDocClick(e) {
  if (castPickerEl && !castPickerEl.contains(e.target)) closeCastPicker(true);
}
function closeCastPicker(commit) {
  if (!castPickerEl) return;
  castPickerEl.remove();
  castPickerEl = null;
  document.removeEventListener("click", onCastPickerDocClick, true);
  if (commit) { notify(); render(); }
}
function toggleCastPicker(btn, ev) {
  if (ev) ev.stopPropagation();
  if (castPickerEl) { closeCastPicker(true); return; }
  const wrap = btn.closest(".c-cast");
  const m = (wrap.dataset.path || "").match(/^d(-?\d+)\.(\d+)\.cast$/);
  if (!m) return;
  const s = listFor(+m[1])[+m[2]];
  if (!s) return;
  const current = new Set(String(s.cast || "").split(/[,;]/).map(x => x.trim()).filter(Boolean));
  const roster = DATA.cast || [];
  const panel = document.createElement("div");
  panel.className = "cast-picker";
  panel.innerHTML = (roster.length
    ? roster.map(c => `
      <label class="cast-picker-row">
        <input type="checkbox" value="${esc(c.id)}"${current.has(String(c.id)) ? " checked" : ""}>
        <span class="cp-id">${esc(c.id)}</span><span class="cp-role">${esc(c.role || "–")}</span>
      </label>`).join("")
    : `<div class="cast-picker-empty">Inga skådespelare i registret ännu. Lägg till via "Skådespelare"-knappen i toppen.</div>`)
    + `<div class="cast-picker-actions"><button type="button" class="btn btn-sm btn-primary cast-picker-done">Klar</button></div>`;
  document.body.appendChild(panel);
  const r = btn.getBoundingClientRect();
  panel.style.left = Math.round(r.left) + "px";
  panel.style.top = Math.round(r.bottom + 4) + "px";
  panel.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener("change", () => {
      if (cb.checked) current.add(cb.value); else current.delete(cb.value);
      s.cast = Array.from(current).join(", ");
      btn.textContent = s.cast || "–";
    });
  });
  panel.querySelector(".cast-picker-done").addEventListener("click", () => closeCastPicker(true));
  castPickerEl = panel;
  setTimeout(() => document.addEventListener("click", onCastPickerDocClick, true), 0);
}

function wireSelects() {
  root.querySelectorAll(".cell-sel[data-path]").forEach(el => {
    el.addEventListener("change", () => applyEdit(el.dataset.path, el.value));
    el.addEventListener("mousedown", ev => ev.stopPropagation());
  });
}

function wireCells() {
  root.querySelectorAll(".cell-ed[data-path]").forEach(el => {
    el.addEventListener("blur", () => applyEdit(el.dataset.path, el.innerText.trim()));
    el.addEventListener("keydown", ev => {
      if (ev.key === "Enter") { ev.preventDefault(); el.blur(); }
      if (ev.key === "Escape") { el.blur(); }
    });
  });
}
function setDayField(di, key, val) { DATA.days[di][key] = val; notify(); render(); }
function recalcOne(di) { recalcDay(DATA.days[di]); notify(); render(); }
function toggleLock(di, i) { const s = listFor(di)[i]; s.lock = !s.lock; notify(); render(); }
function delStrip(di, i) { listFor(di).splice(i, 1); notify(); render(); }
function addStrip(di, type) {
  const list = listFor(di);
  const prev = list[list.length - 1];
  const start = prev ? m2t((t2m(prev.start) ?? 0) + parseEst(prev.est)) : (di >= 0 ? DATA.days[di].start : "");
  list.push(type === "banner"
    ? { type: "banner", set: "", est: "", start, loc: "", note: "", lock: false }
    : { type: "scene", num: "", ie: "INT", set: "", dn: "DAG", cast: "", loc: "", pages: "", est: "", start, note: "", lock: false });
  notify(); render();
}
function addDay() {
  const last = DATA.days[DATA.days.length - 1];
  let date = "";
  if (last && last.date) { const d = new Date(last.date + "T12:00:00"); d.setDate(d.getDate() + 1); date = d.toISOString().slice(0, 10); }
  DATA.days.push({ label: "Dag " + (DATA.days.length + 1), date, start: "08:00", strips: [] });
  notify(); render();
}
function delDay(di) {
  if (!confirm(`Ta bort ${DATA.days[di].label}? Strips flyttas till "Ej schemalagt".`)) return;
  DATA.unscheduled = (DATA.unscheduled || []).concat(DATA.days[di].strips);
  DATA.days.splice(di, 1);
  notify(); render();
}

/* ===== bygga stripboard från manus / importera ===== */
/* Delar upp en slugline ("INT. KÖK - DAG") i I/E, set och D/N. Svenska +
   engelska tokens; okänt lämnas tomt. */
function sluglineParts(slug) {
  const s = String(slug || "").trim();
  let ie = "", rest = s;
  const ieM = s.match(/^\s*(INT\.?\/EXT\.?|I\.?\/E\.?|INT\.?|EXT\.?|INNE|UTE)\b[.\s-]*/i);
  if (ieM) {
    const tok = ieM[1].toUpperCase().replace(/\./g, "");
    ie = /INT\/EXT|I\/E/.test(tok) ? "INT/EXT" : /INT|INNE/.test(tok) ? "INT" : "EXT";
    rest = s.slice(ieM[0].length);
  }
  const DN = { DAG: "DAG", DAY: "DAG", NATT: "NATT", NIGHT: "NATT", MORGON: "MORGON", MORNING: "MORGON",
    KVÄLL: "KVÄLL", KVALL: "KVÄLL", EVENING: "KVÄLL", SKYMNING: "SKYMNING", DUSK: "SKYMNING",
    GRYNING: "GRYNING", DAWN: "GRYNING" };
  let dn = "";
  const dnM = rest.match(/[-–—]\s*([A-Za-zÅÄÖåäö/ ]+?)\s*$/);
  if (dnM) {
    const key = dnM[1].trim().toUpperCase().split(/[\s/]+/)[0];
    if (Object.prototype.hasOwnProperty.call(DN, key)) { dn = DN[key]; rest = rest.slice(0, dnM.index); }
  }
  const set = rest.replace(/^[-–—.\s]+/, "").replace(/[-–—.\s]+$/, "").trim();
  return { ie, set, dn };
}

function newSceneStrip(over) {
  return Object.assign({ type: "scene", num: "", ie: "", set: "", dn: "", cast: "", loc: "", pages: "", est: "", start: "", note: "", lock: false }, over || {});
}
function normStrip(s) {
  s = s || {};
  if (s.type === "banner") return { type: "banner", set: String(s.set || ""), loc: s.loc || "", est: s.est || "", start: s.start || "", note: s.note || "", lock: !!s.lock };
  return newSceneStrip({
    num: String(s.num == null ? "" : s.num), ie: s.ie || "", set: String(s.set || ""), dn: s.dn || "",
    cast: s.cast || "", loc: s.loc || "", pages: s.pages || "", est: s.est || "", start: s.start || "", note: s.note || "", lock: !!s.lock
  });
}

function scenesPresent() {
  const set = new Set();
  DATA.days.forEach(d => (d.strips || []).forEach(s => { if (s.type === "scene" && s.num) set.add(String(s.num)); }));
  (DATA.unscheduled || []).forEach(s => { if (s.type === "scene" && s.num) set.add(String(s.num)); });
  return set;
}

/* Skapar en strip per manusscen i "Ej schemalagt" (boneyard), i manusordning
   -- man drar sen ut dem på inspelningsdagar. mode "replace" tömmer allt
   först, "append" hoppar över scennummer som redan finns. Sidor/est/roller
   lämnas tomma (manuset bär inte åttondelar). */
function generateFromScript(scenes, mode) {
  if (readOnly) return { added: 0 };
  const list = Array.isArray(scenes) ? scenes : [];
  if (mode === "replace") { DATA.days.forEach(d => { d.strips = []; }); DATA.unscheduled = []; }
  DATA.unscheduled = DATA.unscheduled || [];
  const present = scenesPresent();
  let added = 0;
  list.forEach(sc => {
    const num = String(sc && sc.number != null ? sc.number : "").trim();
    if (!num || present.has(num)) return;
    const p = sluglineParts(sc.slugline);
    DATA.unscheduled.push(newSceneStrip({ num, ie: p.ie || "INT", set: p.set || String(sc.slugline || ""), dn: p.dn || "DAG" }));
    present.add(num); added++;
  });
  notify(); render();
  return { added };
}

/* Laddar in ett helt stripboard från ett objekt: antingen stripboard-dokformen
   ({days, unscheduled, production?, cast?}) eller en hel Shortplanner-export
   ({format, stripboard:{...}}). Ersätter nuvarande stripboard. */
function loadStripboard(obj) {
  if (readOnly) return { ok: false, error: "Skrivskyddad vy" };
  let sb = obj;
  if (obj && obj.stripboard && Array.isArray(obj.stripboard.days)) sb = obj.stripboard;
  if (!sb || !Array.isArray(sb.days)) return { ok: false, error: "Filen saknar en 'days'-lista — ser inte ut som ett stripboard." };
  if (sb.production && typeof sb.production === "object") DATA.production = sb.production;
  if (Array.isArray(sb.cast)) DATA.cast = sb.cast;
  DATA.days = sb.days.map(d => ({
    label: String((d && d.label) || "Dag"), date: (d && d.date) || "", start: (d && d.start) || "08:00",
    strips: Array.isArray(d && d.strips) ? d.strips.map(normStrip) : []
  }));
  if (!DATA.days.length) DATA.days = [{ label: "Dag 1", date: "", start: "08:00", strips: [] }];
  DATA.unscheduled = Array.isArray(sb.unscheduled) ? sb.unscheduled.map(normStrip) : [];
  recalcAll();
  notify(); render();
  const scenes = DATA.days.reduce((a, d) => a + d.strips.filter(s => s.type === "scene").length, 0)
    + DATA.unscheduled.filter(s => s.type === "scene").length;
  return { ok: true, days: DATA.days.length, scenes };
}

/* ===== drag & drop ===== */
let dragSrc = null;
function grabOn(h) { const row = h.closest(".strip"); if (row) row.draggable = true; }
function wireDnD() {
  root.querySelectorAll(".strip").forEach(row => {
    row.addEventListener("dragstart", ev => {
      dragSrc = { day: +row.dataset.day, idx: +row.dataset.idx };
      row.classList.add("dragging");
      ev.dataTransfer.effectAllowed = "move";
      try { ev.dataTransfer.setData("text/plain", "strip"); } catch (e) {}
    });
    row.addEventListener("dragend", () => {
      row.draggable = false;
      row.classList.remove("dragging");
      root.querySelectorAll(".drop-before,.drop-after").forEach(e => e.classList.remove("drop-before", "drop-after"));
      dragSrc = null;
    });
    row.addEventListener("dragover", ev => {
      if (!dragSrc) return;
      ev.preventDefault();
      const r = row.getBoundingClientRect();
      const after = (ev.clientY - r.top) > r.height / 2;
      root.querySelectorAll(".drop-before,.drop-after").forEach(e => e.classList.remove("drop-before", "drop-after"));
      row.classList.add(after ? "drop-after" : "drop-before");
    });
    row.addEventListener("drop", ev => {
      if (!dragSrc) return;
      ev.preventDefault(); ev.stopPropagation();
      const r = row.getBoundingClientRect();
      const after = (ev.clientY - r.top) > r.height / 2;
      moveStrip(dragSrc, +row.dataset.day, +row.dataset.idx + (after ? 1 : 0));
    });
  });
  root.querySelectorAll(".day-body").forEach(body => {
    body.addEventListener("dragover", ev => { if (dragSrc) ev.preventDefault(); });
    body.addEventListener("drop", ev => {
      if (!dragSrc) return;
      if (ev.target.closest(".strip")) return;
      ev.preventDefault();
      moveStrip(dragSrc, +body.dataset.day, listFor(+body.dataset.day).length);
    });
  });
}
function moveStrip(src, tDay, tIdx) {
  const from = listFor(src.day), to = listFor(tDay);
  if (src.day === tDay && (tIdx === src.idx || tIdx === src.idx + 1)) { dragSrc = null; render(); return; }
  const [s] = from.splice(src.idx, 1);
  if (src.day === tDay && tIdx > src.idx) tIdx--;
  to.splice(tIdx, 0, s);
  dragSrc = null;
  if (tDay >= 0) recalcDay(DATA.days[tDay]);
  if (src.day >= 0 && src.day !== tDay) recalcDay(DATA.days[src.day]);
  notify(); render();
}


/* ===== export till call sheet ===== */
function makeCallSheet(di) {
  const day = DATA.days[di], t = dayTotals(day);
  const scenes = day.strips.map(s => s.type === "banner"
    ? { type: "info", label: s.set, time: s.start, est: s.est }
    : { type: "scene", num: s.num, ie: s.ie, set: s.set, dn: s.dn, cast: s.cast || "—", loc: s.loc || "—", pages: s.pages, est: s.est, start: s.start });
  scenes.push({ type: "total", pages: fmtPages(t.pages) || "—", est: fmtEst(t.span) || "—" });

  const firstScene = day.strips.find(s => s.type === "scene");
  const locs = [...new Set(day.strips.map(s => (s.loc || "").trim()).filter(Boolean))];
  const castIds = [...new Set(day.strips.filter(s => s.type === "scene")
    .flatMap(s => String(s.cast || "").split(/[,;]/).map(x => x.trim()).filter(Boolean)))];
  const castBook = Object.fromEntries((DATA.cast || []).map(c => [c.id, c]));

  const payload = {
    label: day.label,
    date: dateSv(day.date),
    date_iso: day.date,
    dayOf: `${day.label} av ${DATA.days.length}`,
    gcall: day.start,
    forsta_bild: firstScene ? firstScene.start : day.start,
    arbetstid: `${m2t(t.start)}–${m2t(t.end)}`,
    weather_icon: "🌥",
    weather_temp: "—°C",
    sunrise: "—",
    sunset: "—",
    notes: [],
    locations: locs.length ? locs.map((n, i) => ({ num: i + 1, name: n, addr: "Ange adress", note: "" }))
                           : [{ num: 1, name: "Ange plats", addr: "Ange adress", note: "" }],
    hospital: { name: "Ange sjukhus", addr: "Ange adress", tel: "", note: "" },
    crew_contacts: [
      { role: "Producent", name: DATA.production.producent || "—", tel: "—" },
      { role: "Regi", name: DATA.production.regi || "—", tel: "—" },
      { role: "Platschef", name: "—", tel: "—" }
    ],
    kalltider: [
      { dept: "Regi, Foto, Platschef", time: m2t(t.start - 30) },
      { dept: "Scenografi, Kostym", time: m2t(t.start - 30) },
      { dept: "Mask & Hår", time: m2t(t.start - 60) }
    ],
    scenes,
    cast: castIds.map(id => ({
      id,
      name: (castBook[id] && castBook[id].name) || "— (ange namn)",
      role: (castBook[id] && castBook[id].role) || ("Roll " + id),
      call: m2t(t.start - 30), cw: m2t(t.start - 30), hmu: m2t(t.start - 60),
      onset: firstScene ? firstScene.start : day.start, wrap: m2t(t.end)
    }))
  };
  opts.onCallSheet(payload, day);
}

/* ===== montering ===== */
function lockdown(el) {
  el.querySelectorAll(".c-cast-btn").forEach(b => {
    const span = document.createElement("span");
    span.className = "c-cast-static";
    span.textContent = b.textContent;
    b.replaceWith(span);
  });
  el.querySelectorAll("button").forEach(b => { if (b.getAttribute("onclick") !== "window.print()") b.remove(); });
  el.querySelectorAll("input,select,textarea").forEach(i => { i.disabled = true; });
  el.querySelectorAll("[contenteditable]").forEach(c => c.setAttribute("contenteditable", "false"));
  el.querySelectorAll(".c-handle").forEach(h => { h.replaceChildren(); h.removeAttribute("onmousedown"); h.style.cursor = "default"; });
  el.querySelectorAll(".lock-dot").forEach(h => h.remove());
}
function mount(el, data, options) {
  root = el;
  DATA = data;
  opts = Object.assign({ onChange() {}, onCallSheet() {}, toast() {} }, options || {});
  readOnly = !!(options && options.readOnly);
  root.innerHTML = `
    <div class="sb-bar">
      <div class="title-block">
        <span class="film-title" data-sb="film"></span>
        <span class="film-sub" data-sb="sub"></span>
      </div>
      <div class="ml-auto sb-bar-actions">
        ${readOnly ? "" : `<button class="btn" onclick="App.openImportStrips()" title="Skapa strips från manuset eller ladda upp en stripboard-fil">📥 Importera scener</button>`}
        <button class="btn" onclick="SB.recalcAll()" title="Räkna om alla starttider från dagens starttid">⟳ Räkna om tider</button>
        <button class="btn btn-add" onclick="SB.addDay()">+ Dag</button>
        <button class="btn" onclick="window.print()">🖨 Skriv ut</button>
      </div>
    </div>
    <div class="stats" data-sb="stats"></div>
    <div class="board" data-sb="board"></div>
    <div class="legend">
      <span class="lg"><span class="sw" style="background:var(--s-int-day)"></span> INT / DAG</span>
      <span class="lg"><span class="sw" style="background:var(--s-ext-day)"></span> EXT / DAG</span>
      <span class="lg"><span class="sw" style="background:var(--s-int-night)"></span> INT / NATT</span>
      <span class="lg"><span class="sw" style="background:var(--s-ext-night)"></span> EXT / NATT</span>
      <span class="lg"><span class="sw" style="background:var(--s-banner)"></span> Info</span>
      <span class="lg"><span class="sw" style="background:var(--s-move)"></span> Förflyttning</span>
      <span class="lg"><span class="sw" style="background:var(--s-break)"></span> Rast / Lunch</span>
      <span class="lg" style="margin-left:auto">🔒 = låst starttid (flyttas inte vid omräkning)</span>
    </div>`;
  render();
  if (readOnly) lockdown(root);
}

function unmount() { if (root) root.innerHTML = ""; root = null; DATA = null; }
function getData() { return DATA; }

/* Rullar (utan att byta flik/läge) till dagen som ligger närmast dagens
   datum -- anropas explicit av app.js/view.js efter mount, en gång vid
   projektöppning, inte vid varje omritning (annars skulle en redigering
   rycka tillbaka scrollpositionen till "idag" mitt i arbetet). */
function scrollToClosestDay() {
  if (!root || !DATA || !DATA.days || !DATA.days.length) return;
  const idx = closestDayIndex(DATA.days, "date");
  const hdr = root.querySelectorAll(".day-hdr")[idx];
  if (hdr) hdr.scrollIntoView({ block: "start" });
}

return {
  mount, unmount, getData, render,
  recalcAll, recalcOne, addDay, delDay, setDayField,
  addStrip, delStrip, toggleLock, grabOn, makeCallSheet, toggleCastPicker,
  closestDayIndex, todayIso, scrollToClosestDay,
  generateFromScript, loadStripboard, sluglineParts, scenesPresent,
  fmtPages, fmtEst, parsePages, parseEst, dateSv
};
})();
