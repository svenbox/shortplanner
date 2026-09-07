"use strict";
/* Validering av importerad / sparad data INNAN något rör databasen.

   Filosofi: syntaktiskt giltig JSON betyder ingenting. Vi kollar
   struktur (rätt typer där appen förväntar sig listor/objekt) och
   STORLEK (inget får växa obegränsat: byte, listlängd, nästlingsdjup,
   antal fält, stränglängd). Vi vitlistar däremot INTE fältnamn —
   klienten lägger till fält löpande och servern ska inte behöva
   släppa i takt. Okända fält är ok, obegränsad tillväxt är inte.

   Alla fel är `{ code: "INVALID", status: 400 }` med ett läsbart
   svenskt meddelande. */

const LIMITS = {
  // Serialiserad storlek per dokumenttyp
  bytes: {
    stripboard: 3_000_000,
    callsheet: 3_000_000,
    script: 6_000_000,     // håller hela manustexten, radvis
    dpr: 3_000_000,
    meta: 200_000
  },
  importBytes: 20_000_000, // hela export-payloaden (docs + alla versioner)
  depth: 24,               // max nästlingsdjup
  array: 20_000,           // max längd på EN lista
  keys: 2_000,             // max antal fält i ETT objekt
  string: 500_000,         // max längd på EN sträng
  days: 732,               // ~2 år
  stripsPerDay: 2_000,
  scenes: 20_000,
  versions: 2_000
};

function invalid(msg) {
  const e = new Error(msg);
  e.code = "INVALID";
  e.status = 400;
  return e;
}

function byteLen(obj) {
  return Buffer.byteLength(JSON.stringify(obj));
}

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/* Generell struktur-/storlekssvep: djup, listlängder, fältantal,
   stränglängder, och avvisar prototyp-förorenande nycklar. Går igenom
   HELA värdet oavsett vilka fält det är. */
function scan(value, path, depth) {
  if (depth > LIMITS.depth) throw invalid(`för djupt nästlad struktur vid ${path}`);

  if (typeof value === "string") {
    if (value.length > LIMITS.string) throw invalid(`för lång textsträng vid ${path} (${value.length} tecken, max ${LIMITS.string})`);
    return;
  }
  if (value === null || typeof value !== "object") return; // tal/boolean/undefined: ok

  if (Array.isArray(value)) {
    if (value.length > LIMITS.array) throw invalid(`för lång lista vid ${path} (${value.length} element, max ${LIMITS.array})`);
    for (let i = 0; i < value.length; i++) scan(value[i], `${path}[${i}]`, depth + 1);
    return;
  }

  const keys = Object.keys(value);
  if (keys.length > LIMITS.keys) throw invalid(`för många fält vid ${path} (${keys.length}, max ${LIMITS.keys})`);
  for (const k of keys) {
    if (k === "__proto__" || k === "prototype") throw invalid(`otillåten nyckel "${k}" vid ${path}`);
    scan(value[k], `${path}.${k}`, depth + 1);
  }
}

/* Kastar om `data` inte är ett rimligt dokument av typen `kind`.
   Returnerar `data` oförändrad vid ok. */
function validateDoc(kind, data) {
  if (!LIMITS.bytes[kind]) throw invalid(`okänd dokumenttyp "${kind}"`);
  if (!isPlainObject(data)) throw invalid(`${kind}-dokumentet måste vara ett objekt`);

  const bytes = byteLen(data);
  if (bytes > LIMITS.bytes[kind]) throw invalid(`${kind} är för stort (${bytes} byte, max ${LIMITS.bytes[kind]})`);

  scan(data, kind, 0);

  switch (kind) {
    case "stripboard": {
      if (!Array.isArray(data.days)) throw invalid("stripboard.days måste vara en lista");
      if (data.days.length > LIMITS.days) throw invalid(`för många dagar (${data.days.length}, max ${LIMITS.days})`);
      data.days.forEach((d, i) => {
        if (!isPlainObject(d)) throw invalid(`stripboard.days[${i}] måste vara ett objekt`);
        if (!Array.isArray(d.strips)) throw invalid(`stripboard.days[${i}].strips måste vara en lista`);
        if (d.strips.length > LIMITS.stripsPerDay) throw invalid(`för många strips i stripboard.days[${i}] (${d.strips.length}, max ${LIMITS.stripsPerDay})`);
        d.strips.forEach((s, j) => { if (!isPlainObject(s)) throw invalid(`stripboard.days[${i}].strips[${j}] måste vara ett objekt`); });
      });
      if ("unscheduled" in data && !Array.isArray(data.unscheduled)) throw invalid("stripboard.unscheduled måste vara en lista");
      if ("cast" in data && !Array.isArray(data.cast)) throw invalid("stripboard.cast måste vara en lista");
      if ("production" in data && !isPlainObject(data.production)) throw invalid("stripboard.production måste vara ett objekt");
      break;
    }
    case "callsheet": {
      if (!Array.isArray(data.days)) throw invalid("callsheet.days måste vara en lista");
      if (data.days.length > LIMITS.days) throw invalid(`för många call sheet-dagar (${data.days.length}, max ${LIMITS.days})`);
      data.days.forEach((d, i) => { if (!isPlainObject(d)) throw invalid(`callsheet.days[${i}] måste vara ett objekt`); });
      if ("production" in data && !isPlainObject(data.production)) throw invalid("callsheet.production måste vara ett objekt");
      break;
    }
    case "script": {
      if ("scenes" in data && !Array.isArray(data.scenes)) throw invalid("script.scenes måste vara en lista");
      if (Array.isArray(data.scenes)) {
        if (data.scenes.length > LIMITS.scenes) throw invalid(`för många scener (${data.scenes.length}, max ${LIMITS.scenes})`);
        data.scenes.forEach((s, i) => {
          if (!isPlainObject(s)) throw invalid(`script.scenes[${i}] måste vara ett objekt`);
          if ("body" in s && !Array.isArray(s.body)) throw invalid(`script.scenes[${i}].body måste vara en lista`);
        });
      }
      if ("rullplanWrapped" in data && data.rullplanWrapped != null && !isPlainObject(data.rullplanWrapped)) throw invalid("script.rullplanWrapped måste vara ett objekt");
      break;
    }
    case "dpr": {
      if ("days" in data && !Array.isArray(data.days)) throw invalid("dpr.days måste vara en lista");
      if (Array.isArray(data.days) && data.days.length > LIMITS.days) throw invalid(`för många DPR-dagar (${data.days.length}, max ${LIMITS.days})`);
      break;
    }
    case "meta":
      // Platt sträng-karta. scan() har redan kollat storlek/djup. Inget mer.
      break;
  }
  return data;
}

