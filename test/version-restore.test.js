"use strict";
/* Atomicitet för versionsåterställning (store.restoreVersion).

   Krav: säkerhetskopian ("Före återställning") OCH återläsningen av alla
   dokument sker i EN SQLite-transaktion. Går något fel — trasig JSON i en
   version, eller processen dör mitt i — ska varken säkerhetskopian eller
   återställningen vara delvis applicerad. Databasen är antingen helt före
   eller helt efter.

   Kör med `npm test`. */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "sp-restore-"));
process.env.DATA_DIR = TMP;
process.env.SESSION_SECRET = "testsecret";

const { db } = require("../db.js");
const store = require("../store.js");

const DB_PATH = path.join(TMP, "shortplanner.db");
const isoNow = () => new Date().toISOString();

function newProject() {
  const ts = isoNow();
  const info = db.prepare("INSERT INTO projects (name, created_at, updated_at) VALUES (?,?,?)").run("P", ts, ts);
  const pid = info.lastInsertRowid;
  store.putDoc(pid, "stripboard", { tag: "SB-orig" });
  store.putDoc(pid, "callsheet", { tag: "CS-orig" });
  store.putDoc(pid, "script", { tag: "SC-orig" });
  store.putDoc(pid, "dpr", { tag: "DPR-orig" });
  return pid;
}
const docTag = (pid, kind) => (store.getDoc(pid, kind) || {}).tag;
const versionRows = (pid) => db.prepare("SELECT id, label FROM versions WHERE project_id = ? ORDER BY id").all(pid);

/* ------------------------------------------------------------------ */
test("restore — happy path: alla dokument tillbaka + säkerhetskopia skapad", () => {
  const pid = newProject();
  const v = store.createVersion(pid, "Utgångsläge");

  // jobba vidare
  store.putDoc(pid, "stripboard", { tag: "SB-edited" });
  store.putDoc(pid, "callsheet", { tag: "CS-edited" });
  store.putDoc(pid, "script", { tag: "SC-edited" });
  store.putDoc(pid, "dpr", { tag: "DPR-edited" });

  const res = store.restoreVersion(v.id);
  assert.equal(res.ok, true);
  assert.equal(res.project_id, pid);

  assert.equal(docTag(pid, "stripboard"), "SB-orig");
  assert.equal(docTag(pid, "callsheet"), "CS-orig");
  assert.equal(docTag(pid, "script"), "SC-orig");
  assert.equal(docTag(pid, "dpr"), "DPR-orig");

  const vs = versionRows(pid);
  assert.equal(vs.length, 2);
  assert.equal(vs[1].label, "Före återställning");
  // säkerhetskopian innehåller det man jobbade fram, inte utgångsläget
  const safety = db.prepare("SELECT stripboard, dpr FROM versions WHERE id = ?").get(vs[1].id);
  assert.equal(JSON.parse(safety.stripboard).tag, "SB-edited");
  assert.equal(JSON.parse(safety.dpr).tag, "DPR-edited");
});

/* ------------------------------------------------------------------ */
test("restore — trasig JSON i versionen: ALLT rullas tillbaka", () => {
  const pid = newProject();
  const v = store.createVersion(pid, "Utgångsläge");
  store.putDoc(pid, "stripboard", { tag: "SB-edited" });
  store.putDoc(pid, "callsheet", { tag: "CS-edited" });
  store.putDoc(pid, "script", { tag: "SC-edited" });
  store.putDoc(pid, "dpr", { tag: "DPR-edited" });

  // Sabotera EN kolumn i versionen så JSON.parse kastar mitt i transaktionen
  // (efter att stripboard/callsheet redan skrivits i samma txn).
  db.prepare("UPDATE versions SET script = ? WHERE id = ?").run("{ this is not json", v.id);

  assert.throws(() => store.restoreVersion(v.id), /JSON|Unexpected|token/i);

  // Inget dokument fick backas till 'orig'
  assert.equal(docTag(pid, "stripboard"), "SB-edited");
  assert.equal(docTag(pid, "callsheet"), "CS-edited");
  assert.equal(docTag(pid, "script"), "SC-edited");
  assert.equal(docTag(pid, "dpr"), "DPR-edited");

  // Ingen "Före återställning"-rad skapades
  const vs = versionRows(pid);
  assert.equal(vs.length, 1, "bara ursprungsversionen ska finnas kvar");
  assert.equal(vs.every(r => r.label !== "Före återställning"), true);
});

