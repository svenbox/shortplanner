"use strict";
/* Karakteriseringstester för stripboardens tidsregler.
   Låser fast NUVARANDE beteende (inklusive egenheter markerade QUIRK) så att
   refaktorering är säker. Beteendet är beskrivet i
   docs/stripboard-time-rules.md. Kör med `npm test`.

   En egenhet ska bara ändras genom att medvetet ändra test + dokumentation
   i samma commit. */

const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../public/js/stripboard-core.js");

/* Hjälpare för att bygga strips utan massa upprepning. */
const scene = (o = {}) => Object.assign({ type: "scene", num: "", ie: "INT", set: "", dn: "DAG", cast: "", loc: "", pages: "", est: "", start: "", lock: false }, o);
const banner = (o = {}) => Object.assign({ type: "banner", set: "", loc: "", est: "", start: "", lock: false }, o);
const day = (start, strips) => ({ label: "D", date: "", start, strips });
const starts = (d) => d.strips.map(s => s.start);

/* ------------------------------------------------------------------ */
test("parseEst — normala fall", () => {
  assert.equal(C.parseEst("2h"), 120);
  assert.equal(C.parseEst("45m"), 45);
  assert.equal(C.parseEst("1h 30m"), 90);
  assert.equal(C.parseEst("90"), 90, "bart tal = minuter");
  assert.equal(C.parseEst("0"), 0);
  assert.equal(C.parseEst(""), 0);
  assert.equal(C.parseEst(null), 0);
  assert.equal(C.parseEst("abc"), 0);
  assert.equal(C.parseEst("1 h 15 m"), 75);
  assert.equal(C.parseEst("2H"), 120, "skiftlägesokänsligt");
});

test("parseEst — QUIRK: '1h30' tappar minutdelen (ingen 'm')", () => {
  assert.equal(C.parseEst("1h30"), 60);
});

test("parseEst — QUIRK: '1.5h' blir 300 (regex fångar '5h')", () => {
  assert.equal(C.parseEst("1.5h"), 300);
});

test("fmtEst — hela timmar behåller ' 0m', 0 blir tomt", () => {
  assert.equal(C.fmtEst(0), "");
  assert.equal(C.fmtEst(45), "45m");
  assert.equal(C.fmtEst(60), "1h 0m");
  assert.equal(C.fmtEst(90), "1h 30m");
  assert.equal(C.fmtEst(120), "2h 0m");
  assert.equal(C.fmtEst(725), "12h 5m");
});

test("parseEst/fmtEst tur och retur för vanliga värden", () => {
  for (const m of [5, 45, 60, 90, 120, 195, 480]) {
    assert.equal(C.parseEst(C.fmtEst(m)), m);
  }
});

/* ------------------------------------------------------------------ */
test("t2m — tolkar klockslag, punkt eller kolon", () => {
  assert.equal(C.t2m("08:30"), 510);
  assert.equal(C.t2m("8.30"), 510);
  assert.equal(C.t2m("00:00"), 0);
  assert.equal(C.t2m("23:59"), 1439);
});

test("t2m — ogiltig indata ger null", () => {
  assert.equal(C.t2m(""), null);
  assert.equal(C.t2m(null), null);
  assert.equal(C.t2m("noon"), null);
  assert.equal(C.t2m("8:5"), null, "minutdelen måste vara två siffror");
  assert.equal(C.t2m("830"), null);
});

test("t2m — QUIRK: ingen intervallkontroll, '25:00' → 1500", () => {
  assert.equal(C.t2m("25:00"), 1500);
});

test("m2t — normaliserar mod 1440 och hanterar negativa tal", () => {
  assert.equal(C.m2t(510), "08:30");
  assert.equal(C.m2t(0), "00:00");
  assert.equal(C.m2t(1439), "23:59");
  assert.equal(C.m2t(1440), "00:00", "exakt ett dygn slår runt");
  assert.equal(C.m2t(1500), "01:00", "efter midnatt");
  assert.equal(C.m2t(-30), "23:30", "call sheetens '30 min före' vid midnattsstart");
  assert.equal(C.m2t(-1470), "23:30");
});

