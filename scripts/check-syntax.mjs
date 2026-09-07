#!/usr/bin/env node
/* Beroendefri statisk koll: kör `node --check` (ren parsning, ingen körning)
   på all förstapartskod. Fångar syntaxfel innan de når produktion. Ersätter
   inte en riktig linter men håller sig till husregeln "inga byggverktyg". */
import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SKIP = new Set(["node_modules", ".git", "public/js/vendor"]);

function walk(dir, rel = "") {
  const out = [];
  for (const name of readdirSync(dir)) {
    const relPath = rel ? `${rel}/${name}` : name;
    if (SKIP.has(relPath) || SKIP.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full, relPath));
    else if (/\.(mjs|cjs|js)$/.test(name)) out.push({ full, relPath });
  }
  return out;
}

const files = walk(ROOT);
let failed = 0;
for (const { full, relPath } of files) {
  try {
    execFileSync(process.execPath, ["--check", full], { stdio: ["ignore", "ignore", "pipe"] });
  } catch (e) {
    failed++;
    process.stderr.write(`\n✗ ${relPath}\n${e.stderr || e.message}\n`);
  }
}

if (failed) {
  console.error(`\n${failed} fil(er) med syntaxfel.`);
  process.exit(1);
}
console.log(`✓ ${files.length} JS-filer parsade rent.`);
