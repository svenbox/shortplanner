/* Inspelningsläge ("Shoot day mode") — ett förenklat helskärmsläge för
   1:e AD:ns telefon UNDER inspelning. Går igenom dagens steg (scener +
   lunch/förflyttning) ett i taget med stora knappar och stämplar faktiska
   tider, så DPR:n nästan fyller i sig själv.

   Arbetar direkt på DPR-doket (dprDoc.days[i].scenes + .currentIdx) och
   rapporterar ändringar via opts.onChange -> app.js markDirty("dpr").
   Ingen egen lagring, ingen serverdel. Kräver nät (autosave som vanligt).

   v2: startskärm ("Starta dagen"), tryck-välj aktuellt steg i steglistan,
   tryck-korrigera den stämplade starttiden, lunch/förflyttning med egna
   ikoner.

   Exponeras som window.SD i webbläsaren; går även att require:a i Node så
   den rena logiken (wrapMinutes, press*, setCurrent …) kan testas —
   test/shootday.test.js. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.SD = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const Core = (typeof require === "function")
    ? require("./stripboard-core.js")
    : (typeof self !== "undefined" ? self.SBCore : null);

  const t2m = Core.t2m;
  const m2t = Core.m2t;
  const parseEst = Core.parseEst;
  const fmtEst = Core.fmtEst;

  /* ---------- ren logik (testbar) ---------- */

  function effEst(step) {
    return Math.max(0, parseEst(step && step.est) + (Number(step && step.slipMin) || 0));
  }
  function curStep(day) {
    const steps = (day && day.scenes) || [];
    return steps[day.currentIdx || 0] || null;
  }
  /* step.kind (satt via i-cirkeln i stripboardet) vinner; annars matchas
     texten som förr. */
  function isLunch(step) {
    if (step && (step.kind === "break" || step.kind === "move" || step.kind === "info")) return step.kind === "break";
    return /lunch|rast/i.test((step && (step.label || step.set)) || "");
  }
  function isMove(step) {
    if (step && (step.kind === "break" || step.kind === "move" || step.kind === "info")) return step.kind === "move";
    return /förflyttning|flytt|company\s*move|\bmove\b/i.test((step && (step.label || step.set)) || "");
  }
  function stepKind(step) {
    if (!step || step.type === "scene") return "scene";
    if (isLunch(step)) return "lunch";
    if (isMove(step)) return "move";
    return "info";
  }
  function dayStarted(day) {
    return ((day && day.scenes) || []).some(s => s.actualStart);
  }
  function plannedStartMin(steps) {
    const first = (steps || [])[0];
    if (!first) return null;
    return t2m(first.start || first.time || "");
  }
  /* Planerad wrap = första stegets planerade start + Σ effEst för alla steg.
     Visas på startskärmen innan dagen börjat. */
  function plannedWrapMinutes(steps) {
    const base = plannedStartMin(steps);
    if (base == null) return null;
    let total = 0;
    (steps || []).forEach(s => { total += effEst(s); });
    return base + total;
  }

  /* Rullande beräknad wrap: nu + Σ(est + slip) för aktuellt och senare steg
     som inte är klara, minus förfluten tid på aktuellt steg. Minuter sedan
     midnatt (kan överstiga 1440 -> m2t slår runt). */
  function wrapMinutes(steps, curIdx, nowMin) {
    steps = steps || [];
    let total = 0;
    for (let i = Math.max(0, curIdx); i < steps.length; i++) {
      const s = steps[i];
      if (s.status === "done" || s.status === "partial") continue;
      total += effEst(s);
    }
    const cur = steps[curIdx];
    let elapsed = 0;
    if (cur && cur.actualStart) {
      const st = t2m(cur.actualStart);
      if (st != null) { elapsed = nowMin - st; if (elapsed < 0) elapsed += 1440; }
    }
    const curBudget = (cur && cur.status !== "done" && cur.status !== "partial") ? effEst(cur) : 0;
    return nowMin + total - Math.min(Math.max(elapsed, 0), curBudget);
  }

  function wrapClass(wrapMin, arbetEndMin) {
    if (arbetEndMin == null || wrapMin == null) return "";
    if (wrapMin <= arbetEndMin) return "ok";
    if (wrapMin <= arbetEndMin + 60) return "warn";
    return "over";
  }

  /* ---------- steg-reducerare (muterar day, testbara) ---------- */

  function autofillTimes(day, step) {
    day.times = day.times || {};
    if (step.type === "scene" && step.actualStart && !day.times.firstShot) day.times.firstShot = step.actualStart;
    if (isLunch(step) && step.actualStart && !day.times.lunchOut) day.times.lunchOut = step.actualStart;
    if (isLunch(step) && step.actualEnd && !day.times.lunchIn) day.times.lunchIn = step.actualEnd;
    const steps = day.scenes || [];
    if (steps.indexOf(step) === steps.length - 1 && step.actualEnd && !day.times.campWrap) day.times.campWrap = step.actualEnd;
  }

  function stepForward(day, nowStr) {
    const steps = day.scenes || [];
    if ((day.currentIdx || 0) < steps.length - 1) {
      day.currentIdx = (day.currentIdx || 0) + 1;
      const nx = steps[day.currentIdx];
      if (nx && !nx.actualStart) nx.actualStart = nowStr;
      if (nx) autofillTimes(day, nx);
    }
  }

  function ensureStarted(day, nowStr) {
    const s = curStep(day);
    if (s && !s.actualStart) { s.actualStart = nowStr; autofillTimes(day, s); }
  }
  /* "Starta dagen" — stämplar aktuellt (första) stegets faktiska start. */
  function pressStart(day, nowStr) { ensureStarted(day, nowStr); }

  /* Tryck-välj: hoppa pekaren till valt steg. Stämplar dess start om den
     saknas; rör inga statusar (framåthopp lämnar mellanliggande scener
     som ej avklarade, bakåthopp behåller allt). */
  function setCurrent(day, idx, nowStr) {
    const steps = day.scenes || [];
    if (!steps.length) return;
    idx = Math.max(0, Math.min(idx | 0, steps.length - 1));
    day.currentIdx = idx;
    const s = steps[idx];
    if (s && !s.actualStart) { s.actualStart = nowStr; autofillTimes(day, s); }
  }

  /* Tryck-korrigera en stämplad starttid. Ogiltig "HH:MM" -> ignoreras.
     Håller kedjan konsekvent: om föregående stegs slut var samma som den
     gamla starten flyttas det med, och DPR-dagens härledda tider likaså. */
  function setActualStart(day, idx, value) {
    const steps = day.scenes || [];
    const s = steps[idx];
    if (!s) return false;
    value = String(value || "").trim();
    if (value && t2m(value) == null) return false;
    const old = s.actualStart;
    s.actualStart = value;
    if (idx > 0 && steps[idx - 1] && steps[idx - 1].actualEnd && steps[idx - 1].actualEnd === old) {
      steps[idx - 1].actualEnd = value;
    }
    day.times = day.times || {};
    if (s.type === "scene" && day.times.firstShot === old) day.times.firstShot = value;
    if (isLunch(s) && day.times.lunchOut === old) day.times.lunchOut = value;
    return true;
  }

  function pressDone(day, nowStr) {
    const s = curStep(day); if (!s) return;
    s.actualEnd = nowStr;
    s.status = "done";
    if (s.type === "scene" && !s.pagesShot) s.pagesShot = s.pages || "";
    autofillTimes(day, s);
    stepForward(day, nowStr);
  }
  function pressPartial(day, nowStr) {
    const s = curStep(day); if (!s || s.type === "info") return;
    s.actualEnd = nowStr;
    s.status = "partial";
    autofillTimes(day, s);
    stepForward(day, nowStr);
  }
  function pressSkip(day, nowStr) {
    const s = curStep(day); if (!s) return;
    s.status = "";
    stepForward(day, nowStr);
  }
  function pressSlip(day, n) {
    const s = curStep(day); if (!s) return;
    s.slipMin = (Number(s.slipMin) || 0) + n;
  }
  function pressBack(day) {
    if ((day.currentIdx || 0) > 0) day.currentIdx = day.currentIdx - 1;
  }

  /* ---------- DOM (webbläsare) ---------- */

  let el = null, day = null, di = 0, onChange = null, closeCb = null, toast = () => {}, timer = null;
  let inactiveMsg = null;

  function pad(n) { return String(n).padStart(2, "0"); }
  function nowStr() { const d = new Date(); return pad(d.getHours()) + ":" + pad(d.getMinutes()); }
  function nowMin() { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); }
  function nowClock() { const d = new Date(); return nowStr() + ":" + pad(d.getSeconds()); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
  function save() { if (onChange) onChange(); }

  function stepIcon(s) {
    const k = stepKind(s);
    return k === "lunch" ? "☕" : k === "move" ? "🚚" : k === "info" ? "ⓘ" : "🎬";
  }
  function stepTitle(s) {
    if (!s) return "";
    if (s.type === "info") return esc(s.label || (isLunch(s) ? "Lunch" : isMove(s) ? "Förflyttning" : "Paus"));
    return "Sc " + esc(s.num || "?");
  }
  function stepSub(s) {
    if (!s) return "";
    if (s.type === "info") return s.est ? fmtEst(parseEst(s.est)) : "";
    return [s.ie, s.set].filter(Boolean).map(esc).join(" · ").toLowerCase();
  }

  function act(fn) { return () => { fn(); save(); render(); }; }

  function render() {
    if (!el || !day) return;
    const steps = day.scenes || [];
    const cur = curStep(day);
    const curIdx = day.currentIdx || 0;
    const done = steps.filter(s => s.type !== "info" && (s.status === "done" || s.status === "partial")).length;
    const total = steps.filter(s => s.type !== "info").length;
    const arbetEnd = t2m(day.plannedWrapEnd);

    if (!steps.length) {
      el.innerHTML = shell(`<p class="sd-empty">Den här dagens call sheet har inga scener.</p>`);
      wire();
      return;
    }

    const allHandled = total > 0 && steps.every(s => s.status);
    if (allHandled) {
      const last = steps[steps.length - 1];
      const wrap = wrapMinutes(steps, curIdx, nowMin());
      el.innerHTML = shell(`
        <div class="sd-done">
          <div class="sd-done-check">✓</div>
          <div class="sd-done-title">Inspelning klar</div>
          <div class="sd-done-wrap">${esc((last && last.actualEnd) || nowStr())}</div>
          <div class="sd-done-sub">${done} av ${total} scener · ${wrapedLabel(wrap, arbetEnd)}</div>
        </div>`);
      wire();
      return;
    }

    /* Startskärm — dagen har inte börjat än. */
    if (!dayStarted(day)) {
      const first = steps[0];
      const pw = plannedWrapMinutes(steps);
      el.innerHTML = shell(`
        <div class="sd-start">
          <div class="sd-start-call">${day.plannedCrewCall ? "General call " + esc(day.plannedCrewCall) : ""}</div>
          <div class="sd-start-first">${stepIcon(first)} ${stepTitle(first)}${stepSub(first) ? " · " + stepSub(first) : ""}</div>
          <div class="sd-start-planwrap">${pw != null ? "Planerad wrap " + m2t(pw) : ""}</div>
          <button class="sd-btn sd-btn-done sd-start-btn" data-sd="start">▶ Starta dagen</button>
        </div>
        ${steplist(steps, curIdx, done, total)}
      `);
      wire();
      return;
    }

    const wrap = wrapMinutes(steps, curIdx, nowMin());
    const wc = wrapClass(wrap, arbetEnd);
    const next = steps[curIdx + 1];
    const isScene = cur && cur.type === "scene";

    el.innerHTML = shell(`
      <div class="sd-card">
        <div class="sd-step-head">
          <span class="sd-step-icon">${stepIcon(cur)}</span>
          <div>
            <div class="sd-step-title">${stepTitle(cur)}</div>
            <div class="sd-step-sub">${stepSub(cur)}</div>
          </div>
          ${(cur && cur.slipMin) ? `<span class="sd-slip-badge">+${cur.slipMin} min</span>` : ""}
        </div>
        <table class="sd-times">
          <tr><td>${esc(day.plannedCrewCall || "—")}</td><td>call</td></tr>
          <tr><td>${esc((isScene ? cur.start : cur.time) || "—")}</td><td>planerad start</td></tr>
          <tr><td class="sd-t-edit" data-sd="editstart">${cur.actualStart ? esc(cur.actualStart) : "sätt tid"} ✎</td><td>faktisk start</td></tr>
          <tr class="${wc ? "sd-t-" + wc : ""}"><td class="sd-t-strong" id="sd-wrapval">${m2t(wrap)}</td><td>beräknad wrap${wc === "warn" || wc === "over" ? " ⚠" : ""}</td></tr>
        </table>
      </div>

      <div class="sd-next">${next ? "Nästa: " + stepTitle(next) + (stepSub(next) ? " · " + stepSub(next) : "") : "Sista steget"}</div>

      <div class="sd-btns">
        <button class="sd-btn sd-btn-done" data-sd="done">✓ Klar</button>
        ${isScene ? `<button class="sd-btn" data-sd="partial">◐ Delvis</button>` : `<button class="sd-btn" data-sd="skip">→ Hoppa över</button>`}
      </div>
      <div class="sd-btns">
        ${isScene ? `<button class="sd-btn" data-sd="skip">→ Hoppa över</button>` : `<span></span>`}
        <button class="sd-btn" data-sd="back" ${curIdx === 0 ? "disabled" : ""}>◂ Backa steg</button>
      </div>
      <div class="sd-btns">
        <button class="sd-btn sd-btn-slip" data-sd="s10">+10 min</button>
        <button class="sd-btn sd-btn-slip" data-sd="s20">+20 min</button>
      </div>

      ${steplist(steps, curIdx, done, total)}
    `);
    wire();
  }

  /* Tappbar steglista — hoppa pekaren genom att trycka på en rad. */
  function steplist(steps, curIdx, done, total) {
    return `
      <div class="sd-progress">
        <div class="sd-progress-label"><span>Dagens steg — tryck för att hoppa</span><span>${done} / ${total} scener klara</span></div>
        <div class="sd-steplist">
          ${steps.map((s, i) => {
            const st = s.status === "done" ? "done" : s.status === "partial" ? "partial"
              : (i === curIdx ? "cur" : (s.type === "info" ? "info" : "todo"));
            const plan = s.type === "scene" ? (s.start || "") : (s.time || "");
            const time = s.actualStart
              ? esc(s.actualStart) + (s.status === "done" && s.actualEnd ? "–" + esc(s.actualEnd) : "")
              : (plan ? esc(plan) : "");
            return `<button class="sd-steprow sd-steprow-${st}" data-sd="go:${i}">
              <span class="sd-steprow-dot"></span>
              <span class="sd-steprow-label">${stepIcon(s)} ${stepTitle(s)}</span>
              <span class="sd-steprow-t">${time}</span>
            </button>`;
          }).join("")}
        </div>
      </div>`;
  }

  function wrapedLabel(wrap, arbetEnd) {
    if (arbetEnd == null) return "wrap " + m2t(wrap);
    const diff = wrap - arbetEnd;
    if (diff <= 0) return "klart inom arbetstid";
    return m2t(wrap) + " · " + fmtEst(diff) + " över";
  }

  function shell(inner) {
    return `
      <div class="sd-wrap">
        <div class="sd-top">
          <span class="sd-day">${esc(day.label || "")}</span>
          <span class="sd-clock" id="sd-clock">nu ${nowClock()}</span>
        </div>
        ${inner}
        <button class="sd-exit" data-sd="exit">✕ Avsluta läget</button>
      </div>`;
  }

  /* Man kan alltid öppna läget, men det gör bara nytta på en inspelningsdag.
     Är det inte det visas det här i stället för stepparen. */
  function renderInactive() {
    el.innerHTML = `
      <div class="sd-wrap">
        <div class="sd-top">
          <span class="sd-day">Inspelningsläge</span>
          <span class="sd-clock">nu ${nowClock()}</span>
        </div>
        <div class="sd-inactive">
          <div class="sd-inactive-icon">🎬</div>
          <div class="sd-inactive-title">Läget är inte aktivt just nu</div>
          <p class="sd-inactive-msg">${esc(inactiveMsg)}</p>
        </div>
        <button class="sd-exit" data-sd="exit">✕ Stäng</button>
      </div>`;
    const b = el.querySelector('[data-sd="exit"]');
    if (b) b.onclick = () => { if (closeCb) closeCb(); };
  }

  function beginEditStart() {
    const td = el.querySelector('[data-sd="editstart"]');
    if (!td) return;
    const cur = curStep(day);
    td.innerHTML = `<input type="time" id="sd-edit" value="${esc((cur && cur.actualStart) || "")}">`;
    const inp = el.querySelector("#sd-edit");
    if (!inp) return;
    inp.focus();
    let committed = false;
    const commit = () => {
      if (committed) return; committed = true;
      setActualStart(day, day.currentIdx || 0, inp.value);
      save(); render();
    };
    inp.addEventListener("change", commit);
    inp.addEventListener("blur", commit);
  }

  function wire() {
    el.querySelectorAll("[data-sd]").forEach(b => {
      const k = b.getAttribute("data-sd");
      if (k.indexOf("go:") === 0) { b.onclick = act(() => setCurrent(day, +k.slice(3), nowStr())); return; }
      if (k === "editstart") { b.onclick = beginEditStart; return; }
      b.onclick = {
        start: act(() => pressStart(day, nowStr())),
        done: act(() => pressDone(day, nowStr())),
        partial: act(() => pressPartial(day, nowStr())),
        skip: act(() => pressSkip(day, nowStr())),
        back: act(() => pressBack(day)),
        s10: act(() => pressSlip(day, 10)),
        s20: act(() => pressSlip(day, 20)),
        exit: () => { if (closeCb) closeCb(); }
      }[k] || (() => {});
    });
  }

  function tick() {
    if (!el || !day) return;
    const c = el.querySelector("#sd-clock");
    if (c) c.textContent = "nu " + nowClock();
    const steps = day.scenes || [];
    if (!dayStarted(day)) return;
    const wrap = wrapMinutes(steps, day.currentIdx || 0, nowMin());
    const wc = wrapClass(wrap, t2m(day.plannedWrapEnd));
    const row = el.querySelector(".sd-times tr:last-child");
    const val = el.querySelector("#sd-wrapval");
    if (row) row.className = wc ? "sd-t-" + wc : "";
    if (val) val.textContent = m2t(wrap);
  }

  function open(container, dprDoc, dayIndex, options) {
    options = options || {};
    el = container;
    di = dayIndex || 0;
    day = (dprDoc.days || [])[di];
    onChange = options.onChange || null;
    closeCb = options.close || null;
    toast = options.toast || (() => {});
    inactiveMsg = options.inactive || null;
    if (inactiveMsg) { clearInterval(timer); timer = null; renderInactive(); return; }
    if (!day) { if (closeCb) closeCb(); return; }
    if (!day.scenes) day.scenes = [];
    if (day.currentIdx == null) { day.currentIdx = 0; save(); }
    render();
    clearInterval(timer);
    timer = setInterval(tick, 1000);
  }

  function close() {
    clearInterval(timer); timer = null;
    if (el) el.innerHTML = "";
    el = null; day = null; onChange = null; closeCb = null; inactiveMsg = null;
  }

  return {
    open, close,
    effEst, wrapMinutes, wrapClass, plannedWrapMinutes, curStep, isLunch, isMove, stepKind, dayStarted,
    pressStart, pressDone, pressPartial, pressSkip, pressSlip, pressBack,
    stepForward, ensureStarted, autofillTimes, setCurrent, setActualStart
  };
});
