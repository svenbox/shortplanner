"use strict";
/* Validering av sparade dokument + importerade projekt (validate.js), och
   att importen (store.importProject) är atomär. Kör med `npm test`. */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "sp-validate-"));
process.env.DATA_DIR = TMP;
process.env.SESSION_SECRET = "testsecret";

const V = require("../validate.js");
const { db } = require("../db.js");
const store = require("../store.js");

/* ---- fixturer ---- */
const goodStripboard = () => ({
  production: { film: "F", version: "", producent: "", regi: "" },
  cast: [{ id: "1", role: "A" }],
  days: [{ label: "Dag 1", date: "2026-10-05", start: "08:00", strips: [
    { type: "scene", num: "1", ie: "INT", set: "KÖK", dn: "DAG", est: "1h", start: "08:00", lock: false }
  ] }],
  unscheduled: []
});
const goodCallsheet = () => ({ production: { film: "F" }, days: [{ label: "Dag 1", date_iso: "2026-10-05", scenes: [], cast: [] }] });
const goodScript = () => ({ id: null, projectId: null, title: "T", draft: "", scenes: [
  { number: "1", slugline: "INT. KÖK - DAG", body: [{ kind: "action", text: "Hon går in." }] }
] });
const goodDpr = () => ({ id: null, projectId: null, days: [] });
const goodMeta = () => ({ title: "T", company: "", producer: "", director: "" });

const goodExport = () => ({
  format: "shortplanner/project@1",
  name: "Proj",
  exported_at: "2026-09-07T00:00:00.000Z",
  stripboard: goodStripboard(),
  callsheet: goodCallsheet(),
  script: goodScript(),
  dpr: goodDpr(),
  meta: goodMeta(),
  versions: [
    { label: "v1", note: "", stripboard: goodStripboard(), callsheet: goodCallsheet(), script: null, dpr: null, created_at: "2026-09-01T00:00:00.000Z" }
  ]
});

/* ============ validateDoc ============ */
test("validateDoc — godtar realistiska dokument av varje typ", () => {
  assert.doesNotThrow(() => V.validateDoc("stripboard", goodStripboard()));
  assert.doesNotThrow(() => V.validateDoc("callsheet", goodCallsheet()));
  assert.doesNotThrow(() => V.validateDoc("script", goodScript()));
  assert.doesNotThrow(() => V.validateDoc("dpr", goodDpr()));
  assert.doesNotThrow(() => V.validateDoc("meta", goodMeta()));
});

test("validateDoc — okända EXTRA fält är ok (framåtkompatibelt)", () => {
  const sb = goodStripboard();
  sb.somethingNew = { nested: true };
  sb.days[0].strips[0].futureField = 42;
  assert.doesNotThrow(() => V.validateDoc("stripboard", sb));
});

test("validateDoc — avvisar fel toppnivåtyp", () => {
  assert.throws(() => V.validateDoc("stripboard", null), /måste vara ett objekt/);
  assert.throws(() => V.validateDoc("stripboard", []), /måste vara ett objekt/);
  assert.throws(() => V.validateDoc("stripboard", "sträng"), /måste vara ett objekt/);
  assert.throws(() => V.validateDoc("nonsens", {}), /okänd dokumenttyp/);
});

test("validateDoc — stripboard: strukturkrav", () => {
  assert.throws(() => V.validateDoc("stripboard", { days: "x" }), /days måste vara en lista/);
  assert.throws(() => V.validateDoc("stripboard", { days: [{ label: "d" }] }), /strips måste vara en lista/);
  assert.throws(() => V.validateDoc("stripboard", { days: [{ strips: ["inte ett objekt"] }] }), /strips\[0\] måste vara ett objekt/);
  assert.throws(() => V.validateDoc("stripboard", { days: [{ strips: [] }], unscheduled: {} }), /unscheduled måste vara en lista/);
  assert.throws(() => V.validateDoc("stripboard", { days: [{ strips: [] }], production: [] }), /production måste vara ett objekt/);
});

test("validateDoc — storleksgräns i byte", () => {
  const sb = goodStripboard();
  sb.days[0].strips[0].blob = "x".repeat(400_000); // under sträng-gränsen men vi lägger många
  for (let i = 0; i < 12; i++) sb.days.push({ label: "d", strips: [{ blob: "y".repeat(400_000) }] });
  assert.throws(() => V.validateDoc("stripboard", sb), /för stort/);
});

