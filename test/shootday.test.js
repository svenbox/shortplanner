"use strict";
/* Inspelningsläget (shoot day mode) — ren logik. wrapMinutes,
   slip-hantering och knapp-reducerarna (pressDone/Partial/Skip/Slip/Back)
   samt att faktiska tider matas in i DPR-dagen automatiskt.
   Kör med `npm test`. */

const test = require("node:test");
const assert = require("node:assert/strict");
const SD = require("../public/js/shootday.js");

const scene = (o = {}) => Object.assign({ type: "scene", num: "1", ie: "INT", set: "KÖK", pages: "1/8", est: "1h", start: "09:00", status: "", pagesShot: "", actualStart: "", actualEnd: "", slipMin: 0 }, o);
const info = (o = {}) => Object.assign({ type: "info", label: "Lunch", est: "45m", time: "12:00", status: "", actualStart: "", actualEnd: "", slipMin: 0 }, o);
const day = (steps, o = {}) => Object.assign({ label: "Dag 3", plannedCrewCall: "08:00", plannedWrapEnd: "18:00", currentIdx: 0, times: {}, scenes: steps }, o);

/* ---------------- effEst ---------------- */
test("effEst — est + slip, aldrig negativt", () => {
  assert.equal(SD.effEst(scene({ est: "1h" })), 60);
  assert.equal(SD.effEst(scene({ est: "1h", slipMin: 20 })), 80);
  assert.equal(SD.effEst(scene({ est: "", slipMin: 10 })), 10);
  assert.equal(SD.effEst(scene({ est: "30m", slipMin: -999 })), 0);
});

/* ---------------- wrapMinutes ---------------- */
test("wrapMinutes — enkel kedja utan slip, inget påbörjat", () => {
  const steps = [scene({ est: "1h" }), scene({ est: "2h" }), scene({ est: "30m" })];
  // nu = 09:00 (540). Inget actualStart => hela 3.5h återstår => 12:30
  assert.equal(SD.wrapMinutes(steps, 0, 540), 540 + 210);
});

test("wrapMinutes — drar av förfluten tid på aktuellt steg", () => {
  const steps = [scene({ est: "1h", actualStart: "09:00" }), scene({ est: "1h" })];
  // nu 09:40 (580). Aktuellt steg: 60 min budget, 40 gått => 20 kvar. + nästa 60 => wrap 11:00
  assert.equal(SD.wrapMinutes(steps, 0, 580), 660);
});

test("wrapMinutes — +slip skjuter wrap framåt", () => {
  const steps = [scene({ est: "1h", actualStart: "09:00", slipMin: 20 }), scene({ est: "1h" })];
  // nu 09:40. budget 80, 40 gått => 40 kvar. + 60 => wrap 11:20
  assert.equal(SD.wrapMinutes(steps, 0, 580), 680);
});

test("wrapMinutes — klara/delvis steg räknas inte", () => {
  const steps = [scene({ est: "1h", status: "done" }), scene({ est: "2h", actualStart: "10:00" }), scene({ est: "1h" })];
  // cur = idx 1. nu 10:30 (630). budget 120, 30 gått => 90 kvar. + nästa 60 => wrap 13:00
  assert.equal(SD.wrapMinutes(steps, 1, 630), 780);
});

test("wrapMinutes — passerar midnatt (minuter kan överstiga 1440)", () => {
  const steps = [scene({ est: "3h", actualStart: "22:00" }), scene({ est: "2h" })];
  // nu 22:30 (1350). budget 180, 30 gått => 150 kvar. + 120 => 1350 + 270 = 1620 (= 03:00 nästa dygn)
  assert.equal(SD.wrapMinutes(steps, 0, 1350), 1620);
});

test("wrapClass — grön inom, gul upp till +1h, röd däröver", () => {
  assert.equal(SD.wrapClass(1000, 1080), "ok");
  assert.equal(SD.wrapClass(1080, 1080), "ok");
  assert.equal(SD.wrapClass(1120, 1080), "warn");
  assert.equal(SD.wrapClass(1140, 1080), "warn");
  assert.equal(SD.wrapClass(1141, 1080), "over");
  assert.equal(SD.wrapClass(1200, null), "");
});

