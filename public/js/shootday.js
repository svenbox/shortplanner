/* Inspelningsläge ("Shoot day mode") — ett förenklat helskärmsläge för
   1:e AD:ns telefon UNDER inspelning. Går igenom dagens steg (scener +
   lunch/förflyttning) ett i taget med stora knappar och stämplar faktiska
   tider, så DPR:n nästan fyller i sig själv.

   Arbetar direkt på DPR-doket (dprDoc.days[i].scenes + .currentIdx) och
   rapporterar ändringar via opts.onChange -> app.js markDirty("dpr").
   Ingen egen lagring, ingen serverdel. Kräver nät (autosave som vanligt).

   Exponeras som window.SD i webbläsaren; går även att require:a i Node så
   den rena logiken (wrapMinutes, press*) kan testas —
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
  function isLunch(step) {
    return /lunch/i.test((step && (step.label || step.set)) || "");
  }

  /* Beräknad wrap: nu + Σ(est + slip) för aktuellt och senare steg som inte
     är klara, minus den tid som redan förflutit på det aktuella steget.
     Returnerar minuter sedan midnatt (kan överstiga 1440 -> m2t slår runt). */
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

  /* "ok" | "warn" | "over" mot arbetstidsslutet (minuter). "" om okänt. */
  function wrapClass(wrapMin, arbetEndMin) {
    if (arbetEndMin == null) return "";
    if (wrapMin <= arbetEndMin) return "ok";
    if (wrapMin <= arbetEndMin + 60) return "warn";
    return "over";
  }

  /* ---------- steg-reducerare (muterar day, testbara) ---------- */

  function autofillTimes(day, step) {
    day.times = day.times || {};
    if (step.type === "scene" && step.actualStart && !day.times.firstShot) day.times.firstShot = step.actualStart;
    if (isLunch(step) && step.actualEnd && !day.times.lunchIn) day.times.lunchIn = step.actualEnd;
    const steps = day.scenes || [];
    if (steps.indexOf(step) === steps.length - 1 && step.actualEnd && !day.times.campWrap) day.times.campWrap = step.actualEnd;
  }

  /* Flytta pekaren ett steg framåt (om möjligt) och stämpla nästa stegs
     faktiska start om den saknas. */
  function stepForward(day, nowStr) {
    const steps = day.scenes || [];
    if ((day.currentIdx || 0) < steps.length - 1) {
      day.currentIdx = (day.currentIdx || 0) + 1;
      const nx = steps[day.currentIdx];
      if (nx && !nx.actualStart) nx.actualStart = nowStr;
      if (nx && isLunch(nx) && nx.actualStart && !(day.times = day.times || {}).lunchOut) day.times.lunchOut = nx.actualStart;
    }
  }

  function ensureStarted(day, nowStr) {
    const s = curStep(day);
    if (s && !s.actualStart) {
      s.actualStart = nowStr;
      if (isLunch(s)) { day.times = day.times || {}; if (!day.times.lunchOut) day.times.lunchOut = nowStr; }
    }
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
    s.status = "";          // hoppa pekaren, lämna som ej avklarad
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

  function nowStr() { const d = new Date(); return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); }
  function nowMin() { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); }
  function nowClock() { const d = new Date(); return nowStr() + ":" + String(d.getSeconds()).padStart(2, "0"); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
  function save() { if (onChange) onChange(); }

  function stepTitle(s) {
    if (!s) return "";
    if (s.type === "info") return esc(s.label || "Paus");
    return "Sc " + esc(s.num || "?");
  }
  function stepSub(s) {
    if (!s) return "";
    if (s.type === "info") return s.est ? fmtEst(parseEst(s.est)) : "";
    return [s.ie, s.set].filter(Boolean).map(esc).join(" · ").toLowerCase();
  }

  function act(fn) {
    return () => { fn(); save(); render(); };
  }

  function render() {
    if (!el || !day) return;
    const steps = day.scenes || [];
    const cur = curStep(day);
    const curIdx = day.currentIdx || 0;
    const done = steps.filter(s => s.type !== "info" && (s.status === "done" || s.status === "partial")).length;
    const total = steps.filter(s => s.type !== "info").length;
    const wrap = wrapMinutes(steps, curIdx, nowMin());
    const arbetEnd = t2m(day.plannedWrapEnd);
    const wc = wrapClass(wrap, arbetEnd);
    const next = steps[curIdx + 1];
    const atEnd = curIdx >= steps.length - 1;
    const allHandled = total > 0 && steps.every(s => s.status);

    if (!steps.length) {
      el.innerHTML = shell(`<p class="sd-empty">Den här dagens call sheet har inga scener.</p>`);
      wire();
      return;
    }

    if (allHandled) {
      const last = steps[steps.length - 1];
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

    const isScene = cur && cur.type === "scene";
    const rows = cur ? [
      ["call", day.plannedCrewCall],
      ["planerad start", isScene ? cur.start : (cur.time || "")],
      ["faktisk start", cur.actualStart, cur.actualStart && cur.actualStart !== cur.start],
      ["beräknad wrap", m2t(wrap), true, wc]
    ] : [];

    el.innerHTML = shell(`
      <div class="sd-card">
        <div class="sd-step-head">
          <span class="sd-step-icon">${cur && cur.type === "info" ? "⏸" : "🎬"}</span>
          <div>
            <div class="sd-step-title">${stepTitle(cur)}</div>
            <div class="sd-step-sub">${stepSub(cur)}</div>
          </div>
          ${(cur && cur.slipMin) ? `<span class="sd-slip-badge">+${cur.slipMin} min</span>` : ""}
        </div>
        <table class="sd-times">
          ${rows.map(r => `<tr class="${r[3] ? "sd-t-" + r[3] : ""}">
            <td class="${r[2] ? "sd-t-strong" : ""}">${esc(r[1] || "—")}</td>
            <td>${esc(r[0])}${r[0] === "beräknad wrap" && wc === "over" ? " ⚠" : (r[0] === "beräknad wrap" && wc === "warn" ? " ⚠" : "")}</td>
          </tr>`).join("")}
        </table>
      </div>

      <div class="sd-next">${next ? "Nästa: " + stepTitle(next) + (stepSub(next) ? " · " + stepSub(next) : "") : "Sista steget"}</div>

      <div class="sd-btns">
        <button class="sd-btn sd-btn-done" data-sd="done">✓ Klar</button>
        ${isScene ? `<button class="sd-btn" data-sd="partial">◐ Delvis</button>` : `<button class="sd-btn" data-sd="skip2">→ Hoppa över</button>`}
      </div>
      <div class="sd-btns">
        ${isScene ? `<button class="sd-btn" data-sd="skip">→ Hoppa över</button>` : `<span></span>`}
        <button class="sd-btn" data-sd="back" ${curIdx === 0 ? "disabled" : ""}>◂ Backa steg</button>
      </div>
      <div class="sd-btns">
        <button class="sd-btn sd-btn-slip" data-sd="s10">+10 min</button>
        <button class="sd-btn sd-btn-slip" data-sd="s20">+20 min</button>
      </div>

      <div class="sd-progress">
        <div class="sd-progress-label"><span>Dagens scener</span><span>${done} / ${total} klara</span></div>
        <div class="sd-dots">${steps.map((s, i) => {
          const cls = s.type === "info" ? "info" : (s.status === "done" ? "done" : s.status === "partial" ? "partial" : (i === curIdx ? "cur" : "todo"));
          return `<span class="sd-dot sd-dot-${cls}"></span>`;
        }).join("")}</div>
      </div>
    `);
    wire();
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

  function wire() {
    el.querySelectorAll("[data-sd]").forEach(b => {
      const k = b.getAttribute("data-sd");
      b.onclick = {
        done: act(() => pressDone(day, nowStr())),
        partial: act(() => pressPartial(day, nowStr())),
        skip: act(() => pressSkip(day, nowStr())),
        skip2: act(() => pressSkip(day, nowStr())),
        back: act(() => pressBack(day)),
        s10: act(() => pressSlip(day, 10)),
        s20: act(() => pressSlip(day, 20)),
        exit: () => { if (closeCb) closeCb(); }
      }[k] || (() => {});
    });
  }

  function tick() {
    if (!el) return;
    const c = el.querySelector("#sd-clock");
    if (c) c.textContent = "nu " + nowClock();
    // beräknad wrap kryper med klockan — uppdatera bara den raden
    const steps = (day && day.scenes) || [];
    const wrap = wrapMinutes(steps, day.currentIdx || 0, nowMin());
    const arbetEnd = t2m(day.plannedWrapEnd);
    const wc = wrapClass(wrap, arbetEnd);
    const row = el.querySelector(".sd-times tr:last-child");
    if (row) {
      row.className = wc ? "sd-t-" + wc : "";
      const td0 = row.querySelector("td");
      if (td0) td0.textContent = m2t(wrap);
    }
  }

  function open(container, dprDoc, dayIndex, options) {
    options = options || {};
    el = container;
    di = dayIndex || 0;
    day = (dprDoc.days || [])[di];
    onChange = options.onChange || null;
    closeCb = options.close || null;
    toast = options.toast || (() => {});
    if (!day) { if (closeCb) closeCb(); return; }
    if (!day.scenes) day.scenes = [];
    if (day.currentIdx == null) day.currentIdx = 0;
    ensureStarted(day, nowStr());
    save();
    render();
    clearInterval(timer);
    timer = setInterval(tick, 1000);
  }

  function close() {
    clearInterval(timer); timer = null;
    if (el) el.innerHTML = "";
    el = null; day = null; onChange = null; closeCb = null;
  }

  return {
    open, close,
    // ren logik för test
    effEst, wrapMinutes, wrapClass, curStep, isLunch,
    pressDone, pressPartial, pressSkip, pressSlip, pressBack, stepForward, ensureStarted, autofillTimes
  };
});