/* ------------------------------------------------------------------ */
test("parsePages — åttondelar", () => {
  assert.equal(C.parsePages("2 3/8"), 19);
  assert.equal(C.parsePages("3/8"), 3);
  assert.equal(C.parsePages("2"), 16, "bart heltal = hela sidor ×8");
  assert.equal(C.parsePages("9/8"), 9, "ingen normalisering");
  assert.equal(C.parsePages(""), 0);
  assert.equal(C.parsePages("x"), 0);
});

test("fmtPages", () => {
  assert.equal(C.fmtPages(0), "");
  assert.equal(C.fmtPages(3), "3/8");
  assert.equal(C.fmtPages(8), "1 0/8");
  assert.equal(C.fmtPages(19), "2 3/8");
});

/* ------------------------------------------------------------------ */
test("stripClass — lunch/rast/förflyttning känns igen på set-texten", () => {
  assert.equal(C.stripClass(banner({ set: "Lunch" })), "banner break");
  assert.equal(C.stripClass(banner({ set: "RAST" })), "banner break");
  assert.equal(C.stripClass(banner({ set: "Förflyttning till studio" })), "banner move");
  assert.equal(C.stripClass(banner({ set: "Flytt" })), "banner move");
  assert.equal(C.stripClass(banner({ set: "Fika" })), "banner");
});

test("stripClass — scen färgas på I/E + D/N", () => {
  assert.equal(C.stripClass(scene({ ie: "INT", dn: "DAG" })), "int-day");
  assert.equal(C.stripClass(scene({ ie: "EXT", dn: "DAG" })), "ext-day");
  assert.equal(C.stripClass(scene({ ie: "INT", dn: "NATT" })), "int-night");
  assert.equal(C.stripClass(scene({ ie: "EXT", dn: "NIGHT" })), "ext-night");
  assert.equal(C.stripClass(scene({ ie: "", dn: "" })), "int-day", "tomt = int-day");
});

test("stripClass — QUIRK: scen med 'lunch' i set-namnet får break-stil", () => {
  assert.equal(C.stripClass(scene({ ie: "INT", dn: "DAG", set: "LUNCHRUMMET" })), "int-day break");
});

/* ------------------------------------------------------------------ */
test("recalcDay — enkel kedja av strips", () => {
  const d = day("08:00", [scene({ est: "1h" }), scene({ est: "45m" }), scene({ est: "2h" })]);
  C.recalcDay(d);
  assert.deepEqual(starts(d), ["08:00", "09:00", "09:45"]);
});

test("recalcDay — lunch och rast äter av dagen som vilken strip som helst", () => {
  const d = day("08:00", [
    scene({ est: "1h" }),
    banner({ set: "Rast", est: "15m" }),
    scene({ est: "1h" }),
    banner({ set: "Lunch", est: "45m" }),
    scene({ est: "2h" }),
  ]);
  C.recalcDay(d);
  assert.deepEqual(starts(d), ["08:00", "09:00", "09:15", "10:15", "11:00"]);
});

test("recalcDay — company move skjuter fram efterföljande strips", () => {
  const d = day("07:00", [
    scene({ est: "2h" }),
    banner({ set: "Förflyttning", est: "30m" }),
    scene({ est: "1h" }),
  ]);
  C.recalcDay(d);
  assert.deepEqual(starts(d), ["07:00", "09:00", "09:30"]);
});

test("recalcDay — ändrad est-tid räknar om allt efter", () => {
  const d = day("08:00", [scene({ est: "1h" }), scene({ est: "1h" }), scene({ est: "1h" })]);
  C.recalcDay(d);
  assert.deepEqual(starts(d), ["08:00", "09:00", "10:00"]);
  d.strips[0].est = "2h 30m";
  C.recalcDay(d);
  assert.deepEqual(starts(d), ["08:00", "10:30", "11:30"]);
});

test("recalcDay — manuellt låst starttid tvingar löpande tid dit (skapar glapp)", () => {
  const d = day("08:00", [
    scene({ est: "1h" }),
    scene({ est: "1h", start: "13:00", lock: true }),
    scene({ est: "1h" }),
  ]);
  C.recalcDay(d);
  assert.deepEqual(starts(d), ["08:00", "13:00", "14:00"]);
});

