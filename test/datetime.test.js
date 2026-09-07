"use strict";
/* Datum/tid: bevisar att en inspelningsdags DATUM och en schemarad TID
   inte tyst förskjuts av webbläsarens tidszon eller UTC-konvertering.

   Kanonisk representation (se docs/datetime-canonical.md):
     - inspelningsdag  = "YYYY-MM-DD"      (sträng, aldrig Date/epoch)
     - väggklockstid   = "HH:MM" + heltalsminuter-sedan-midnatt i schemamatten
   Kalenderräkning sker vid LOKAL MIDDAG, väggklockan är ren heltalsmatte.

   Testerna körs dels i processens tidszon, dels i barnprocesser under
   flera tidszoner (inkl. UTC+14 och UTC-12) — resultaten måste vara
   identiska. Svenska sommartidsbyten 2026: 29 mars (fram), 25 okt (bak).

   Kör med `npm test`. */

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { execFileSync } = require("child_process");

const CORE = path.resolve(__dirname, "../public/js/stripboard-core.js");
const C = require(CORE);

/* Kör ett uttryck mot core i en barnprocess med given TZ. */
function inTZ(tz, expr) {
  const src = `const C=require(${JSON.stringify(CORE)});process.stdout.write(JSON.stringify(${expr}));`;
  const out = execFileSync(process.execPath, ["-e", src], { env: { ...process.env, TZ: tz }, encoding: "utf8" });
  return JSON.parse(out);
}
const TZS = ["Europe/Stockholm", "UTC", "America/Los_Angeles", "Pacific/Kiritimati" /* +14 */, "Etc/GMT+12" /* -12 */];

/* ------------------------------------------------------------------ */
test("addDays — steg över svenskt sommartidsbyte och årsskifte", () => {
  assert.equal(C.addDays("2026-03-28", 1), "2026-03-29", "in i sommartid");
  assert.equal(C.addDays("2026-03-29", 1), "2026-03-30", "ut ur bytesdagen");
  assert.equal(C.addDays("2026-10-24", 1), "2026-10-25", "in i normaltid");
  assert.equal(C.addDays("2026-10-25", 1), "2026-10-26");
  assert.equal(C.addDays("2026-12-31", 1), "2027-01-01", "årsskifte");
  assert.equal(C.addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(C.addDays("2024-02-28", 1), "2024-02-29", "skottår");
  assert.equal(C.addDays("kass", 1), "");
});

test("daysBetween — korrekt antal dygn även när intervallet spänner ett DST-byte", () => {
  assert.equal(C.daysBetween("2026-03-30", "2026-03-27"), 3, "spänner vår-bytet (71 h → 3)");
  assert.equal(C.daysBetween("2026-10-26", "2026-10-24"), 2, "spänner höst-bytet (49 h → 2)");
  assert.equal(C.daysBetween("2026-03-29", "2026-03-29"), 0);
  assert.equal(C.daysBetween("2027-01-01", "2026-12-31"), 1);
});

test("dateSv / dateShort — rätt veckodag och datum kring bytesdagarna", () => {
  assert.match(C.dateSv("2026-03-29", true), /^Söndag 29 mar 2026$/);
  assert.match(C.dateSv("2026-10-25", true), /^Söndag 25 okt 2026$/);
  assert.deepEqual(C.dateShort("2026-03-29"), { m: "MAR", d: "29" });
  assert.deepEqual(C.dateShort("2026-10-25"), { m: "OKT", d: "25" });
  assert.equal(C.dateSv(""), "");
  assert.deepEqual(C.dateShort("skräp"), { m: "", d: "" });
});

/* ------------------------------------------------------------------ */
test("inspelningsdagens datum är IDENTISKT oavsett tidszon (UTC-12 … UTC+14)", () => {
  const probe = "({" +
    "a:C.addDays('2026-03-28',1)," +
    "b:C.addDays('2026-10-24',1)," +
    "c:C.addDays('2026-12-31',1)," +
    "d:C.daysBetween('2026-03-30','2026-03-27')," +
    "e:C.daysBetween('2026-10-26','2026-10-24')," +
    "f:C.dateSv('2026-03-29',true)," +
    "g:C.dateShort('2026-10-25')," +
    "h:C.closestDayIndex([{date:'2026-03-28'},{date:'2026-03-29'},{date:'2026-03-30'}],'date')" +
  "})";
  const results = TZS.map(tz => [tz, inTZ(tz, probe)]);
  const [, ref] = results[0];
  for (const [tz, r] of results) {
    assert.deepEqual(r, ref, `TZ=${tz} gav ett annat resultat än ${results[0][0]}`);
  }
  // och referensen är den vi förväntar oss
  assert.equal(ref.a, "2026-03-29");
  assert.equal(ref.c, "2027-01-01");
  assert.equal(ref.d, 3);
  assert.equal(ref.f, "Söndag 29 mar 2026");
});

/* ------------------------------------------------------------------ */
test("väggklockstid — ren heltalsmatte, oberoende av tidszon", () => {
  const probe = "({" +
    "wrap:C.m2t(1500)," +          // 25:00 → 01:00
    "neg:C.m2t(-30)," +            // 23:30
    "parse:C.t2m('08:30')," +      // 510
    "mid:C.m2t(1440)" +           // 00:00
  "})";
  const ref = { wrap: "01:00", neg: "23:30", parse: 510, mid: "00:00" };
  for (const tz of TZS) assert.deepEqual(inTZ(tz, probe), ref, `TZ=${tz}`);
});

test("schema som passerar midnatt — starttider slår runt, span räknas rätt", () => {
  const day = {
    start: "22:00",
    strips: [
      { type: "scene", est: "1h 30m", start: "", lock: false },
      { type: "scene", est: "2h", start: "", lock: false },
      { type: "scene", est: "1h", start: "", lock: false }
    ]
  };
  C.recalcDay(day);
  assert.deepEqual(day.strips.map(s => s.start), ["22:00", "23:30", "01:30"], "tider efter 24:00 visas som 00:xx/01:xx");
  const t = C.dayTotals(day);
  assert.equal(t.start, 1320);                 // 22:00
  assert.equal(t.span, 270, "22:00 → 02:30 = 4 h 30 m");
  assert.equal(C.isLongDay(t.span), false);
});

test("låst starttid efter midnatt hanteras som väggklocka, inte som Date", () => {
  const day = {
    start: "20:00",
    strips: [
      { type: "scene", est: "3h", start: "", lock: false },
      { type: "scene", est: "2h", start: "00:30", lock: true },
      { type: "scene", est: "1h", start: "", lock: false }
    ]
  };
  C.recalcDay(day);
  assert.deepEqual(day.strips.map(s => s.start), ["20:00", "00:30", "02:30"]);
});
