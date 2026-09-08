#!/usr/bin/env node
/* Rullar demoprojektets datum så att inspelningsdag 1 alltid är IDAG
   (värdens lokala datum). Alla datum flyttas med samma antal dygn, så
   gapet mellan dagarna behålls. Körs av deploy/demo-reset.sh EFTER att
   seed-databasen kopierats in, mot en stoppad container.

   Med dag 1 = idag fungerar 🎬 Inspelningsläge alltid (kräver en DPR-dag
   inom ett dygn från idag) och vädret finns (SMHI ~1 vecka framåt).

   Användning:  node scripts/demo-redate.js /data/shortplanner.db
*/
"use strict";
const path = require("path");
const Database = require("better-sqlite3");
const SB = require(path.join(__dirname, "../public/js/stripboard-core.js"));

const DB = process.argv[2] || "/data/shortplanner.db";
const WD = SB.SV_DAYS_LONG || ["Söndag", "Måndag", "Tisdag", "Onsdag", "Torsdag", "Fredag", "Lördag"];
const WD_RE = new RegExp("^(" + WD.join("|") + ")\\b");

function ymd(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function noon(iso) { return /^\d{4}-\d{2}-\d{2}$/.test(iso || "") ? new Date(iso + "T12:00:00") : null; }
function shift(iso, days) {
  const d = noon(iso); if (!d) return iso;
  d.setDate(d.getDate() + days);
  return ymd(d);
}
function relabel(s, iso) {
  const d = noon(iso); if (!d || typeof s !== "string") return s;
  return s.replace(WD_RE, WD[d.getDay()]);
}

const db = new Database(DB);
const rows = db.prepare("SELECT project_id, kind, data FROM docs WHERE kind IN ('stripboard','callsheet','dpr','meta')").all();
const byKind = {};
for (const r of rows) { try { byKind[r.kind] = { pid: r.project_id, obj: JSON.parse(r.data) }; } catch (_) {} }

const sb = byKind.stripboard && byKind.stripboard.obj;
const sbDays = (sb && Array.isArray(sb.days) ? sb.days : []).filter(x => /^\d{4}-\d{2}-\d{2}$/.test(x.date || ""));
if (!sbDays.length) { console.error("demo-redate: hittade inga daterade stripboard-dagar, avbryter"); process.exit(1); }

const earliest = sbDays.map(x => x.date).sort()[0];
const today = ymd(new Date());
const delta = Math.round((noon(today) - noon(earliest)) / 86400000);
console.log(`demo-redate: dag 1 ${earliest} -> ${today} (${delta >= 0 ? "+" : ""}${delta} dygn)`);

const upd = db.prepare("UPDATE docs SET data = ?, updated_at = ? WHERE project_id = ? AND kind = ?");
const now = new Date().toISOString();
const tx = db.transaction(() => {
  for (const kind of ["stripboard", "callsheet", "dpr", "meta"]) {
    const e = byKind[kind]; if (!e) continue;
    const o = e.obj;
    if (kind === "meta") {
      if (o.shootStart) o.shootStart = shift(o.shootStart, delta);
      if (o.shootEnd) o.shootEnd = shift(o.shootEnd, delta);
    } else {
      for (const day of (o.days || [])) {
        if (day.date) { day.date = shift(day.date, delta); if (day.label) day.label = relabel(day.label, day.date); }
        if (day.date_iso) {
          day.date_iso = shift(day.date_iso, delta);
          if (kind === "callsheet") {
            day.date = SB.dateSv(day.date_iso);
            if (day.label) day.label = relabel(day.label, day.date_iso);
            if (day.dayOf) day.dayOf = relabel(day.dayOf, day.date_iso);
          }
        }
      }
    }
    upd.run(JSON.stringify(o), now, e.pid, kind);
  }
});
tx();
db.close();
console.log("demo-redate: klar");