test("recalcDay — låst men otolkbar start ignoreras", () => {
  const d = day("08:00", [
    scene({ est: "1h" }),
    scene({ est: "1h", start: "trasig", lock: true }),
    scene({ est: "1h" }),
  ]);
  C.recalcDay(d);
  assert.deepEqual(starts(d), ["08:00", "09:00", "10:00"]);
});

test("recalcDay — QUIRK: lås kan flytta löpande tid BAKÅT (överlapp)", () => {
  const d = day("08:00", [
    scene({ est: "2h" }),                        // skulle sluta 10:00
    scene({ est: "1h", start: "08:30", lock: true }),
  ]);
  C.recalcDay(d);
  assert.deepEqual(starts(d), ["08:00", "08:30"]);
});

test("recalcDay — flera lås i följd", () => {
  const d = day("06:00", [
    scene({ est: "3h", start: "06:00", lock: true }),
    scene({ est: "1h" }),
    scene({ est: "2h", start: "12:00", lock: true }),
    scene({ est: "1h" }),
  ]);
  C.recalcDay(d);
  assert.deepEqual(starts(d), ["06:00", "09:00", "12:00", "14:00"]);
});

test("recalcDay — otolkbar day.start börjar från midnatt", () => {
  const d = day("", [scene({ est: "1h" }), scene({ est: "1h" })]);
  C.recalcDay(d);
  assert.deepEqual(starts(d), ["00:00", "01:00"]);
});

test("recalcDay — MIDNATT: tider efter 24:00 visas som 00:xx/01:xx", () => {
  const d = day("20:00", [scene({ est: "3h" }), scene({ est: "4h" }), scene({ est: "2h" })]);
  C.recalcDay(d);
  assert.deepEqual(starts(d), ["20:00", "23:00", "03:00"]);
});

test("recalcDay — MIDNATT: exakt 24:00 blir 00:00", () => {
  const d = day("22:00", [scene({ est: "2h" }), scene({ est: "1h" })]);
  C.recalcDay(d);
  assert.deepEqual(starts(d), ["22:00", "00:00"]);
});

test("recalcDay — tom dag rör ingenting", () => {
  const d = day("08:00", []);
  C.recalcDay(d);
  assert.deepEqual(starts(d), []);
});

/* ------------------------------------------------------------------ */
test("dayTotals — pages/scenes räknar bara scener, mins räknar allt", () => {
  const d = day("08:00", [
    scene({ est: "1h", pages: "2/8" }),
    banner({ set: "Lunch", est: "45m" }),
    scene({ est: "2h", pages: "1 4/8" }),
  ]);
  C.recalcDay(d);
  const t = C.dayTotals(d);
  assert.equal(t.scenes, 2);
  assert.equal(t.pages, 2 + 12);       // 2/8 + 1 4/8 = 14 åttondelar
  assert.equal(t.mins, 60 + 45 + 120); // lunch räknas med
  assert.equal(t.start, 480);
  assert.equal(t.end, 480 + 225);
  assert.equal(t.span, 225);
});

test("dayTotals — glapp från lås gör span större än mins", () => {
  const d = day("08:00", [
    scene({ est: "1h" }),
    scene({ est: "1h", start: "13:00", lock: true }),
  ]);
  C.recalcDay(d);
  const t = C.dayTotals(d);
  assert.equal(t.mins, 120);
  assert.equal(t.span, 360, "08:00 → 14:00");
});

test("dayTotals — MIDNATT/WRAP: dag som passerar dygnsgränsen", () => {
  const d = day("22:00", [scene({ est: "2h" }), scene({ est: "3h" })]);
  C.recalcDay(d);
  // starts: 22:00, 00:00 ; sista strip 00:00 + 3h = 03:00 → före start → +1440
  const t = C.dayTotals(d);
  assert.equal(t.start, 1320);
  assert.equal(t.end, 1320 + 300, "slut = 03:00 nästa dygn räknat som 27:00");
  assert.equal(t.span, 300);
});