test("validateDoc — för många dagar / strips", () => {
  const many = { days: Array.from({ length: 800 }, () => ({ strips: [] })) };
  assert.throws(() => V.validateDoc("stripboard", many), /för många dagar/);
  const fat = { days: [{ strips: Array.from({ length: 2100 }, () => ({})) }] };
  assert.throws(() => V.validateDoc("stripboard", fat), /för många strips/);
});

test("validateDoc — för djup nästling", () => {
  let deep = {};
  let cur = deep;
  for (let i = 0; i < 30; i++) { cur.n = {}; cur = cur.n; }
  assert.throws(() => V.validateDoc("meta", deep), /för djupt nästlad/);
});

test("validateDoc — för lång enskild lista var som helst", () => {
  const sb = goodStripboard();
  sb.days[0].strips[0].huge = new Array(20_001).fill(0);
  assert.throws(() => V.validateDoc("stripboard", sb), /för lång lista/);
});

test("validateDoc — för lång enskild sträng", () => {
  // stripboard har hög byte-gräns (3 MB) så det är sträng-gränsen (500k) som slår till
  const sb = goodStripboard();
  sb.days[0].strips[0].note = "a".repeat(500_001);
  assert.throws(() => V.validateDoc("stripboard", sb), /för lång textsträng/);
});

test("validateDoc — avvisar prototyp-förorenande nycklar (som de kommer ur JSON.parse)", () => {
  // obj["__proto__"] = x sätter prototypen, inte en egen nyckel — men JSON.parse
  // skapar en EGEN "__proto__"-nyckel, vilket är den faktiska hotvektorn.
  const sb = JSON.parse('{"days":[{"strips":[{"type":"scene","__proto__":{"polluted":true}}]}]}');
  assert.throws(() => V.validateDoc("stripboard", sb), /otillåten nyckel/);
  const sb2 = JSON.parse('{"days":[{"strips":[],"prototype":{"x":1}}]}');
  assert.throws(() => V.validateDoc("stripboard", sb2), /otillåten nyckel/);
});

/* ============ validateImport ============ */
test("validateImport — godtar en realistisk export", () => {
  assert.doesNotThrow(() => V.validateImport(goodExport()));
});

test("validateImport — kräver rätt versionerat format", () => {
  const p = goodExport(); delete p.format;
  assert.throws(() => V.validateImport(p), /saknat format|inget format-fält/);
  const p2 = goodExport(); p2.format = "shortplanner/project@2";
  assert.throws(() => V.validateImport(p2), /fel eller saknat format/);
  const p3 = goodExport(); p3.format = "nåt annat";
  assert.throws(() => V.validateImport(p3), /shortplanner\/project@1/);
});

test("validateImport — payloaden måste vara ett objekt", () => {
  assert.throws(() => V.validateImport(null), /måste vara ett JSON-objekt/);
  assert.throws(() => V.validateImport([]), /måste vara ett JSON-objekt/);
  assert.throws(() => V.validateImport("{}"), /måste vara ett JSON-objekt/);
});

test("validateImport — stripboard krävs och måste vara giltig", () => {
  const p = goodExport(); delete p.stripboard;
  assert.throws(() => V.validateImport(p), /saknar stripboard/);
  const p2 = goodExport(); p2.stripboard = { days: "x" };
  assert.throws(() => V.validateImport(p2), /days måste vara en lista/);
});

test("validateImport — name måste vara en sträng om det finns", () => {
  const p = goodExport(); p.name = 123;
  assert.throws(() => V.validateImport(p), /name måste vara en sträng/);
});

test("validateImport — versions: typ, antal och giltighet per rad", () => {
  const p = goodExport(); p.versions = {};
  assert.throws(() => V.validateImport(p), /versions måste vara en lista/);
  const p2 = goodExport(); p2.versions = Array.from({ length: 2100 }, () => ({}));
  assert.throws(() => V.validateImport(p2), /för många versioner/);
  const p3 = goodExport(); p3.versions = [{ label: 5 }];
  assert.throws(() => V.validateImport(p3), /label måste vara en sträng/);
  const p4 = goodExport(); p4.versions = [{ label: "v", stripboard: { days: "trasig" } }];
  assert.throws(() => V.validateImport(p4), /days måste vara en lista/);
});

/* ============ importProject: atomicitet ============ */
test("import — happy path skapar hela projektet", () => {
  const before = db.prepare("SELECT COUNT(*) c FROM projects").get().c;
  const r = store.importProject(goodExport());
  assert.ok(r.id);
  assert.equal(r.name, "Proj");
  assert.equal(db.prepare("SELECT COUNT(*) c FROM projects").get().c, before + 1);
  assert.equal(store.getDoc(r.id, "stripboard").production.film, "F");
  assert.equal(store.getDoc(r.id, "script").scenes.length, 1);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM versions WHERE project_id = ?").get(r.id).c, 1);
});

