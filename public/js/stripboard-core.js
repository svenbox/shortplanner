/* Stripboardens rena domänlogik — ingen DOM, inga globaler, inga sidoeffekter
   (utom recalcDay/reorderStrips som medvetet muterar objekt de får in).

   Bor separat från stripboard.js så att tidsreglerna kan testas i Node
   (`npm test` → test/stripboard-core.test.js) och återanvändas av andra
   moduler. Beteendet är dokumenterat i docs/stripboard-time-rules.md och
   låst av testsviten — ändra inte utan att uppdatera båda medvetet.

   Laddas som ett vanligt <script> före stripboard.js (sätter window.SBCore)
   och går även att `require()` i Node. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.SBCore = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const SV_DAYS = ["sön", "mån", "tis", "ons", "tors", "fre", "lör"];
  const SV_DAYS_LONG = ["Söndag", "Måndag", "Tisdag", "Onsdag", "Torsdag", "Fredag", "Lördag"];
  const SV_MON = ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];

  /* Dagsgräns: en dag flaggas som för lång när span STRIKT överstiger detta. */
  const DAY_LIMIT_MIN = 12 * 60;

  /* ---- tid & mängder ---- */

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

  /* ---- datum ----
     Kanonisk representation för en inspelningsdag är strängen "YYYY-MM-DD".
     Ingen Date/epoch lagras. När vi MÅSTE räkna kalender (veckodag, datum-
     differens, +1 dag) parsar vi ALLTID vid LOKAL middag ("...T12:00:00",
     ingen Z) och läser LOKALA delar (getDate osv), aldrig toISOString().
     Middagsankaret gör att sommartidsbytet (kl 02–03) och midnatt inte kan
     knuffa dagen till gårdagen/morgondagen, oavsett webbläsarens tidszon.
     Se docs/datetime-canonical.md. */

  function ymd(y, m, d) {
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  /* "YYYY-MM-DD" vid lokal middag, eller null om ogiltigt. */
  function parseLocalNoon(iso) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ""))) return null;
    const d = new Date(iso + "T12:00:00");
    return isNaN(d) ? null : d;
  }

  function dateSv(iso, long) {
    const d = parseLocalNoon(iso);
    if (!d) return iso || "";
    return `${long ? SV_DAYS_LONG[d.getDay()] : SV_DAYS[d.getDay()]} ${d.getDate()} ${SV_MON[d.getMonth()]} ${d.getFullYear()}`;
  }

  function dateShort(iso) {
    const d = parseLocalNoon(iso);
    if (!d) return { m: "", d: "" };
    return { m: SV_MON[d.getMonth()].toUpperCase(), d: String(d.getDate()).padStart(2, "0") };
  }

  function todayIso() {
    const d = new Date();
    return ymd(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }

  function daysBetween(isoA, isoB) {
    const a = parseLocalNoon(isoA), b = parseLocalNoon(isoB);
    if (!a || !b) return Infinity;
    // Middagsankare: en DST-dag är 23 eller 25 h, men round() suger upp ±1 h.
    return Math.round((a - b) / 86400000);
  }

  /* "YYYY-MM-DD" + n dygn → "YYYY-MM-DD". DST-/tidszonssäkert: parsar vid
     lokal middag, stegar med setDate(), läser tillbaka LOKALA delar. */
  function addDays(iso, n) {
    const d = parseLocalNoon(iso);
    if (!d) return "";
    d.setDate(d.getDate() + (n | 0));
    return ymd(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }

  /* Exakt datummatch vinner; annars den dag som ligger närmast i tid. Har HELA
     schemat redan passerat återgår vi till FÖRSTA dagen (medvetet "börja om
     från toppen"). Delas av Stripboard, Call sheet och Dagsmanus. */
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

  /* ---- strip-klassificering (lunch / rast / förflyttning / natt / ext) ---- */

  function stripClass(s) {
    const set = s.set || "";
    const extra = /rast|lunch/i.test(set) ? " break" : /förflyttning|flytt/i.test(set) ? " move" : "";
    if (s.type === "banner") return "banner" + extra;
    const night = /natt|night/i.test(s.dn || "");
    const ext = /^ext/i.test(s.ie || "");
    return (ext ? "ext-" : "int-") + (night ? "night" : "day") + extra;
  }

  /* ---- dagsberäkningar ---- */

  /* Muterar day.strips[*].start. Låst strip med tolkningsbar start tvingar
     löpande tid dit; annars sekventiellt via est. m2t slår runt vid midnatt. */
  function recalcDay(day) {
    let run = t2m(day.start);
    if (run == null) run = 0;
    day.strips.forEach(s => {
      if (s.lock && t2m(s.start) != null) run = t2m(s.start);
      s.start = m2t(run);
      run += parseEst(s.est);
    });
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

  function isLongDay(span) {
    return span > DAY_LIMIT_MIN;
  }

  /* ---- flytta strip (ren array-del av moveStrip) ---- */

  /* Flyttar ett element mellan (eller inom) två arrayer. Returnerar false om
     det vore en no-op — att släppa en strip exakt där den redan ligger.
     Muterar `from` och `to`. */
  function reorderStrips(from, fromIdx, to, toIdx) {
    const sameList = from === to;
    if (sameList && (toIdx === fromIdx || toIdx === fromIdx + 1)) return false;
    const [s] = from.splice(fromIdx, 1);
    if (sameList && toIdx > fromIdx) toIdx--;
    to.splice(toIdx, 0, s);
    return true;
  }

  return {
    SV_DAYS, SV_DAYS_LONG, SV_MON, DAY_LIMIT_MIN,
    parseEst, fmtEst, parsePages, fmtPages, t2m, m2t,
    dateSv, dateShort, todayIso, daysBetween, addDays, closestDayIndex,
    stripClass, recalcDay, dayTotals, isLongDay, reorderStrips
  };
});