/* ------------------------------------------------------------------ */
test("restore — gammal version med NULL script/dpr lämnar de dokumenten orörda", () => {
  const pid = newProject();
  const v = store.createVersion(pid, "Gammal");
  db.prepare("UPDATE versions SET script = NULL, dpr = NULL WHERE id = ?").run(v.id);

  store.putDoc(pid, "stripboard", { tag: "SB-edited" });
  store.putDoc(pid, "script", { tag: "SC-edited" });

  store.restoreVersion(v.id);

  assert.equal(docTag(pid, "stripboard"), "SB-orig", "stripboard återställd");
  assert.equal(docTag(pid, "script"), "SC-edited", "script ej nollad, lämnad som den var");
});

/* ------------------------------------------------------------------ */
test("restore — okänt versions-id kastar NOT_FOUND, rör inget", () => {
  const pid = newProject();
  const before = versionRows(pid).length;
  let err;
  try { store.restoreVersion(999999); } catch (e) { err = e; }
  assert.ok(err);
  assert.equal(err.code, "NOT_FOUND");
  assert.equal(versionRows(pid).length, before);
});

/* ------------------------------------------------------------------ */
test("krasch mitt i en restore-transaktion → databasen förblir konsistent", () => {
  const pid = newProject();
  const v = store.createVersion(pid, "Utgångsläge");
  store.putDoc(pid, "stripboard", { tag: "SB-edited" });
  const versionsBefore = versionRows(pid).length;

  /* Barnprocess: öppnar SAMMA databas, startar en transaktion, skriver
     halva restoren (säkerhetskopia + ett dokument) och blir SIGKILL:ad
     INNAN COMMIT. En ocommittad transaktion ska inte lämna några spår. */
  const child = `
    const Database = require(${JSON.stringify(require.resolve("better-sqlite3"))});
    const db = new Database(${JSON.stringify(DB_PATH)});
    db.pragma("journal_mode = WAL");
    db.exec("BEGIN");
    db.prepare("INSERT INTO versions (project_id,label,note,stripboard,callsheet,script,dpr,created_at) VALUES (?,?,?,?,?,?,?,?)")
      .run(${pid}, "Före återställning", "halvvägs", '{"tag":"SB-edited"}', '{}', '{}', '{}', new Date().toISOString());
    db.prepare("INSERT INTO docs (project_id,kind,data,updated_at) VALUES (?,?,?,?) ON CONFLICT(project_id,kind) DO UPDATE SET data=excluded.data")
      .run(${pid}, "stripboard", '{"tag":"SB-orig"}', new Date().toISOString());
    process.stderr.write("WROTE_UNCOMMITTED\\n");
    process.kill(process.pid, "SIGKILL");
  `;
  let killedAsExpected = false;
  try {
    execFileSync(process.execPath, ["-e", child], { cwd: process.cwd(), stdio: ["ignore", "ignore", "pipe"] });
  } catch (e) {
    // SIGKILL => execFileSync kastar; bekräfta att skrivningarna hann köras
    killedAsExpected = String(e.stderr || "").includes("WROTE_UNCOMMITTED");
  }
  assert.equal(killedAsExpected, true, "barnprocessen hann skriva och dödades");

  // Nya anslutningen (testets egen db) ser inget av den ocommittade transaktionen
  assert.equal(docTag(pid, "stripboard"), "SB-edited", "dokumentet oförändrat");
  assert.equal(versionRows(pid).length, versionsBefore, "ingen halv säkerhetskopia");
  assert.equal(versionRows(pid).some(r => r.note === "halvvägs"), false);

  // Och en riktig restore efteråt funkar fortfarande
  const res = store.restoreVersion(v.id);
  assert.equal(res.ok, true);
  assert.equal(docTag(pid, "stripboard"), "SB-orig");
});

/* städa */
test.after(() => { try { db.close(); } catch (_) {} fs.rmSync(TMP, { recursive: true, force: true }); });