test("import — fel mitt i skapandet → NOLL databasändringar", () => {
  const projBefore = db.prepare("SELECT COUNT(*) c FROM projects").get().c;
  const verBefore = db.prepare("SELECT COUNT(*) c FROM versions").get().c;
  const docBefore = db.prepare("SELECT COUNT(*) c FROM docs").get().c;

  /* En version vars script.toJSON går bra under valideringen men kastar när
     importProject serialiserar den → mitt inne i transaktionen. */
  let armed = false;
  const evil = goodExport();
  evil.versions = [{
    label: "krasch", note: "",
    stripboard: goodStripboard(), callsheet: goodCallsheet(),
    script: { toJSON() { if (armed) throw new Error("boom under importen"); return { ok: true }; } },
    dpr: null, created_at: "2026-09-01T00:00:00.000Z"
  }];

  V.validateImport(evil);                       // passerar — armed = false
  armed = true;
  assert.throws(() => store.importProject(evil), /boom/);

  assert.equal(db.prepare("SELECT COUNT(*) c FROM projects").get().c, projBefore, "ingen projektrad");
  assert.equal(db.prepare("SELECT COUNT(*) c FROM versions").get().c, verBefore, "inga versionsrader");
  assert.equal(db.prepare("SELECT COUNT(*) c FROM docs").get().c, docBefore, "inga dokument");
});

/* ============ validateShareComponents ============ */
test("validateShareComponents — rensar, ordnar kanoniskt, avvisar okänt", () => {
  assert.deepEqual(V.validateShareComponents(undefined), ["stripboard", "callsheet", "manus", "sides", "rullplan"]);
  assert.deepEqual(V.validateShareComponents(["rullplan", "stripboard"]), ["stripboard", "rullplan"]);
  assert.deepEqual(V.validateShareComponents(["manus", "manus", "dpr", "hittepå"]), ["manus"], "dubbletter bort, okända bort");
  assert.throws(() => V.validateShareComponents([]), /minst en komponent/);
  assert.throws(() => V.validateShareComponents(["dpr"]), /minst en komponent/, "dpr är inte delbart");
  assert.throws(() => V.validateShareComponents("stripboard"), /måste vara en lista/);
});

/* ============ redactScriptForShare (manusläckan i delningsrouten) ============ */
test("redactScriptForShare — full brödtext bara när Manus eller Dagsmanus delas", () => {
  const script = {
    draft: "3:e utkast", draftDate: "2025-11-27", targetLengthSec: 900, shootingRatio: 12,
    rullplanWrapped: { "Dag 1": true },
    scenes: [
      { number: "1", slugline: "INT. KÖK - DAG", scriptPage: 1, scriptPageEnd: 2, screenTimeSec: 85, negActualMin: 3,
        body: [{ kind: "action", text: "Hemlig brödtext som inte får läcka." }] }
    ]
  };
  // Manus delas -> allt
  assert.deepEqual(store.redactScriptForShare(script, ["manus"]), script);
  // Dagsmanus delas -> allt (texten är hela poängen)
  assert.deepEqual(store.redactScriptForShare(script, ["sides", "stripboard"]), script);

  // Bara Rullplan -> siffror/struktur, INGEN body, ingen draft-text
  const r = store.redactScriptForShare(script, ["rullplan"]);
  assert.equal(r.draft, "");
  assert.equal(r.draftDate, "");
  assert.equal(r.shootingRatio, 12, "doc-nivåns siffror behålls");
  assert.equal("body" in r.scenes[0], false, "ingen brödtext");
  assert.equal(r.scenes[0].number, "1");
  assert.equal(r.scenes[0].screenTimeSec, 85);
  assert.equal(r.scenes[0].negActualMin, 3);
  assert.equal(JSON.stringify(r).includes("Hemlig brödtext"), false);

  // Varken manus/sides/rullplan -> tomt script
  const e = store.redactScriptForShare(script, ["stripboard", "callsheet"]);
  assert.deepEqual(e.scenes, []);
  assert.equal(JSON.stringify(e).includes("Hemlig"), false);
});

test.after(() => { try { db.close(); } catch (_) {} fs.rmSync(TMP, { recursive: true, force: true }); });