const IMPORT_FORMAT = "shortplanner/project@1";

/* Validerar en HEL export-payload innan importen rör databasen. */
function validateImport(payload) {
  if (!isPlainObject(payload)) throw invalid("importfilen måste vara ett JSON-objekt");

  if (payload.format !== IMPORT_FORMAT) {
    const got = payload.format === undefined ? "inget format-fält" : JSON.stringify(payload.format);
    throw invalid(`fel eller saknat format — förväntade "${IMPORT_FORMAT}", fick ${got}`);
  }

  let bytes;
  try {
    bytes = byteLen(payload);
  } catch (_) {
    throw invalid("payloaden går inte att serialisera (cirkulär struktur?)");
  }
  if (bytes > LIMITS.importBytes) throw invalid(`importfilen är för stor (${bytes} byte, max ${LIMITS.importBytes})`);

  if ("name" in payload && payload.name != null && typeof payload.name !== "string") throw invalid("name måste vara en sträng");

  // stripboard krävs
  if (payload.stripboard == null) throw invalid("importfilen saknar stripboard");
  validateDoc("stripboard", payload.stripboard);

  // övriga dokument är valfria men måste vara giltiga om de finns
  for (const kind of ["callsheet", "script", "dpr", "meta"]) {
    if (payload[kind] != null) validateDoc(kind, payload[kind]);
  }

  // versioner
  if (payload.versions != null) {
    if (!Array.isArray(payload.versions)) throw invalid("versions måste vara en lista");
    if (payload.versions.length > LIMITS.versions) throw invalid(`för många versioner (${payload.versions.length}, max ${LIMITS.versions})`);
    payload.versions.forEach((v, i) => {
      if (!isPlainObject(v)) throw invalid(`versions[${i}] måste vara ett objekt`);
      if (v.label != null && typeof v.label !== "string") throw invalid(`versions[${i}].label måste vara en sträng`);
      if (v.note != null && typeof v.note !== "string") throw invalid(`versions[${i}].note måste vara en sträng`);
      if (v.stripboard != null) validateDoc("stripboard", v.stripboard);
      if (v.callsheet != null) validateDoc("callsheet", v.callsheet);
      if (v.script != null) validateDoc("script", v.script);
      if (v.dpr != null) validateDoc("dpr", v.dpr);
    });
  }

  return payload;
}

/* Delbara komponenter i en delningslänk (DPR delas aldrig). */
const SHARE_COMPONENTS = ["stripboard", "callsheet", "manus", "sides", "rullplan"];

/* Rensar en inkommande lista: bara kända värden, unika, i kanonisk ordning.
   Kastar om resultatet blir tomt (att dela ingenting är förmodligen ett
   misstag). `undefined` in → alla (används vid första delningen). */
function validateShareComponents(arr) {
  if (arr === undefined || arr === null) return SHARE_COMPONENTS.slice();
  if (!Array.isArray(arr)) throw invalid("components måste vara en lista");
  const set = new Set(arr);
  const picked = SHARE_COMPONENTS.filter(c => set.has(c));
  if (!picked.length) throw invalid("välj minst en komponent att dela");
  return picked;
}

module.exports = { validateDoc, validateImport, validateShareComponents, IMPORT_FORMAT, SHARE_COMPONENTS, LIMITS };