test("dayTotals — otolkbar day.start ger start=0", () => {
  const d = day("nonsens", [scene({ est: "90m" })]);
  C.recalcDay(d);
  const t = C.dayTotals(d);
  assert.equal(t.start, 0);
  assert.equal(t.span, 90);
});

test("dayTotals — tom dag", () => {
  const t = C.dayTotals(day("08:00", []));
  assert.deepEqual(t, { pages: 0, mins: 0, scenes: 0, start: 480, end: 480, span: 0 });
});

/* ------------------------------------------------------------------ */
test("12-timmarsregeln — strikt större än 720 minuter", () => {
  assert.equal(C.DAY_LIMIT_MIN, 720);
  assert.equal(C.isLongDay(719), false);
  assert.equal(C.isLongDay(720), false, "exakt 12h flaggas inte");
  assert.equal(C.isLongDay(721), true);
});

test("12-timmarsregeln — dag på 14h flaggas", () => {
  const d = day("06:00", [scene({ est: "8h" }), scene({ est: "6h" })]);
  C.recalcDay(d);
  const t = C.dayTotals(d);
  assert.equal(t.span, 840);
  assert.equal(C.isLongDay(t.span), true);
});

test("12-timmarsregeln — dag på precis 12h flaggas inte", () => {
  const d = day("08:00", [scene({ est: "6h" }), scene({ est: "6h" })]);
  C.recalcDay(d);
  assert.equal(C.isLongDay(C.dayTotals(d).span), false);
});

/* ------------------------------------------------------------------ */
test("reorderStrips — flytt inom samma dag, nedåt", () => {
  const list = [scene({ num: "1" }), scene({ num: "2" }), scene({ num: "3" }), scene({ num: "4" })];
  const moved = C.reorderStrips(list, 0, list, 3);
  assert.equal(moved, true);
  assert.deepEqual(list.map(s => s.num), ["2", "3", "1", "4"]);
});

test("reorderStrips — flytt inom samma dag, uppåt", () => {
  const list = [scene({ num: "1" }), scene({ num: "2" }), scene({ num: "3" }), scene({ num: "4" })];
  C.reorderStrips(list, 3, list, 1);
  assert.deepEqual(list.map(s => s.num), ["1", "4", "2", "3"]);
});

test("reorderStrips — no-op: släpp exakt där stripen redan ligger", () => {
  const list = [scene({ num: "1" }), scene({ num: "2" }), scene({ num: "3" })];
  assert.equal(C.reorderStrips(list, 1, list, 1), false, "toIdx === fromIdx");
  assert.equal(C.reorderStrips(list, 1, list, 2), false, "toIdx === fromIdx + 1");
  assert.deepEqual(list.map(s => s.num), ["1", "2", "3"], "listan orörd");
});

test("reorderStrips — flytt mellan dagar", () => {
  const d1 = [scene({ num: "1" }), scene({ num: "2" }), scene({ num: "3" })];
  const d2 = [scene({ num: "10" }), scene({ num: "11" })];
  const moved = C.reorderStrips(d1, 1, d2, 1);
  assert.equal(moved, true);
  assert.deepEqual(d1.map(s => s.num), ["1", "3"]);
  assert.deepEqual(d2.map(s => s.num), ["10", "2", "11"]);
});

test("reorderStrips — flytt mellan dagar till slutet", () => {
  const d1 = [scene({ num: "1" }), scene({ num: "2" })];
  const d2 = [scene({ num: "10" })];
  C.reorderStrips(d1, 0, d2, d2.length);
  assert.deepEqual(d1.map(s => s.num), ["2"]);
  assert.deepEqual(d2.map(s => s.num), ["10", "1"]);
});

test("reorderStrips — flytt mellan dagar av samma index är INTE en no-op", () => {
  const d1 = [scene({ num: "1" }), scene({ num: "2" })];
  const d2 = [scene({ num: "10" }), scene({ num: "11" })];
  assert.equal(C.reorderStrips(d1, 1, d2, 1), true);
  assert.deepEqual(d1.map(s => s.num), ["1"]);
  assert.deepEqual(d2.map(s => s.num), ["10", "2", "11"]);
});