/* ---------------- reducerare ---------------- */
test("pressDone — stämplar slut, status done, förifyller sidor, flyttar pekaren + stämplar nästa", () => {
  const d = day([scene({ actualStart: "09:03" }), scene({ num: "2" })]);
  SD.pressDone(d, "10:05");
  assert.equal(d.scenes[0].status, "done");
  assert.equal(d.scenes[0].actualEnd, "10:05");
  assert.equal(d.scenes[0].pagesShot, "1/8", "förifylls med planerad sidlängd");
  assert.equal(d.currentIdx, 1);
  assert.equal(d.scenes[1].actualStart, "10:05", "nästa stegs faktiska start stämplas");
  assert.equal(d.times.firstShot, "09:03", "första tagningen matas in i DPR-dagens tider");
});

test("pressPartial — status partial, sidor lämnas manuella", () => {
  const d = day([scene({ actualStart: "09:00" }), scene({ num: "2" })]);
  SD.pressPartial(d, "09:50");
  assert.equal(d.scenes[0].status, "partial");
  assert.equal(d.scenes[0].actualEnd, "09:50");
  assert.equal(d.scenes[0].pagesShot, "", "inte förifyllt vid delvis");
  assert.equal(d.currentIdx, 1);
});

test("pressSkip — pekaren flyttas, status lämnas TOM (ej avklarad), inget slut stämplas", () => {
  const d = day([scene({ actualStart: "09:00", status: "" }), scene({ num: "2" })]);
  SD.pressSkip(d, "09:30");
  assert.equal(d.scenes[0].status, "", "ej avklarad");
  assert.equal(d.scenes[0].actualEnd, "", "inget slut");
  assert.equal(d.currentIdx, 1);
  assert.equal(d.scenes[1].actualStart, "09:30");
});

test("pressSlip — adderar till aktuellt steg", () => {
  const d = day([scene()]);
  SD.pressSlip(d, 10); SD.pressSlip(d, 20);
  assert.equal(d.scenes[0].slipMin, 30);
});

test("pressBack — backar pekaren, inte förbi 0", () => {
  const d = day([scene(), scene({ num: "2" })], { currentIdx: 1 });
  SD.pressBack(d); assert.equal(d.currentIdx, 0);
  SD.pressBack(d); assert.equal(d.currentIdx, 0);
});

test("pekaren stannar på sista steget (advance förbi slutet gör inget)", () => {
  const d = day([scene(), scene({ num: "2" })], { currentIdx: 1 });
  SD.pressDone(d, "17:00");
  assert.equal(d.currentIdx, 1, "ingen scen efter — pekaren kvar");
  assert.equal(d.scenes[1].status, "done");
  assert.equal(d.times.campWrap, "17:00", "sista stegets slut blir wrap (inspelning)");
});

/* ---------------- lunch-autofyll ---------------- */
test("lunch som eget steg matar DPR-dagens lunchOut/lunchIn", () => {
  const d = day([scene({ actualStart: "09:00" }), info({ label: "LUNCH" }), scene({ num: "2" })]);
  SD.pressDone(d, "11:45");                 // klar scen 1 -> in i lunch, stämplar lunch.actualStart = 11:45
  assert.equal(d.currentIdx, 1);
  assert.equal(d.scenes[1].actualStart, "11:45");
  assert.equal(d.times.lunchOut, "11:45");
  SD.pressDone(d, "12:30");                 // klar lunch -> lunchIn
  assert.equal(d.times.lunchIn, "12:30");
  assert.equal(d.currentIdx, 2);
});

test("ensureStarted — stämplar aktuellt stegs start om den saknas", () => {
  const d = day([scene({ actualStart: "" })]);
  SD.ensureStarted(d, "08:57");
  assert.equal(d.scenes[0].actualStart, "08:57");
  SD.ensureStarted(d, "09:10");
  assert.equal(d.scenes[0].actualStart, "08:57", "rör inte en redan satt start");
});

