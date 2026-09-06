"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const Database = require("better-sqlite3");

const DATA_DIR = process.env.DATA_DIR || "/data";
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, "shortplanner.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS docs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  data       TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, kind)
);
CREATE TABLE IF NOT EXISTS versions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  label      TEXT NOT NULL,
  note       TEXT NOT NULL DEFAULT '',
  stripboard TEXT NOT NULL,
  callsheet  TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_versions_project ON versions(project_id, created_at DESC);
`);

const projectCols = db.prepare("PRAGMA table_info(projects)").all().map(c => c.name);
if (!projectCols.includes("share_token")) {
  db.exec("ALTER TABLE projects ADD COLUMN share_token TEXT");
}
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_share_token ON projects(share_token) WHERE share_token IS NOT NULL");

/* Versioner fryste ursprungligen bara stripboard + callsheet. Manus och DPR
   läggs till additivt -- gamla rader har NULL, vilket vid återställning
   betyder "ingen ögonblicksbild att lägga tillbaka" (nuvarande Manus/DPR
   lämnas orörda för de versionerna). Nya versioner fryser alla fyra. */
const versionCols = db.prepare("PRAGMA table_info(versions)").all().map(c => c.name);
if (!versionCols.includes("script")) db.exec("ALTER TABLE versions ADD COLUMN script TEXT");
if (!versionCols.includes("dpr")) db.exec("ALTER TABLE versions ADD COLUMN dpr TEXT");

function getSetting(key) {
  const r = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return r ? r.value : null;
}
function setSetting(key, value) {
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(key, value);
}

/* ---------- sajtinställningar (en JSON-rad i settings) ---------- */
const DEFAULT_SITE = {
  company: { name: "", orgnr: "", address: "", phone: "", email: "", website: "" },
  logo: null,                                   // { ext } när en logga laddats upp
  features: { rullplan: true, dpr: true, manus: true },
  locale: "sv"
};
function getSiteConfig() {
  let c = {};
  try { c = JSON.parse(getSetting("site_config") || "{}") || {}; } catch (_) { c = {}; }
  return {
    company: Object.assign({}, DEFAULT_SITE.company, c.company),
    logo: c.logo && c.logo.ext ? { ext: String(c.logo.ext) } : null,
    features: Object.assign({}, DEFAULT_SITE.features, c.features),
    locale: c.locale || "sv"
  };
}
function setSiteConfig(patch) {
  const cur = getSiteConfig();
  patch = patch || {};
  const next = {
    company: Object.assign({}, cur.company, patch.company || {}),
    logo: "logo" in patch ? (patch.logo && patch.logo.ext ? { ext: String(patch.logo.ext) } : null) : cur.logo,
    features: Object.assign({}, cur.features, patch.features || {}),
    locale: patch.locale ? String(patch.locale) : cur.locale
  };
  setSetting("site_config", JSON.stringify(next));
  return next;
}

/* Sessionshemligheten lagras i databasen så att inloggningar överlever omstart
   även om SESSION_SECRET inte satts i miljön. */
function sessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  let s = getSetting("session_secret");
  if (!s) {
    s = crypto.randomBytes(32).toString("hex");
    setSetting("session_secret", s);
  }
  return s;
}

module.exports = { db, getSetting, setSetting, getSiteConfig, setSiteConfig, sessionSecret, DATA_DIR };