/* ------------------------------------------------------------------ */
test("scenario — flytt mellan dagar följt av omräkning på båda", () => {
  const dA = day("08:00", [scene({ num: "1", est: "1h" }), scene({ num: "2", est: "2h" }), scene({ num: "3", est: "1h" })]);
  const dB = day("09:00", [scene({ num: "10", est: "1h" })]);
  // flytta scen 2 från dag A (idx 1) till dag B sist
  C.reorderStrips(dA.strips, 1, dB.strips, dB.strips.length);
  C.recalcDay(dA);
  C.recalcDay(dB);
  assert.deepEqual(starts(dA), ["08:00", "09:00"], "A: 1h + 1h");
  assert.deepEqual(dA.strips.map(s => s.num), ["1", "3"]);
  assert.deepEqual(starts(dB), ["09:00", "10:00"], "B: fick scen 2");
  assert.deepEqual(dB.strips.map(s => s.num), ["10", "2"]);
});

test("scenario — låst strip överlever en omräkning efter est-ändring på annan strip", () => {
  const d = day("08:00", [
    scene({ est: "1h" }),
    scene({ est: "30m" }),
    scene({ est: "1h", start: "12:00", lock: true }),
    scene({ est: "1h" }),
  ]);
  C.recalcDay(d);
  assert.deepEqual(starts(d), ["08:00", "09:00", "12:00", "13:00"]);
  d.strips[0].est = "3h";
  C.recalcDay(d);
  assert.deepEqual(starts(d), ["08:00", "11:00", "12:00", "13:00"], "låset håller 12:00");
});

/* ------------------------------------------------------------------ */
test("closestDayIndex — exakt datummatch vinner", () => {
  const today = C.todayIso();
  const days = [{ date: "2000-01-01" }, { date: today }, { date: "2099-01-01" }];
  assert.equal(C.closestDayIndex(days, "date"), 1);
});

test("closestDayIndex — hela schemat passerat → första dagen", () => {
  const days = [{ date: "2000-01-01" }, { date: "2000-01-02" }];
  assert.equal(C.closestDayIndex(days, "date"), 0);
});

test("closestDayIndex — inga datum → 0", () => {
  assert.equal(C.closestDayIndex([{ date: "" }, { date: "" }], "date"), 0);
  assert.equal(C.closestDayIndex([], "date"), 0);
});

test("closestDayIndex — hela schemat i framtiden → första dagen", () => {
  const days = [{ date: "2099-01-01" }, { date: "2099-01-02" }];
  assert.equal(C.closestDayIndex(days, "date"), 0);
});

/* ------------------------------------------------------------------ */
/* dayWarnings — arbetstids-/vilokontroll */
const wday = (o) => Object.assign({ label: "D", date: "", start: "08:00", strips: [] }, o);
const wstrips = (specs) => specs.map(s => Object.assign({ type: "scene", set: "", est: "", start: "", lock: false }, s));
const texts = (arr) => arr.map(w => w.text);

test("dayWarnings — arbetstid över gränsen (exkl. rast/lunch) → level over", () => {
  const d = wday({ start: "06:00", strips: wstrips([
    { est: "6h", start: "06:00" },
    { set: "Lunch", est: "45m", start: "12:00" },
    { est: "5h 30m", start: "12:45" }
  ]) });
  C.recalcDay(d);
  const w = C.dayWarnings(d, null, null);          // standard: 10h
  // span 06:00 -> 18:15 = 12h15; minus 45m lunch = 11h30 arbetstid > 10h
  const over = w.find(x => /Arbetstid/.test(x.text));
  assert.ok(over, "arbetstidsvarning finns");
  assert.equal(over.level, "over");
  assert.match(over.text, /11h 30m/);
});

test("dayWarnings — arbetstid precis under gränsen → ingen varning", () => {
  const d = wday({ start: "08:00", strips: wstrips([
    { est: "4h", start: "08:00" },
    { set: "Lunch", est: "45m", start: "12:00" },
    { est: "5h", start: "12:45" }
  ]) });
  C.recalcDay(d);
  // span 08:00->17:45 = 9h45; minus 45m = 9h arbetstid < 10h
  assert.equal(C.dayWarnings(d, null, null).some(x => /Arbetstid/.test(x.text)), false);
});