test("curStep / isLunch", () => {
  const d = day([scene(), info({ label: "Lunchpaus" })], { currentIdx: 1 });
  assert.equal(SD.curStep(d).label, "Lunchpaus");
  assert.equal(SD.isLunch(SD.curStep(d)), true);
  assert.equal(SD.isLunch(scene({ set: "KÖK" })), false);
});

/* ---------------- v2 ---------------- */
test("dayStarted / pressStart — startskärmen tills första stegets start stämplats", () => {
  const d = day([scene({ actualStart: "" }), scene({ num: "2" })]);
  assert.equal(SD.dayStarted(d), false);
  SD.pressStart(d, "08:58");
  assert.equal(d.scenes[0].actualStart, "08:58");
  assert.equal(d.times.firstShot, "08:58", "första tagningen matas in när dagen startar på en scen");
  assert.equal(SD.dayStarted(d), true);
  SD.pressStart(d, "09:30");
  assert.equal(d.scenes[0].actualStart, "08:58", "startar inte om");
});

test("setCurrent — hoppar pekaren, stämplar start, rör inga statusar; klampas till intervallet", () => {
  const d = day([scene({ actualStart: "09:00", status: "" }), scene({ num: "2" }), scene({ num: "3" })]);
  SD.setCurrent(d, 2, "11:15");
  assert.equal(d.currentIdx, 2);
  assert.equal(d.scenes[2].actualStart, "11:15");
  assert.equal(d.scenes[1].status, "", "mellansteg lämnas orört (ej avklarat)");
  assert.equal(d.scenes[1].actualStart, "", "mellansteg får ingen start");
  SD.setCurrent(d, 0, "11:20");
  assert.equal(d.currentIdx, 0, "bakåthopp ok");
  assert.equal(d.scenes[0].actualStart, "09:00", "rör inte en redan satt start vid bakåthopp");
  SD.setCurrent(d, 99, "12:00");
  assert.equal(d.currentIdx, 2, "klampas till sista steget");
});

test("setActualStart — giltig tid sätts, ogiltig ignoreras, kedjan hålls konsekvent", () => {
  const d = day([scene({ actualStart: "09:00", actualEnd: "10:00", status: "done" }), scene({ num: "2", actualStart: "10:00" })], { currentIdx: 1, times: { firstShot: "09:00" } });
  assert.equal(SD.setActualStart(d, 1, "10:12"), true);
  assert.equal(d.scenes[1].actualStart, "10:12");
  assert.equal(d.scenes[0].actualEnd, "10:12", "föregående stegs slut flyttas med (var samma som gamla starten)");
  assert.equal(SD.setActualStart(d, 1, "kaka"), false, "ogiltig -> ignoreras");
  assert.equal(d.scenes[1].actualStart, "10:12", "oförändrad efter ogiltig inmatning");
  assert.equal(SD.setActualStart(d, 0, "08:55"), true);
  assert.equal(d.times.firstShot, "08:55", "DPR-dagens firstShot flyttas med när den var härledd från just den tiden");
});

test("isMove / stepKind", () => {
  assert.equal(SD.isMove(info({ label: "Förflyttning till studio" })), true);
  assert.equal(SD.isMove(info({ label: "Company move" })), true);
  assert.equal(SD.isMove(info({ label: "Lunch" })), false);
  assert.equal(SD.stepKind(scene()), "scene");
  assert.equal(SD.stepKind(info({ label: "LUNCH" })), "lunch");
  assert.equal(SD.stepKind(info({ label: "Flytt" })), "move");
  assert.equal(SD.stepKind(info({ label: "Säkerhetsgenomgång" })), "info");
});

test("plannedWrapMinutes — planerad start + Σ est", () => {
  const steps = [scene({ start: "08:00", est: "1h" }), info({ label: "Lunch", est: "45m", time: "12:00" }), scene({ num: "2", est: "2h" })];
  // 08:00 (480) + 60 + 45 + 120 = 705 = 11:45
  assert.equal(SD.plannedWrapMinutes(steps), 705);
  assert.equal(SD.plannedWrapMinutes([]), null);
});