test("dayWarnings — ingen rast/lunch alls", () => {
  const d = wday({ start: "08:00", strips: wstrips([{ est: "3h", start: "08:00" }]) });
  C.recalcDay(d);
  assert.ok(texts(C.dayWarnings(d, null, null)).includes("Ingen rast eller lunch inplanerad"));
});

test("dayWarnings — lunch mer än 5h efter samling", () => {
  const d = wday({ start: "07:00", strips: wstrips([
    { est: "5h 30m", start: "07:00" },
    { set: "Lunch", est: "45m", start: "12:30" }
  ]) });
  C.recalcDay(d);
  const meal = C.dayWarnings(d, null, null).find(x => /efter samling/.test(x.text));
  assert.ok(meal);
  assert.equal(meal.level, "warn");
  assert.match(meal.text, /5h 30m efter samling/);
});

test("dayWarnings — lunch inom 5h → ingen mealvarning", () => {
  const d = wday({ start: "08:00", strips: wstrips([
    { est: "3h", start: "08:00" },
    { set: "Rast", est: "30m", start: "11:00" }
  ]) });
  C.recalcDay(d);
  assert.equal(C.dayWarnings(d, null, null).some(x => /efter samling/.test(x.text)), false);
});

test("dayWarnings — för kort vila mot föregående dag (över dygnsgränsen)", () => {
  const prev = wday({ label: "Dag 2", date: "2026-11-10", start: "10:00", strips: wstrips([
    { est: "13h", start: "10:00" }   // wrappar 23:00
  ]) });
  C.recalcDay(prev);
  const today = wday({ label: "Dag 3", date: "2026-11-11", start: "07:00", strips: wstrips([{ est: "4h", start: "07:00" }]) });
  C.recalcDay(today);
  const rest = C.dayWarnings(today, prev, null).find(x => /vila efter/.test(x.text));
  assert.ok(rest, "vilovarning finns");
  assert.equal(rest.level, "over");
  assert.match(rest.text, /8h 0m vila efter Dag 2/);
});

test("dayWarnings — tillräcklig vila → ingen vilovarning", () => {
  const prev = wday({ label: "Dag 1", date: "2026-11-09", start: "08:00", strips: wstrips([{ est: "9h", start: "08:00" }]) }); // wrap 17:00
  C.recalcDay(prev);
  const today = wday({ label: "Dag 2", date: "2026-11-10", start: "08:00", strips: wstrips([{ est: "4h", start: "08:00" }]) }); // 15h vila
  C.recalcDay(today);
  assert.equal(C.dayWarnings(today, prev, null).some(x => /vila efter/.test(x.text)), false);
});

test("dayWarnings — vilodag emellan (gap > 1 dygn) → ingen vilovarning", () => {
  const prev = wday({ label: "Dag 1", date: "2026-11-09", start: "08:00", strips: wstrips([{ est: "13h", start: "08:00" }]) });
  C.recalcDay(prev);
  const today = wday({ label: "Dag 2", date: "2026-11-12", start: "07:00", strips: wstrips([{ est: "4h", start: "07:00" }]) }); // 2 dagars gap
  C.recalcDay(today);
  assert.equal(C.dayWarnings(today, prev, null).some(x => /vila efter/.test(x.text)), false);
});

test("dayWarnings — egna gränsvärden via limits", () => {
  const d = wday({ start: "08:00", strips: wstrips([{ est: "8h", start: "08:00" }]) });
  C.recalcDay(d);
  // 8h span, ingen rast. Standard 10h -> ingen arbetstidsvarning. Gräns 6h -> varning.
  assert.equal(C.dayWarnings(d, null, {}).some(x => /Arbetstid/.test(x.text)), false);
  assert.equal(C.dayWarnings(d, null, { maxWorkdayMin: 360 }).some(x => /Arbetstid/.test(x.text)), true);
});

test("dayWarnings — tom dag / ingen starttid → inga varningar", () => {
  assert.deepEqual(C.dayWarnings(wday({ strips: [] }), null, null), []);
  assert.deepEqual(C.dayWarnings(wday({ start: "", strips: wstrips([{ est: "1h" }]) }), null, null), []);
});
