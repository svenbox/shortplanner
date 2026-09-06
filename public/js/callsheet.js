/* Call sheet-modul. Exponeras som window.CS.
   Portad från det fristående call sheet-verktyget; sparning sköts av skalet. */
"use strict";
window.CS = (function () {

let DATA = null;
let root = null;
let opts = { onChange() {}, toast() {}, castRoster: () => [], shareUrl: null, onDayChange() {} };
let readOnly = false;
let castPickerEl = null;
let castAddPickerEl = null;

function notify() { opts.onChange(DATA); }
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

function t2m(s) {
  if (!s) return null;
  const m = String(s).match(/(\d{1,2})[:.](\d{2})/);
  if (!m) return null;
  return parseInt(m[1]) * 60 + parseInt(m[2]);
}
function m2t(min) {
  if (min == null) return "—";
  min = ((min % 1440) + 1440) % 1440;
  return String(Math.floor(min / 60)).padStart(2, "0") + ":" + String(min % 60).padStart(2, "0");
}
function parseEst(s) {
  if (!s) return 0;
  s = String(s).trim().toLowerCase();
  let m = 0, hit = false;
  const h = s.match(/(\d+)\s*h/); if (h) { m += parseInt(h[1]) * 60; hit = true; }
  const mm = s.match(/(\d+)\s*m/); if (mm) { m += parseInt(mm[1]); hit = true; }
  if (!hit) { const n = s.match(/^(\d+)$/); if (n) m = parseInt(n[1]); }
  return m;
}

/* Koordinater är sanningen, inte länken — en maps.app.goo.gl-länk kan dö eller
   peka fel, och en QR av en trasig länk ser lika giltig ut som en fungerande. */
function locationMapUrl(loc) {
  const lat = parseFloat(String(loc.lat || "").replace(",", "."));
  const lng = parseFloat(String(loc.lng || "").replace(",", "."));
  if (!isNaN(lat) && !isNaN(lng)) return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
  return loc.mapUrl || null;
}
/* En punkts "lat,lng"-sträng för färdplanen -- lat/lng-fälten vinner om de
   finns, annars försöker vi plocka koordinater ur en inklistrad Google
   Maps-länk (samma coordsFromMapsUrl som koordinatfältet redan använder).
   Så länge en plats har ANTINGEN riktiga koordinater ELLER en Maps-länk
   med koordinater i sig kan den vara med i rutten, inte bara den förra. */
function routePointCoord(obj) {
  if (!obj) return null;
  const lat = parseFloat(String(obj.lat || "").replace(",", "."));
  const lng = parseFloat(String(obj.lng || "").replace(",", "."));
  if (!isNaN(lat) && !isNaN(lng)) return `${lat},${lng}`;
  if (obj.mapUrl) {
    const c = coordsFromMapsUrl(obj.mapUrl);
    if (c) return `${c.lat},${c.lng}`;
  }
  return null;
}
/* Har den här start-/slutpunkten faktiskt fyllts i för just den här dagen
   -- namn, adress, koordinat eller en maps-länk räknas, telefon/anteckning
   gör det inte (de ska kunna sättas per dag utan att det räknas som en
   "egen" punkt som bryter arvskedjan nedan). */
function pointIsSet(point) {
  return !!(point && (point.name || point.addr || point.lat || point.mapUrl));
}
/* START/SLUT ärvs mellan dagar så man bara behöver skriva in dem där de
   faktiskt ÄNDRAS: en produktion som utgår från en enda plats behöver
   aldrig fylla i något alls efter dag 1:s START (SLUT samma dag ärver
   från START, nästa dags START ärver från förra dagens SLUT); byter man
   boende halvvägs räcker det att sätta SLUT den dagen bytet sker, resten
   följer med automatiskt. Ärvd data visas bara (som platshållare i
   routePointCard) -- skrivs aldrig in på dagen själv förrän man faktiskt
   redigerar den, så kedjan fortsätter följa förändringar uppströms. */
function effectiveRoutePoint(di, field) {
  const day = DATA.days[di];
  if (!day) return { point: null, inherited: false };
  const own = day[field];
  if (pointIsSet(own)) return { point: own, inherited: false };
  if (field === "routeStart") {
    if (di === 0) return { point: null, inherited: false };
    const prevEnd = effectiveRoutePoint(di - 1, "routeEnd");
    return { point: prevEnd.point, inherited: !!prevEnd.point };
  }
  const ownStart = effectiveRoutePoint(di, "routeStart");
  return { point: ownStart.point, inherited: !!ownStart.point };
}
/* Sista dagen i produktionen (sista dagen i DATA.days) har ingen SLUT --
   inget team kör till en "övernattningsplats" efter sista inspelningsdagen,
   man åker hem. SLUT-kortet göms den dagen och färdplanen slutar på
   dagens sista plats istället, se dayRouteUrl(). */
function isLastProductionDay(di) {
  return di === DATA.days.length - 1;
}
/* Google Maps-färdplan för dagen: START/SLUT (satta på dagen själv eller
   ärvda, se effectiveRoutePoint) är ruttens fasta start-/slutpunkt --
   annars faller det tillbaka på första/sista platsen i listan, i den
   ordning "makeCallSheet" i stripboard.js redan samlade dem (platsens
   FÖRSTA förekomst i dagens strip-ordning). Kräver minst två punkter
   totalt -- annars finns ingen färdväg att rita upp.
   Sista produktionsdagen har ingen SLUT (ingen övernattning att köra
   till) -- rutten slutar då på dagens sista plats istället, se
   isLastProductionDay(). */
function dayRouteUrl(di) {
  const day = DATA.days[di];
  if (!day) return null;
  const locPts = (day.locations || []).map(routePointCoord).filter(Boolean);
  const startPt = routePointCoord(effectiveRoutePoint(di, "routeStart").point);
  const endPt = isLastProductionDay(di) ? null : routePointCoord(effectiveRoutePoint(di, "routeEnd").point);

  const stops = [];
  if (startPt) stops.push(startPt);
  stops.push(...locPts);
  if (endPt) stops.push(endPt);
  if (stops.length < 2) return null;

  const origin = stops[0], destination = stops[stops.length - 1];
  const waypoints = stops.slice(1, -1);
  let url = `https://www.google.com/maps/dir/?api=1&travelmode=driving&origin=${origin}&destination=${destination}`;
  if (waypoints.length) url += `&waypoints=${waypoints.join("|")}`;
  return { url, stops: stops.length };
}
function locationCoordText(loc) {
  const lat = parseFloat(String(loc.lat || "").replace(",", "."));
  const lng = parseFloat(String(loc.lng || "").replace(",", "."));
  if (isNaN(lat) || isNaN(lng)) return null;
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}
/* Vad man ser i koordinatfältet: formaterade koordinater om vi har dem,
   annars den inklistrade maps-länken (om ingen koordinat gick att plocka ur den). */
function locationCoordDisplay(loc) {
  return locationCoordText(loc) || loc.mapUrl || "";
}
/* Plockar koordinater ur vanliga Google Maps-URL-format, t.ex.
   .../@65.6712,21.9843,15z..., ?q=65.6712,21.9843, ?query=65.6712,21.9843
   eller den inbäddade !3d65.6712!4d21.9843-datan i platssidor. */
function coordsFromMapsUrl(url) {
  const patterns = [/@(-?\d+\.\d+),(-?\d+\.\d+)/, /[?&]q=(-?\d+\.\d+),\s*\+?(-?\d+\.\d+)/,
    /[?&]query=(-?\d+\.\d+),\s*\+?(-?\d+\.\d+)/, /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/,
    /* En "släppt nål" (inte en namngiven plats) löser upp till
       /maps/search/<lat>,+<lng> istället för /maps/place/...@<lat>,<lng> --
       "+" i stället för blanksteg framför longituden eftersom det är en
       URL-encodad path, inte en vanlig query-sträng. */
    /\/maps\/search\/(-?\d+\.\d+),\s*\+?(-?\d+\.\d+)/];
  for (const re of patterns) {
    const m = url.match(re);
    if (m) return { lat: m[1], lng: m[2] };
  }
  return null;
}
/* Inline SVG, aldrig en bild-URL mot en tredjepartstjänst — call sheeten ska
   gå att spara som PDF utan att bero på att någon annans server svarar. */
function qrSvg(value) {
  if (!value || typeof window.qrcode !== "function") return "";
  try {
    const qr = window.qrcode(0, "M");
    qr.addData(String(value));
    qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 4, scalable: true });
  } catch (e) {
    console.error("QR-generering misslyckades:", e);
    return "";
  }
}

let activeDay = 0;
let editMode = false;

function toggleEdit(on) {
  if (readOnly) return;
  editMode = on;
  root.classList.toggle("edit-mode", on);
  /* Stänger man av redigeringsläget är det ett naturligt "jag är klar
     här"-ögonblick -- rita om hela dagen så Färdplan-knappen (och allt
     annat som beräknas ur adress-/koordinatfälten) speglar precis det
     man skrev in, istället för att vänta på att något annat råkar
     trigga en omritning. Slipper också att special-fejka rerenderDay()
     efter varje enskilt fältnamn i saveEditable(). */
  if (!on) { rerenderDay(); return; }
  const out = root.querySelector('[data-cs="output"]');
  if (out) setEditable(out);
}

function saveEditable(el, dayIdx, path) {
  if (readOnly) return;
  const val = el.innerText.trim();
  const keys = path.split(".");
  let obj = DATA.days[dayIdx];
  for (let i = 0; i < keys.length - 1; i++) obj = obj[keys[i]];
  obj[keys[keys.length - 1]] = val;
  notify();
}

function saveProd(el, key) {
  if (readOnly) return;
  DATA.production[key] = el.innerText.trim();
  notify();
}

function e(val, dayIdx, path, ph) {
  return `<span class="editable" contenteditable="false" data-day="${dayIdx}" data-path="${path}" data-ph="${ph||'—'}" onblur="CS.saveEditable(this,${dayIdx},'${path}')">${val||''}</span>`;
}

function ep(val, key, ph) {
  return `<span class="editable" contenteditable="false" data-prod="${key}" data-ph="${ph||'—'}" onblur="CS.saveProd(this,'${key}')">${val||''}</span>`;
}

function setEditable(root) {
  root.querySelectorAll(".editable").forEach(el => {
    el.setAttribute("contenteditable", editMode ? "true" : "false");
  });
}

/* Start-/slutpunkt för dagens färdplan (utgångspunkt / övernattning) --
   samma fält och samma kort-formatering som Akut/Sjukhus, bara med ett
   annat fältnamn, en annan kantfärg och ikon/rubrik istället för "+"/röd. */
function routePointCard(di, day, field, label, icon, borderColor) {
  /* Måste faktiskt finnas på dagobjektet, inte bara vara ett fallback-värde
     här i rendern -- annars kraschar saveEditable()s path-traversal på
     ett dygn som fanns innan det här fältet gjorde (dess "day[field]" är
     verkligen undefined, inte bara tomt). Samma lat init-mönster som
     ensureRoutePoint() använder för koordinatfälten. */
  if (!day[field]) day[field] = { name: "", addr: "", tel: "", note: "", lat: "", lng: "", mapUrl: "" };
  const point = day[field];
  const { point: resolved, inherited } = effectiveRoutePoint(di, field);
  /* Namn-/adress-/koordinatfälten visar ALLTID bara dagens egen data som
     redigerbart innehåll -- men om dagen inte har något eget syns det
     ärvda värdet som platshållartext (CSS attr(data-ph), inte riktigt
     DOM-innehåll), så det aldrig kan smälta ihop med det man skriver in.
     Till skillnad från andra platshållare i appen gäller den här
     OAVSETT redigeringsläge -- annars syns inte var dagen faktiskt
     startar/slutar när man bara tittar, vilket är hela poängen. Karta/QR
     är däremot en redigeringstid-bekvämlighet (verifiera att man
     geokodat rätt ställe) och göms i vanligt läge via CSS. Telefon/
     anteckning är alltid dagens egna, de räknas inte som "satt" i
     pointIsSet(). */
  const displayPoint = inherited ? resolved : point;
  const mapUrl = locationMapUrl(displayPoint);
  const namePh = inherited ? esc(resolved.name || "Namn") : "Namn";
  const addrPh = inherited ? esc(resolved.addr || "Adress") : "Adress";
  const coordPh = inherited ? esc(locationCoordDisplay(resolved) || "Koordinater/länk") : "Koordinater/länk";
  return `
    <div>
      <div class="section-title">${icon} ${label}${inherited ? ` <span class="loc-inherited-tag" title="Ärver från föregående dags SLUT">ärvt</span>` : ""}</div>
      <div class="loc-card route-endpoint-card" style="border-left: 3px solid ${borderColor};">
        <span class="loc-drag-handle-spacer"></span>
        <div class="loc-num" style="color:${borderColor};">${icon}</div>
        <div class="loc-info">
          <div class="loc-name-row">
            <div class="loc-name editable route-endpoint-ph" contenteditable="false" data-day="${di}" data-path="${field}.name" data-ph="${namePh}" onblur="CS.saveEditable(this,${di},'${field}.name')">${point.name || ''}</div>
            ${mapUrl ? `<a class="loc-map-link route-endpoint-editaction" href="${mapUrl}" target="_blank" rel="noopener">📍 Karta</a>` : ""}
            <button type="button" class="route-endpoint-toggle" aria-expanded="false" onclick="CS.toggleRoutePointAddr(this)">Adress ▾</button>
          </div>
          <div class="loc-addr">
            <span class="editable route-endpoint-ph" contenteditable="false" data-day="${di}" data-path="${field}.addr" data-ph="${addrPh}" onblur="CS.saveEditable(this,${di},'${field}.addr')">${point.addr || ''}</span>
            &nbsp;·&nbsp;
            <span class="editable" contenteditable="false" data-day="${di}" data-path="${field}.tel" data-ph="Telefon" onblur="CS.saveEditable(this,${di},'${field}.tel')" style="font-weight:600">${point.tel || ''}</span>
          </div>
          <div class="loc-coord-row">
            <div class="loc-coord editable route-endpoint-ph" contenteditable="false" data-day="${di}" data-ph="${coordPh}" onblur="CS.saveRoutePointCoord(this,${di},'${field}')">${locationCoordDisplay(point)}</div>
            <button class="loc-geocode-btn" onclick="CS.fetchRoutePointCoord(this,${di},'${field}')" title="Slå upp koordinater från adressen ovan">📍 Adress</button>
          </div>
          ${point.note ? `<div class="loc-note editable" contenteditable="false" data-day="${di}" data-path="${field}.note" onblur="CS.saveEditable(this,${di},'${field}.note')">${point.note}</div>` : ''}
        </div>
        ${mapUrl ? `<div class="qr">${qrSvg(mapUrl)}</div>` : ""}
      </div>
    </div>`;
}

/* På mobil visas START/SLUT-kortets adress bara som kartnål + en
   "Adress ▾"-knapp som fäller ner hela adressraden vid behov (knappen
   och nedfällningen är CSS-gömda på desktop och i redigeringsläge). */
function toggleRoutePointAddr(btn) {
  const card = btn.closest(".route-endpoint-card");
  if (!card) return;
  const open = card.classList.toggle("addr-open");
  btn.setAttribute("aria-expanded", open ? "true" : "false");
  btn.textContent = open ? "Dölj adress ▴" : "Adress ▾";
}

function renderDay(di) {
  const d = DATA.days[di];
  const p = DATA.production;

  const notesHtml = d.notes.map((n, ni) => `
    <div class="note-box" data-drag-list="notes" data-drag-day="${di}" data-drag-idx="${ni}" draggable="false">
      <span class="drag-handle" onmousedown="CS.grabOn(this)" title="Dra för att ändra ordning">⋮⋮</span>
      <span class="editable" contenteditable="false" data-day="${di}" data-path="notes.${ni}" data-ph="Ange notering" onblur="CS.saveEditable(this,${di},'notes.${ni}')">${n}</span>
      <button class="del-btn" onclick="CS.deleteNote(${di},${ni})" title="Ta bort">×</button>
    </div>
  `).join("");

  const locHtml = d.locations.map((l, li) => {
    const mapUrl = locationMapUrl(l);
    const coordDisplay = locationCoordDisplay(l);
    return `
    <div class="loc-card" data-drag-list="locations" data-drag-day="${di}" data-drag-idx="${li}" draggable="false">
      <span class="drag-handle loc-drag-handle" onmousedown="CS.grabOn(this)" title="Dra för att ändra ordning">⋮⋮</span>
      <div class="loc-num">${l.num}</div>
      <div class="loc-info">
        <div class="loc-name-row">
          <div class="loc-name editable" contenteditable="false" data-day="${di}" data-path="locations.${li}.name" data-ph="Platsnamn" onblur="CS.saveEditable(this,${di},'locations.${li}.name')">${l.name}</div>
          ${mapUrl ? `<a class="loc-map-link" href="${mapUrl}" target="_blank" rel="noopener">📍 Karta</a>` : ""}
        </div>
        <div class="loc-addr editable" contenteditable="false" data-day="${di}" data-path="locations.${li}.addr" data-ph="Adress" onblur="CS.saveEditable(this,${di},'locations.${li}.addr')">${l.addr}</div>
        <div class="loc-coord-row">
          <div class="loc-coord editable" contenteditable="false" data-day="${di}" data-ph="Koordinater eller Google Maps-länk" onblur="CS.saveLocCoord(this,${di},${li})">${coordDisplay}</div>
          <button class="loc-geocode-btn" onclick="CS.fetchLocCoord(this,${di},${li})" title="Slå upp koordinater från adressen ovan">📍 Från adress</button>
        </div>
        ${l.note ? `<div class="loc-note editable" contenteditable="false" data-day="${di}" data-path="locations.${li}.note" data-ph="OBS-notering" onblur="CS.saveEditable(this,${di},'locations.${li}.note')">${l.note}</div>` : ""}
        <div class="loc-facts">
          <div class="loc-fact"><span class="loc-fact-ic" title="Parkering">P</span><span class="editable" contenteditable="false" data-day="${di}" data-path="locations.${li}.parking" data-ph="Parkering" onblur="CS.saveEditable(this,${di},'locations.${li}.parking')">${l.parking || ""}</span></div>
          <div class="loc-fact"><span class="loc-fact-ic" title="Toalett">WC</span><span class="editable" contenteditable="false" data-day="${di}" data-path="locations.${li}.toilet" data-ph="Toalett" onblur="CS.saveEditable(this,${di},'locations.${li}.toilet')">${l.toilet || ""}</span></div>
          <div class="loc-fact"><span class="loc-fact-ic" title="Faciliteter">⚑</span><span class="editable" contenteditable="false" data-day="${di}" data-path="locations.${li}.facilities" data-ph="Faciliteter" onblur="CS.saveEditable(this,${di},'locations.${li}.facilities')">${l.facilities || ""}</span></div>
        </div>
        <div class="loc-safety editable" contenteditable="false" data-day="${di}" data-path="locations.${li}.safety" data-ph="Säkerhetsnotering" onblur="CS.saveEditable(this,${di},'locations.${li}.safety')">${l.safety || ""}</div>
        <button class="del-btn" onclick="CS.deleteLoc(${di},${li})" title="Ta bort plats">× ta bort plats</button>
      </div>
      ${mapUrl ? `<div class="qr">${qrSvg(mapUrl)}</div>` : ""}
    </div>`;
  }).join("");

  const kallHtml = d.kalltider.map((k, ki) => `
    <div class="kall-card">
      <button class="del-btn kall-del-btn" onclick="CS.deleteKall(${di},${ki})" title="Ta bort avdelning">×</button>
      <div class="kall-dept editable" contenteditable="false" data-day="${di}" data-path="kalltider.${ki}.dept" data-ph="Avdelning" onblur="CS.saveEditable(this,${di},'kalltider.${ki}.dept')">${k.dept}</div>
      <div class="kall-time editable" contenteditable="false" data-day="${di}" data-path="kalltider.${ki}.time" data-ph="00:00" onblur="CS.saveEditable(this,${di},'kalltider.${ki}.time')">${k.time}</div>
    </div>
  `).join("");

  const sceneHtml = d.scenes.map((s, si) => {
    if (s.type === "info") return `
      <tr class="info-row">
        <td colspan="8" style="padding:5px">
          <span class="editable" contenteditable="false" data-day="${di}" data-path="scenes.${si}.time" onblur="CS.saveEditable(this,${di},'scenes.${si}.time')">${s.time}</span>
          &nbsp;—&nbsp;
          <span class="editable" contenteditable="false" data-day="${di}" data-path="scenes.${si}.label" onblur="CS.saveEditable(this,${di},'scenes.${si}.label')">${s.label}</span>
          &nbsp;(<span class="editable" contenteditable="false" data-day="${di}" data-path="scenes.${si}.est" onblur="CS.saveEditable(this,${di},'scenes.${si}.est')">${s.est}</span>)
          <button class="del-btn" onclick="CS.deleteScene(${di},${si})" title="Ta bort rad">×</button>
        </td>
      </tr>`;
    if (s.type === "total") return `
      <tr class="total-row">
        <td colspan="5" style="text-align:right; color:var(--text-muted); font-size:11px">Totalt</td>
        <td><span class="editable" contenteditable="false" data-day="${di}" data-path="scenes.${si}.pages" onblur="CS.saveEditable(this,${di},'scenes.${si}.pages')">${s.pages}</span></td>
        <td><span class="editable" contenteditable="false" data-day="${di}" data-path="scenes.${si}.est" onblur="CS.saveEditable(this,${di},'scenes.${si}.est')">${s.est}</span></td>
        <td>—</td>
      </tr>`;
    return `
      <tr class="scene-row">
        <td><span class="editable" contenteditable="false" data-day="${di}" data-path="scenes.${si}.num" onblur="CS.saveEditable(this,${di},'scenes.${si}.num')">${s.num}</span></td>
        <td>
          <select onchange="CS.setSceneIE(${di},${si},this.value)" style="font-size:11px; border:1px solid var(--border); background:var(--bg); color:var(--text); border-radius:3px; padding:1px 2px;">
            <option ${s.ie==="INT"?"selected":""}>INT</option>
            <option ${s.ie==="EXT"?"selected":""}>EXT</option>
            <option ${s.ie==="I/E"?"selected":""}>I/E</option>
          </select>
        </td>
        <td>
          <span class="editable" contenteditable="false" data-day="${di}" data-path="scenes.${si}.set" onblur="CS.saveEditable(this,${di},'scenes.${si}.set')" style="display:block">${s.set}</span>
          <span class="editable" contenteditable="false" data-day="${di}" data-path="scenes.${si}.dn" onblur="CS.saveEditable(this,${di},'scenes.${si}.dn')" style="font-size:11px; color:var(--text-muted)">${s.dn}</span>
        </td>
        <td><button type="button" class="c-cast-btn" data-day="${di}" data-si="${si}" onclick="CS.toggleCastPicker(this,event)">${s.cast || "–"}</button></td>
        <td><span class="editable" contenteditable="false" data-day="${di}" data-path="scenes.${si}.loc" onblur="CS.saveEditable(this,${di},'scenes.${si}.loc')">${s.loc}</span></td>
        <td><span class="editable" contenteditable="false" data-day="${di}" data-path="scenes.${si}.pages" onblur="CS.saveEditable(this,${di},'scenes.${si}.pages')">${s.pages}</span></td>
        <td><span class="editable" contenteditable="false" data-day="${di}" data-path="scenes.${si}.est" onblur="CS.saveEditable(this,${di},'scenes.${si}.est')">${s.est}</span></td>
        <td class="start-time"><span class="editable" contenteditable="false" data-day="${di}" data-path="scenes.${si}.start" onblur="CS.saveEditable(this,${di},'scenes.${si}.start')">${s.start}</span></td>
      </tr>`;
  }).join("");

  const castHtml = d.cast.map((c, ci) => `
    <tr>
      <td style="color:var(--text-muted)"><span class="editable" contenteditable="false" data-day="${di}" data-path="cast.${ci}.id" onblur="CS.saveEditable(this,${di},'cast.${ci}.id')">${c.id}</span></td>
      <td>
        <div class="cast-name editable" contenteditable="false" data-day="${di}" data-path="cast.${ci}.name" onblur="CS.saveEditable(this,${di},'cast.${ci}.name')">${c.name}</div>
        <div class="cast-role editable" contenteditable="false" data-day="${di}" data-path="cast.${ci}.role" onblur="CS.saveEditable(this,${di},'cast.${ci}.role')">${c.role}</div>
      </td>
      <td><span class="editable" contenteditable="false" data-day="${di}" data-path="cast.${ci}.call" onblur="CS.saveEditable(this,${di},'cast.${ci}.call')">${c.call}</span></td>
      <td><span class="editable" contenteditable="false" data-day="${di}" data-path="cast.${ci}.hmu" onblur="CS.saveEditable(this,${di},'cast.${ci}.hmu')">${c.hmu}</span></td>
      <td><span class="editable" contenteditable="false" data-day="${di}" data-path="cast.${ci}.onset" onblur="CS.saveEditable(this,${di},'cast.${ci}.onset')">${c.onset}</span></td>
      <td><span class="editable" contenteditable="false" data-day="${di}" data-path="cast.${ci}.wrap" onblur="CS.saveEditable(this,${di},'cast.${ci}.wrap')">${c.wrap}</span></td>
      <td><button class="del-btn" onclick="CS.deleteCast(${di},${ci})" title="Ta bort">×</button></td>
    </tr>
  `).join("");

  const html = `
    <div class="cs-header">
      <div class="logo-area">
        <img src="/icon.svg" style="width:80px; height:auto; display:block;" alt="Shortplanner">
        <div class="weather-row">
          <div class="w-temp-row">
            <span style="font-size:20px" class="editable" contenteditable="false" data-day="${di}" data-path="weather_icon" onblur="CS.saveEditable(this,${di},'weather_icon')">${d.weather_icon}</span>
            <span class="w-temp editable" contenteditable="false" data-day="${di}" data-path="weather_temp" onblur="CS.saveEditable(this,${di},'weather_temp')">${d.weather_temp}</span>
          </div>
          <span class="w-sun">
            Gryning <span class="editable" contenteditable="false" data-day="${di}" data-path="sunrise" onblur="CS.saveEditable(this,${di},'sunrise')">${d.sunrise}</span>
            · Solnedgång <span class="editable" contenteditable="false" data-day="${di}" data-path="sunset" onblur="CS.saveEditable(this,${di},'sunset')">${d.sunset}</span>
          </span>
          <button class="btn btn-sm weather-fetch-btn" onclick="CS.fetchWeather(${di})" title="Hämta väder från SMHI/MET Norway">🔄 Hämta väder</button>
        </div>
      </div>

      <div class="title-area">
        <div class="film-title editable" contenteditable="false" data-prod="film" data-ph="Filmtitel" onblur="CS.saveProd(this,'film')">${p.film}</div>
        <div class="film-date">
          <span class="editable" contenteditable="false" data-day="${di}" data-path="dayOf" onblur="CS.saveEditable(this,${di},'dayOf')">${d.dayOf}</span>
          &nbsp;·&nbsp;
          <span class="editable" contenteditable="false" data-day="${di}" data-path="date" onblur="CS.saveEditable(this,${di},'date')">${d.date}</span>
        </div>
        <div class="gcall-label">General call time</div>
        <div class="gcall-time editable" contenteditable="false" data-day="${di}" data-path="gcall" data-ph="00:00" onblur="CS.saveEditable(this,${di},'gcall')">${d.gcall}</div>
        <div class="gcall-sub">
          Arbetstid <span class="editable" contenteditable="false" data-day="${di}" data-path="arbetstid" onblur="CS.saveEditable(this,${di},'arbetstid')">${d.arbetstid}</span>
          &nbsp;· Första bild <span class="editable" contenteditable="false" data-day="${di}" data-path="forsta_bild" onblur="CS.saveEditable(this,${di},'forsta_bild')">${d.forsta_bild}</span>
        </div>
      </div>

      <div class="meta-area">
        <div class="meta-row"><span class="meta-label">Producent</span><span class="meta-val editable" contenteditable="false" data-prod="producent" onblur="CS.saveProd(this,'producent')">${p.producent}</span></div>
        <div class="meta-row"><span class="meta-label"></span><span style="color:var(--text-secondary)" class="editable" contenteditable="false" data-prod="producent_tel" onblur="CS.saveProd(this,'producent_tel')">${p.producent_tel}</span></div>
        <div class="meta-row"><span class="meta-label">Regi</span><span class="meta-val editable" contenteditable="false" data-prod="regi" onblur="CS.saveProd(this,'regi')">${p.regi}</span></div>
        <div class="meta-row"><span class="meta-label">Foto</span><span class="editable" contenteditable="false" data-prod="foto" onblur="CS.saveProd(this,'foto')">${p.foto}</span></div>
        <div class="meta-row"><span class="meta-label">1:e AD</span><span class="editable" contenteditable="false" data-prod="ad" onblur="CS.saveProd(this,'ad')">${p.ad}</span></div>
        <div class="meta-row"><span class="meta-label">Platschef</span><span class="editable" contenteditable="false" data-prod="platschef" onblur="CS.saveProd(this,'platschef')">${p.platschef}</span></div>
        <div class="header-qrs">
          ${opts.shareUrl ? `
          <div class="hqr-item hqr-print-only">
            <div class="hqr-label">📋 Call Sheet online</div>
            <div class="qr">${qrSvg(opts.shareUrl)}</div>
          </div>` : ''}
          <div class="hqr-item">
            <div class="hqr-label">💰 Utlägg</div>
            <span class="hqr-url editable" contenteditable="false" data-prod="utlagg_url" data-ph="Länk till utläggsformulär" onblur="CS.saveProd(this,'utlagg_url')">${p.utlagg_url || ''}</span>
            ${p.utlagg_url ? `<a class="hqr-link" href="${p.utlagg_url}" target="_blank" rel="noopener">Utlägg - klicka här</a>` : ''}
            ${p.utlagg_url ? `<div class="qr">${qrSvg(p.utlagg_url)}</div>` : ''}
          </div>
        </div>
      </div>
    </div>

    <div class="notes-grid">${notesHtml}</div>
    ${d.offlineWarning ? `
    <div class="note-box offline-warning">
      <strong>⚠️ Ingen mobiltäckning</strong>
      <span class="editable" contenteditable="false" data-day="${di}" data-path="offlineWarning" onblur="CS.saveEditable(this,${di},'offlineWarning')">${d.offlineWarning}</span>
      <button class="del-btn" onclick="CS.toggleOfflineWarning(${di})" title="Ta bort offline-varning">×</button>
    </div>` : ''}
    <button class="add-row-btn" onclick="CS.addNote(${di})">+ Lägg till OBS-notering</button>
    ${!d.offlineWarning ? `<button class="add-row-btn" onclick="CS.toggleOfflineWarning(${di})">+ Lägg till offline-varning (ingen täckning på platsen)</button>` : ''}

    <div class="cs-section">
      <div class="section-title">Kallningstider — avdelningar</div>
      <div class="kall-grid">${kallHtml}</div>
      <button class="add-row-btn" onclick="CS.addKall(${di})">+ Lägg till avdelning</button>
    </div>

    <div class="cs-section cs-2col">
      <div>
        <div class="section-title-row">
          <div class="section-title">Platser</div>
          ${(() => {
            const route = dayRouteUrl(di);
            return route ? `<a class="btn btn-sm route-btn" href="${route.url}" target="_blank" rel="noopener">🗺️ Färdplan (${route.stops} stopp)</a>` : "";
          })()}
        </div>
        ${locHtml}
        <button class="add-row-btn" onclick="CS.addLoc(${di})">+ Lägg till plats</button>
      </div>

      <div>
        <div class="route-endpoints-row${isLastProductionDay(di) ? " route-endpoints-row-single" : ""}">
          ${routePointCard(di, d, "routeStart", "START", "☕", "var(--warning)")}
          ${isLastProductionDay(di) ? "" : routePointCard(di, d, "routeEnd", "SLUT", "🛏️", "var(--s-int-night)")}
        </div>
        <div class="section-title">Akut / Sjukhus</div>
        ${(() => {
          const h = d.hospital || {};
          const hMapUrl = locationMapUrl(h);
          const hCoordDisplay = locationCoordDisplay(h);
          return `
        <div class="loc-card" style="border-left: 3px solid #e44;">
          <span class="loc-drag-handle-spacer"></span>
          <div class="loc-num" style="color:#e44;">+</div>
          <div class="loc-info">
            <div class="loc-name-row">
              <div class="loc-name editable" contenteditable="false" data-day="${di}" data-path="hospital.name" data-ph="Sjukhusnamn" onblur="CS.saveEditable(this,${di},'hospital.name')">${h.name || ''}</div>
              ${hMapUrl ? `<a class="loc-map-link" href="${hMapUrl}" target="_blank" rel="noopener">📍 Karta</a>` : ""}
            </div>
            <div class="loc-addr">
              <span class="editable" contenteditable="false" data-day="${di}" data-path="hospital.addr" data-ph="Adress" onblur="CS.saveEditable(this,${di},'hospital.addr')">${h.addr || ''}</span>
              &nbsp;·&nbsp;
              <span class="editable" contenteditable="false" data-day="${di}" data-path="hospital.tel" data-ph="Telefon" onblur="CS.saveEditable(this,${di},'hospital.tel')" style="font-weight:600">${h.tel || ''}</span>
            </div>
            <div class="loc-coord-row">
              <div class="loc-coord editable" contenteditable="false" data-day="${di}" data-ph="Koordinater eller Google Maps-länk" onblur="CS.saveHospitalCoord(this,${di})">${hCoordDisplay}</div>
              <button class="loc-geocode-btn" onclick="CS.fetchHospitalCoord(this,${di})" title="Slå upp koordinater från adressen ovan">📍 Från adress</button>
            </div>
            ${h.note ? `<div class="loc-note editable" contenteditable="false" data-day="${di}" data-path="hospital.note" onblur="CS.saveEditable(this,${di},'hospital.note')">${h.note}</div>` : ''}
          </div>
          ${hMapUrl ? `<div class="qr">${qrSvg(hMapUrl)}</div>` : ""}
        </div>`;
        })()}
      </div>
    </div>

    <div class="cs-section">
      <div class="section-title">Nyckelkontakter</div>
      <table class="cast-table">
        <thead><tr><th>Funktion</th><th>Namn</th><th>Telefon</th><th style="width:28px"></th></tr></thead>
        <tbody>
          ${(d.crew_contacts || []).map((cc, cci) => `
            <tr>
              <td class="cast-role"><span class="editable" contenteditable="false" data-day="${di}" data-path="crew_contacts.${cci}.role" onblur="CS.saveEditable(this,${di},'crew_contacts.${cci}.role')">${cc.role}</span></td>
              <td class="cast-name"><span class="editable" contenteditable="false" data-day="${di}" data-path="crew_contacts.${cci}.name" onblur="CS.saveEditable(this,${di},'crew_contacts.${cci}.name')">${cc.name}</span></td>
              <td><span class="editable" contenteditable="false" data-day="${di}" data-path="crew_contacts.${cci}.tel" onblur="CS.saveEditable(this,${di},'crew_contacts.${cci}.tel')">${cc.tel}</span></td>
              <td><button class="del-btn" onclick="CS.deleteCrewContact(${di},${cci})" title="Ta bort">×</button></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
      <button class="add-row-btn" onclick="CS.addCrewContact(${di})">+ Lägg till kontakt</button>
    </div>

    <div class="cs-section">
      <div class="section-title">Schema</div>
      <div class="schema-scroll">
        <table class="schema-table">
          <thead>
            <tr>
              <th style="width:36px">Scen</th>
              <th style="width:46px">I/E</th>
              <th>Set / beskrivning</th>
              <th style="width:38px">Cast</th>
              <th style="width:88px">Plats</th>
              <th style="width:36px">Sid.</th>
              <th style="width:50px">Est.</th>
              <th style="width:46px">Start</th>
            </tr>
          </thead>
          <tbody>${sceneHtml}</tbody>
        </table>
      </div>
      <button class="add-row-btn" onclick="CS.addScene(${di})">+ Lägg till scen</button>
      <button class="add-row-btn" onclick="CS.addInfoRow(${di})" style="margin-top:4px">+ Lägg till inforad (lunch/förflyttning)</button>
    </div>

    <div class="cs-section">
      <div class="section-title cast-title-row">
        <span>Kallningstider skådespelare</span>
        <button class="btn btn-sm cast-sync-btn" onclick="CS.syncCastFromSchedule(${di})" title="Räknar om Call/Mask-Kostym/On set/Wrap utifrån vilka scener respektive skådespelare medverkar i den här dagen">🔄 Uppdatera från schema</button>
      </div>
      <table class="cast-table">
        <thead>
          <tr><th style="width:28px">ID</th><th>Namn / Roll</th><th>Call</th><th>Mask/Kostym</th><th>On set</th><th>Wrap</th><th style="width:28px"></th></tr>
        </thead>
        <tbody>${castHtml}</tbody>
      </table>
      <button class="add-row-btn" onclick="CS.openAddCastPicker(this,${di})">+ Lägg till skådespelare</button>
    </div>

    <div class="cs-footer">
      <span class="editable" contenteditable="false" data-prod="footer_note" data-ph="Bottenradstext" onblur="CS.saveProd(this,'footer_note')">${p.footer_note || `Alla utlägg godkänns i förväg av produktionsledningen · Kontakta ${p.producent} ${p.producent_tel}`}</span>
      <span>${p.film} · ${d.date} · <span class="editable" contenteditable="false" data-day="${di}" data-path="version" data-ph="v1" onblur="CS.saveEditable(this,${di},'version')">${d.version || 'v1'}</span></span>
    </div>
  `;

  return html;
}

function rerenderDay() {
  const out = root.querySelector('[data-cs="output"]');
  out.innerHTML = renderDay(activeDay);
  /* Standardloggan är Shortplanners egen (generisk, ingen produktion/
     företag inbakat). Har en sajtlogga laddats upp i sajtinställningarna
     byter vi ut den mot den istället, efter render. */
  if (opts.logoUrl) out.querySelectorAll(".logo-area img").forEach(i => { i.src = opts.logoUrl; i.alt = opts.companyName || i.alt; });
  root.classList.toggle("edit-mode", editMode);
  setEditable(out);
  if (readOnly) lockdown(out);
  else wireDragLists(out);
  if (DATA.days[activeDay]) opts.onDayChange(DATA.days[activeDay]);
}

/* ===== drag & drop för platser och OBS-noteringar ===== */
let dragSrc = null;
function grabOn(h) {
  const row = h.closest("[data-drag-list]");
  if (row) row.draggable = true;
}
function wireDragLists(container) {
  container.querySelectorAll("[data-drag-list]").forEach(row => {
    row.addEventListener("dragstart", ev => {
      dragSrc = { list: row.dataset.dragList, day: +row.dataset.dragDay, idx: +row.dataset.dragIdx };
      row.classList.add("dragging");
      ev.dataTransfer.effectAllowed = "move";
      try { ev.dataTransfer.setData("text/plain", "item"); } catch (e) {}
    });
    row.addEventListener("dragend", () => {
      row.draggable = false;
      row.classList.remove("dragging");
      container.querySelectorAll(".drop-before,.drop-after").forEach(el => el.classList.remove("drop-before", "drop-after"));
      dragSrc = null;
    });
    row.addEventListener("dragover", ev => {
      if (!dragSrc || dragSrc.list !== row.dataset.dragList || dragSrc.day !== +row.dataset.dragDay) return;
      ev.preventDefault();
      const r = row.getBoundingClientRect();
      const after = (ev.clientY - r.top) > r.height / 2;
      container.querySelectorAll(".drop-before,.drop-after").forEach(el => el.classList.remove("drop-before", "drop-after"));
      row.classList.add(after ? "drop-after" : "drop-before");
    });
    row.addEventListener("drop", ev => {
      if (!dragSrc || dragSrc.list !== row.dataset.dragList || dragSrc.day !== +row.dataset.dragDay) return;
      ev.preventDefault();
      ev.stopPropagation();
      const r = row.getBoundingClientRect();
      const after = (ev.clientY - r.top) > r.height / 2;
      const toIdx = +row.dataset.dragIdx + (after ? 1 : 0);
      moveDragItem(dragSrc.day, dragSrc.list, dragSrc.idx, toIdx);
    });
  });
}
function moveDragItem(di, list, from, to) {
  if (readOnly) return;
  const arr = DATA.days[di][list];
  if (to > from) to--;
  if (to === from || to < 0 || to >= arr.length) return;
  const [item] = arr.splice(from, 1);
  arr.splice(to, 0, item);
  if (list === "locations") arr.forEach((l, i) => { l.num = i + 1; });
  notify();
  rerenderDay();
}

function buildTabs() {
  const tabs = root.querySelector('[data-cs="tabs"]');
  tabs.innerHTML = "";
  DATA.days.forEach((d, i) => {
    const t = document.createElement("button");
    t.className = "day-tab" + (i === activeDay ? " active" : "");
    t.textContent = d.label;
    t.onclick = () => { activeDay = i; buildTabs(); rerenderDay(); };
    tabs.appendChild(t);
  });
}

// CRUD helpers
function addNote(di) {
  if (readOnly) return;
  DATA.days[di].notes.push("OBS: Ny notering");
  notify();
  rerenderDay();
}
function deleteNote(di, ni) {
  if (readOnly) return;
  DATA.days[di].notes.splice(ni, 1);
  notify();
  rerenderDay();
}
function addLoc(di) {
  if (readOnly) return;
  const n = DATA.days[di].locations.length + 1;
  DATA.days[di].locations.push({ num: n, name: "Ny plats", addr: "Ange adress", note: "", lat: "", lng: "", mapUrl: "", parking: "", toilet: "", facilities: "", safety: "" });
  notify();
  rerenderDay();
}
function deleteLoc(di, li) {
  if (readOnly) return;
  DATA.days[di].locations.splice(li, 1);
  notify();
  rerenderDay();
}
function toggleOfflineWarning(di) {
  if (readOnly) return;
  const d = DATA.days[di];
  d.offlineWarning = d.offlineWarning
    ? ""
    : "Ingen mobiltäckning på platsen. Ladda ner offlinekartor och spara det här dokumentet innan avfärd — QR-koderna går inte att skanna på plats.";
  notify();
  rerenderDay();
}
/* Delad logik för koordinatfältet — används av både platser och Akut/Sjukhus. */
function applyCoordInput(loc, val) {
  if (!val) {
    loc.lat = "";
    loc.lng = "";
    loc.mapUrl = "";
    return true;
  }
  if (/^https?:\/\//i.test(val)) {
    const c = coordsFromMapsUrl(val);
    if (c) {
      loc.lat = c.lat;
      loc.lng = c.lng;
      loc.mapUrl = "";
    } else {
      /* kort länk (t.ex. maps.app.goo.gl) utan synliga koordinater i URL:en —
         spara länken som fallback, QR:n pekar dit även utan lat/lng */
      loc.lat = "";
      loc.lng = "";
      loc.mapUrl = val;
    }
    return true;
  }
  const m = val.match(/^(-?\d+[.,]\d+)\s*,\s*(-?\d+[.,]\d+)$/);
  if (m) {
    loc.lat = m[1].replace(",", ".");
    loc.lng = m[2].replace(",", ".");
    loc.mapUrl = "";
    return true;
  }
  /* varken koordinatpar, maps-länk eller tomt — rör inte befintligt värde,
     hellre än att tyst nolla ut en redan sparad plats på en felskrivning */
  return false;
}
/* Geokodar tyst -- lyckas/misslyckas som ett booleskt värde, ingen alert.
   Anropas av resolveCoordFor() som ett FÖRSTA försök innan den (om det
   misslyckas) faller vidare till en ev. inklistrad länk -- annars skulle
   en vag adress ("Nära Stora Sjöfallet") tyst blockera den bättre
   länken som redan finns på samma plats, istället för att bara vara
   ett förstahandsförsök. */
async function tryGeocodeAddress(point, address) {
  try {
    const res = await fetch("/api/geocode?address=" + encodeURIComponent(address), { credentials: "same-origin" });
    const data = await res.json();
    if (!res.ok) return { ok: false };
    point.lat = String(data.lat);
    point.lng = String(data.lng);
    point.mapUrl = "";
    return { ok: true, place: data.place };
  } catch (e) {
    return { ok: false };
  }
}
/* Korta Google Maps-länkar (maps.app.goo.gl m.fl.) bär inga koordinater i
   själva URL:en -- server-ändpunkten följer länkens redirect-kedja och
   lämnar tillbaka slutdestinationen, som (till skillnad från den korta
   länken) ser ut som en vanlig fullständig Maps-URL med @lat,lng/!3d!4d i
   sig, samma format coordsFromMapsUrl() redan vet hur den plockar ur.
   Sparar riktiga koordinater om det lyckas -- "koordinater är sanningen,
   inte länken" gäller lika mycket här, bara löst upp en gång vid input
   istället för varje gång rutten räknas ut. */
async function resolveMapsLink(point) {
  if (!point.mapUrl) return false;
  try {
    const res = await fetch("/api/resolve-maps-link?url=" + encodeURIComponent(point.mapUrl), { credentials: "same-origin" });
    const data = await res.json();
    if (!res.ok) return false;
    const c = coordsFromMapsUrl(data.url);
    if (!c) return false;
    point.lat = c.lat;
    point.lng = c.lng;
    point.mapUrl = "";
    return true;
  } catch (e) {
    console.error("Kunde inte slå upp maps-länk:", e);
    return false;
  }
}
/* Delad "📍 Adress"-knapphandlare för platser/sjukhus/start/slut: försök
   adressen om det finns en, men ge inte upp där -- faller vidare till en
   ev. inklistrad länk om adressen inte gick att slå upp (t.ex. en vag
   adress som "Nära Stora Sjöfallet" som Nominatim inte hittar, men som
   har en fungerande Google Maps-länk bredvid sig). Larmar bara om INGET
   av försöken gav koordinater. */
async function resolveCoordFor(point, btn) {
  const address = String(point.addr || "").split("\n")[0].trim();
  const hasAddress = !!(address && address !== "Ange adress");
  if (!hasAddress && !point.mapUrl) {
    alert("Fyll i en adress eller klistra in en Google Maps-länk i koordinatfältet först.");
    return;
  }
  const prevText = btn.textContent;
  btn.textContent = "…";
  btn.disabled = true;
  let ok = false;
  let toastSuffix = "";
  if (hasAddress) {
    const geo = await tryGeocodeAddress(point, address);
    ok = geo.ok;
    if (ok && geo.place) toastSuffix = " (" + geo.place + ")";
  }
  if (!ok && point.mapUrl) {
    ok = await resolveMapsLink(point);
    if (ok) toastSuffix = " från länk";
  }
  if (ok) {
    notify();
    rerenderDay();
    opts.toast("Koordinater hämtade" + toastSuffix);
  } else {
    const msg = hasAddress && point.mapUrl
      ? "Kunde inte hämta koordinater, varken från adressen eller länken. Fyll i koordinater manuellt istället."
      : hasAddress
      ? "Kunde inte hämta koordinater för adressen."
      : "Kunde inte hämta koordinater från länken. Prova att klistra in en fullständig Google Maps-länk (inte en kort delad länk), eller fyll i en adress istället.";
    alert(msg);
    btn.textContent = prevText;
    btn.disabled = false;
  }
}
async function saveLocCoord(el, di, li) {
  if (readOnly) return;
  const loc = DATA.days[di].locations[li];
  const changed = applyCoordInput(loc, el.innerText.trim());
  if (changed) notify();
  rerenderDay();
  /* Precis inklistrad kort länk -- försök lösa upp den direkt istället för
     att kräva att man dessutom klickar knappen. Misslyckas det ligger
     länken kvar som fallback (QR:n pekar dit ändå), och "📍 Adress"-
     knappen kan försöka igen manuellt. */
  if (loc.mapUrl && !loc.lat) {
    const ok = await resolveMapsLink(loc);
    if (ok) { notify(); rerenderDay(); opts.toast("Koordinater hämtade från länk"); }
  }
}
async function fetchLocCoord(btn, di, li) {
  if (readOnly) return;
  await resolveCoordFor(DATA.days[di].locations[li], btn);
}
async function saveHospitalCoord(el, di) {
  if (readOnly) return;
  const day = DATA.days[di];
  if (!day.hospital) day.hospital = { name: "", addr: "", tel: "", note: "" };
  const changed = applyCoordInput(day.hospital, el.innerText.trim());
  if (changed) notify();
  rerenderDay();
  if (day.hospital.mapUrl && !day.hospital.lat) {
    const ok = await resolveMapsLink(day.hospital);
    if (ok) { notify(); rerenderDay(); opts.toast("Koordinater hämtade från länk"); }
  }
}
async function fetchHospitalCoord(btn, di) {
  if (readOnly) return;
  const day = DATA.days[di];
  if (!day.hospital) day.hospital = { name: "", addr: "", tel: "", note: "" };
  await resolveCoordFor(day.hospital, btn);
}
/* Start/slut-punkter för dagens färdplan (utgångspunkt/övernattning) --
   samma dag-scopade objekt-mönster som hospital, bara med två fält
   (routeStart/routeEnd) istället för ett, så en delad, parametriserad
   variant räcker istället för att fyrdubbla hospital-funktionerna. */
function ensureRoutePoint(day, field) {
  if (!day[field]) day[field] = { name: "", addr: "", tel: "", note: "", lat: "", lng: "", mapUrl: "" };
  return day[field];
}
async function saveRoutePointCoord(el, di, field) {
  if (readOnly) return;
  const point = ensureRoutePoint(DATA.days[di], field);
  const changed = applyCoordInput(point, el.innerText.trim());
  if (changed) notify();
  rerenderDay();
  if (point.mapUrl && !point.lat) {
    const ok = await resolveMapsLink(point);
    if (ok) { notify(); rerenderDay(); opts.toast("Koordinater hämtade från länk"); }
  }
}
async function fetchRoutePointCoord(btn, di, field) {
  if (readOnly) return;
  const point = ensureRoutePoint(DATA.days[di], field);
  /* Ett START/SLUT-kort utan egen data visar den ärvda platsens namn/adress
     som platshållartext (route-endpoint-ph) -- ser ut som en riktig adress,
     men "📍 Adress" har inget EGET att slå upp här (den ärvda platsen har
     redan koordinater, satta där den faktiskt hör hemma). Förklara det
     istället för att bara säga "fyll i en adress" på ett fält som ser
     ifyllt ut. */
  if (!pointIsSet(point)) {
    const { point: inherited } = effectiveRoutePoint(di, field);
    if (inherited) {
      alert("Den här platsen visas bara ärvd från en tidigare dag och har redan koordinater där. Det finns inget eget att slå upp här -- skriv in ett eget namn eller en egen adress ovan först om du vill sätta en annan plats för just den här dagen.");
      return;
    }
  }
  await resolveCoordFor(point, btn);
}
function addKall(di) {
  if (readOnly) return;
  DATA.days[di].kalltider.push({ dept: "Avdelning", time: "07:00" });
  notify();
  rerenderDay();
}
function deleteKall(di, ki) {
  if (readOnly) return;
  DATA.days[di].kalltider.splice(ki, 1);
  notify();
  rerenderDay();
}
function addScene(di) {
  if (readOnly) return;
  const scenes = DATA.days[di].scenes;
  const totalIdx = scenes.findIndex(s => s.type === "total");
  const newScene = { type: "scene", num: "—", ie: "INT", set: "Ny scen", dn: "Day", cast: "1", loc: "—", pages: "—", est: "—", start: "—" };
  if (totalIdx >= 0) scenes.splice(totalIdx, 0, newScene);
  else scenes.push(newScene);
  notify();
  rerenderDay();
}
function addInfoRow(di) {
  if (readOnly) return;
  const scenes = DATA.days[di].scenes;
  const totalIdx = scenes.findIndex(s => s.type === "total");
  const row = { type: "info", label: "RAST / LUNCH / FÖRFLYTTNING", time: "—", est: "—" };
  if (totalIdx >= 0) scenes.splice(totalIdx, 0, row);
  else scenes.push(row);
  notify();
  rerenderDay();
}
function deleteScene(di, si) {
  if (readOnly) return;
  DATA.days[di].scenes.splice(si, 1);
  notify();
  rerenderDay();
}
function addCrewContact(di) {
  if (readOnly) return;
  if (!DATA.days[di].crew_contacts) DATA.days[di].crew_contacts = [];
  DATA.days[di].crew_contacts.push({ role: "Funktion", name: "Namn", tel: "—" });
  notify();
  rerenderDay();
}
function deleteCrewContact(di, cci) {
  if (readOnly) return;
  DATA.days[di].crew_contacts.splice(cci, 1);
  notify();
  rerenderDay();
}
/* Hittar varje skådespelares första/sista scen den dagen, baserat på scenernas start/est. */
function deriveCastFromScenes(di) {
  const scenes = (DATA.days[di].scenes || []).filter(s => s.type === "scene");
  const byId = {};
  scenes.forEach(s => {
    const ids = String(s.cast || "").split(/[,;]/).map(x => x.trim()).filter(Boolean);
    const start = t2m(s.start);
    const end = start != null ? start + parseEst(s.est) : null;
    ids.forEach(id => {
      if (!byId[id]) byId[id] = { first: start, last: end };
      else {
        if (start != null && (byId[id].first == null || start < byId[id].first)) byId[id].first = start;
        if (end != null && (byId[id].last == null || end > byId[id].last)) byId[id].last = end;
      }
    });
  });
  return byId;
}

function syncCastFromSchedule(di) {
  if (readOnly) return;
  const day = DATA.days[di];
  const derived = deriveCastFromScenes(di);
  const ids = Object.keys(derived);
  if (!ids.length) { opts.toast("Inga skådespelare hittades i scenernas Cast-fält den här dagen."); return; }
  const roster = opts.castRoster ? opts.castRoster() : [];
  const rosterById = Object.fromEntries(roster.map(c => [String(c.id), c]));
  const existingById = Object.fromEntries((day.cast || []).map(c => [String(c.id), c]));
  const updated = ids.map(id => {
    const d = derived[id];
    const existing = existingById[id];
    const ros = rosterById[id];
    return {
      id,
      name: (existing && existing.name) || (ros && ros.name) || "",
      role: (existing && existing.role) || (ros && ros.role) || ("Roll " + id),
      call: d.first != null ? m2t(d.first - 30) : (existing ? existing.call : "—"),
      hmu: d.first != null ? m2t(d.first - 60) : (existing ? existing.hmu : "—"),
      onset: d.first != null ? m2t(d.first) : (existing ? existing.onset : "—"),
      wrap: d.last != null ? m2t(d.last) : (existing ? existing.wrap : "—")
    };
  });
  /* behåll manuellt tillagda skådespelare som inte förekommer i något scenschema */
  (day.cast || []).forEach(c => { if (!derived[String(c.id)]) updated.push(c); });
  day.cast = updated;
  notify();
  rerenderDay();
  opts.toast("Kallningstider uppdaterade från schemat");
}

function onCastAddPickerDocClick(e) {
  if (castAddPickerEl && !castAddPickerEl.contains(e.target)) closeCastAddPicker();
}
function closeCastAddPicker() {
  if (!castAddPickerEl) return;
  castAddPickerEl.remove();
  castAddPickerEl = null;
  document.removeEventListener("click", onCastAddPickerDocClick, true);
}
function openAddCastPicker(btn, di) {
  if (readOnly) return;
  if (castAddPickerEl) { closeCastAddPicker(); return; }
  const day = DATA.days[di];
  if (!day.cast) day.cast = [];
  const roster = opts.castRoster ? opts.castRoster() : [];
  const usedIds = new Set(day.cast.map(c => String(c.id)));
  const available = roster.filter(c => !usedIds.has(String(c.id)));
  const panel = document.createElement("div");
  panel.className = "cast-add-picker";
  panel.innerHTML = `
    <div class="cap-section">
      <label>Från registret</label>
      ${available.length ? `
        <select class="cap-select">
          <option value="">Välj skådespelare…</option>
          ${available.map(c => `<option value="${c.id}">${c.id} — ${c.role || "–"}${c.name ? " (" + c.name + ")" : ""}</option>`).join("")}
        </select>
        <button type="button" class="btn btn-sm btn-primary cap-add-existing">Lägg till</button>
      ` : `<div class="cap-empty">Alla i registret är redan tillagda den här dagen.</div>`}
    </div>
    <div class="cap-section">
      <label>Eller lägg till ny (fritext, inte i registret)</label>
      <input type="text" class="cap-new-role" placeholder="Roll / karaktär">
      <input type="text" class="cap-new-name" placeholder="Namn (valfritt)">
      <button type="button" class="btn btn-sm cap-add-new">Lägg till ny</button>
    </div>`;
  document.body.appendChild(panel);
  const r = btn.getBoundingClientRect();
  panel.style.left = Math.round(r.left) + "px";
  panel.style.top = Math.round(r.bottom + 4) + "px";
  const addExistingBtn = panel.querySelector(".cap-add-existing");
  if (addExistingBtn) addExistingBtn.addEventListener("click", () => {
    const sel = panel.querySelector(".cap-select");
    const id = sel.value;
    if (!id) return;
    const c = roster.find(x => String(x.id) === id);
    day.cast.push({ id: c.id, name: c.name || "", role: c.role || ("Roll " + c.id), call: "—", hmu: "—", onset: "—", wrap: "—" });
    notify(); rerenderDay();
    closeCastAddPicker();
  });
  panel.querySelector(".cap-add-new").addEventListener("click", () => {
    const role = panel.querySelector(".cap-new-role").value.trim();
    const name = panel.querySelector(".cap-new-name").value.trim();
    if (!role) return alert("Ange en roll/karaktär.");
    const nextId = String(day.cast.reduce((m, c) => { const n = parseInt(c.id, 10); return isNaN(n) ? m : Math.max(m, n); }, 0) + 1);
    day.cast.push({ id: nextId, name, role, call: "—", hmu: "—", onset: "—", wrap: "—" });
    notify(); rerenderDay();
    closeCastAddPicker();
  });
  castAddPickerEl = panel;
  setTimeout(() => document.addEventListener("click", onCastAddPickerDocClick, true), 0);
}
function deleteCast(di, ci) {
  if (readOnly) return;
  DATA.days[di].cast.splice(ci, 1);
  notify();
  rerenderDay();
}
function addDay() {
  if (readOnly) return;
  const n = DATA.days.length + 1;
  DATA.days.push({
    label: `Dag ${n}`,
    date: "— (sätt datum)",
    date_iso: "",
    dayOf: `Dag ${n} av 5`,
    gcall: "07:00",
    forsta_bild: "08:00",
    arbetstid: "07:00–17:45",
    weather_icon: "☀️",
    weather_temp: "—°C",
    sunrise: "—",
    sunset: "—",
    notes: [],
    locations: [{ num: 1, name: "Ange plats", addr: "Ange adress", note: "", lat: "", lng: "", mapUrl: "", parking: "", toilet: "", facilities: "", safety: "" }],
    hospital: { name: "Ange sjukhus", addr: "Ange adress", tel: "", note: "", lat: "", lng: "", mapUrl: "" },
    routeStart: { name: "", addr: "", tel: "", note: "", lat: "", lng: "", mapUrl: "" },
    routeEnd: { name: "", addr: "", tel: "", note: "", lat: "", lng: "", mapUrl: "" },
    crew_contacts: [{ role: "Producent", name: "—", tel: "—" }],
    kalltider: [
      { dept: "Regi, Foto, Platschef", time: "06:30" },
      { dept: "Scenografi, Kostym", time: "06:30" },
      { dept: "Mask & Hår", time: "06:00" }
    ],
    scenes: [
      { type: "scene", num: "—", ie: "INT", set: "Fyll i scen", dn: "Day", cast: "", loc: "—", pages: "—", est: "—", start: "08:00" },
      { type: "total", pages: "—", est: "—" }
    ],
    cast: []
  });
  activeDay = DATA.days.length - 1;
  buildTabs();
  notify();
  rerenderDay();
}
function removeDay() {
  if (readOnly) return;
  if (DATA.days.length <= 1) return alert("Minst en dag måste finnas.");
  if (!confirm(`Ta bort ${DATA.days[activeDay].label}?`)) return;
  DATA.days.splice(activeDay, 1);
  activeDay = Math.max(0, activeDay - 1);
  buildTabs();
  notify();
  rerenderDay();
}


function setSceneIE(di, si, val) {
  if (readOnly) return;
  DATA.days[di].scenes[si].ie = val;
  notify();
  rerenderDay();
}

function onCastPickerDocClick(e) {
  if (castPickerEl && !castPickerEl.contains(e.target)) closeCastPicker(true);
}
function closeCastPicker(commit) {
  if (!castPickerEl) return;
  castPickerEl.remove();
  castPickerEl = null;
  document.removeEventListener("click", onCastPickerDocClick, true);
  if (commit) { notify(); rerenderDay(); }
}
function toggleCastPicker(btn, ev) {
  if (readOnly) return;
  if (ev) ev.stopPropagation();
  if (castPickerEl) { closeCastPicker(true); return; }
  const di = +btn.dataset.day, si = +btn.dataset.si;
  const s = DATA.days[di] && DATA.days[di].scenes[si];
  if (!s) return;
  const current = new Set(String(s.cast || "").split(/[,;]/).map(x => x.trim()).filter(Boolean));
  const roster = opts.castRoster ? opts.castRoster() : [];
  const panel = document.createElement("div");
  panel.className = "cast-picker";
  panel.innerHTML = (roster.length
    ? roster.map(c => `
      <label class="cast-picker-row">
        <input type="checkbox" value="${c.id}"${current.has(String(c.id)) ? " checked" : ""}>
        <span class="cp-id">${c.id}</span><span class="cp-role">${c.role || "–"}</span>
      </label>`).join("")
    : `<div class="cast-picker-empty">Inga skådespelare i registret ännu. Lägg till via "Skådespelare"-knappen i toppen.</div>`)
    + `<div class="cast-picker-actions"><button type="button" class="btn btn-sm btn-primary cast-picker-done">Klar</button></div>`;
  document.body.appendChild(panel);
  const r = btn.getBoundingClientRect();
  panel.style.left = Math.round(r.left) + "px";
  panel.style.top = Math.round(r.bottom + 4) + "px";
  panel.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener("change", () => {
      if (cb.checked) current.add(cb.value); else current.delete(cb.value);
      s.cast = Array.from(current).join(", ");
      btn.textContent = s.cast || "–";
    });
  });
  panel.querySelector(".cast-picker-done").addEventListener("click", () => closeCastPicker(true));
  castPickerEl = panel;
  setTimeout(() => document.addEventListener("click", onCastPickerDocClick, true), 0);
}

/* Lägg till (eller ersätt) en dag som genererats från stripboardet. */
function upsertDayFromStripboard(payload) {
  const idx = DATA.days.findIndex(d => d.label === payload.label);
  if (idx >= 0) {
    /* behåll fält som bara finns i call sheeten (väder, platser, kontakter) om de fyllts i */
    const old = DATA.days[idx];
    const keep = {};
    ["weather_icon", "weather_temp", "sunrise", "sunset", "notes", "locations",
     "hospital", "routeStart", "routeEnd", "crew_contacts", "kalltider", "cast", "version"].forEach(k => {
      if (old[k] != null) keep[k] = old[k];
    });
    DATA.days[idx] = Object.assign({}, payload, keep, {
      scenes: payload.scenes,
      gcall: payload.gcall,
      date_iso: payload.date_iso,
      forsta_bild: payload.forsta_bild,
      arbetstid: payload.arbetstid,
      date: payload.date,
      dayOf: payload.dayOf
    });
    activeDay = idx;
    return { replaced: true, index: idx };
  }
  DATA.days.push(payload);
  activeDay = DATA.days.length - 1;
  return { replaced: false, index: activeDay };
}

function setActiveDay(i) {
  activeDay = Math.max(0, Math.min(i, DATA.days.length - 1));
  buildTabs();
  rerenderDay();
}

async function fetchWeather(di) {
  if (readOnly) return;
  const day = DATA.days[di];
  if (!day.date_iso) {
    return alert("Det här datumet är inte kopplat till stripboardet ännu. Generera call sheeten från en schemalagd dag i stripboardet (\"Skapa call sheet →\") för att kunna hämta väder.");
  }
  const isRealAddr = (a) => !!(a && a.trim() && a.trim() !== "Ange adress");
  const firstRealLoc = (day.locations || []).find(l => isRealAddr(l.addr));
  const rawAddress = (firstRealLoc && firstRealLoc.addr)
    || (isRealAddr(day.hospital && day.hospital.addr) ? day.hospital.addr : "") || "";
  /* platsfältet innehåller ofta fri text (t.ex. "Parkering: ...") på egna rader efter adressen */
  const address = rawAddress.split("\n")[0].trim();
  if (!address) {
    return alert("Ingen plats har en riktig adress ifylld ännu (bara \"Ange adress\"). Fyll i en adress under Platser eller Akut/Sjukhus först.");
  }
  const btn = root.querySelector(".weather-fetch-btn");
  const prevText = btn ? btn.textContent : "";
  if (btn) { btn.textContent = "Hämtar…"; btn.disabled = true; }
  try {
    const url = "/api/weather?address=" + encodeURIComponent(address) + "&date=" + encodeURIComponent(day.date_iso);
    const res = await fetch(url, { credentials: "same-origin" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Kunde inte hämta väder");
    day.weather_icon = data.weather_icon;
    day.weather_temp = data.weather_temp;
    if (data.sunrise) day.sunrise = data.sunrise;
    if (data.sunset) day.sunset = data.sunset;
    notify();
    rerenderDay();
    opts.toast("Väder hämtat" + (data.place ? " (" + data.place + ")" : ""));
  } catch (e) {
    alert("Kunde inte hämta väder: " + e.message);
    if (btn) { btn.textContent = prevText; btn.disabled = false; }
  }
}

function lockdown(el) {
  el.querySelectorAll(".c-cast-btn").forEach(b => {
    const span = document.createElement("span");
    span.className = "c-cast-static";
    span.textContent = b.textContent;
    b.replaceWith(span);
  });
  el.querySelectorAll("button").forEach(b => {
    if (b.getAttribute("onclick") === "window.print()" || b.classList.contains("day-tab")) return;
    b.remove();
  });
  el.querySelectorAll("input,textarea").forEach(i => { i.disabled = true; });
  el.querySelectorAll("select").forEach(sel => {
    const span = document.createElement("span");
    span.textContent = sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].text : "";
    span.style.fontSize = "11px";
    sel.replaceWith(span);
  });
  el.querySelectorAll("[contenteditable]").forEach(c => c.setAttribute("contenteditable", "false"));
  el.querySelectorAll(".edit-toggle").forEach(h => h.remove());
}
function mount(el, data, options) {
  root = el;
  DATA = data;
  if (!Array.isArray(DATA.days)) DATA.days = [];
  /* Öppnar på den dag vars datum ligger närmast idag, inte alltid dag 1 --
     samma "dagens datum"-hjälp som Stripboard/Dagsmanus använder. */
  activeDay = (window.SB && SB.closestDayIndex) ? SB.closestDayIndex(DATA.days, "date_iso") : 0;
  activeDay = Math.min(activeDay, Math.max(0, DATA.days.length - 1));
  opts = Object.assign({ onChange() {}, toast() {}, castRoster: () => [], shareUrl: null, onDayChange() {}, logoUrl: null, companyName: "" }, options || {});
  readOnly = !!(options && options.readOnly);
  root.innerHTML = `
    <div class="cs-toolbar">
      <div class="day-tabs" data-cs="tabs"></div>
      <button class="btn btn-add" onclick="CS.addDay()">+ Dag</button>
      <button class="btn btn-danger" onclick="CS.removeDay()">Ta bort dag</button>
      <div class="ml-auto cs-toolbar-right">
        <label class="edit-toggle">
          <span>Redigera</span>
          <label class="toggle">
            <input type="checkbox" data-cs="edit" onchange="CS.toggleEdit(this.checked)">
            <span class="slider"></span>
          </label>
        </label>
        <button class="btn" onclick="window.print()">🖨 Skriv ut</button>
      </div>
    </div>
    <div class="cs-page" data-cs="output"></div>`;
  if (!DATA.days.length) {
    root.querySelector('[data-cs="output"]').innerHTML =
      '<div class="empty-note">Inga call sheets ännu. Gå till <strong>Stripboard</strong> och klicka ' +
      '<strong>Skapa call sheet →</strong> på en inspelningsdag, eller lägg till en tom dag här.</div>';
    buildTabs();
    if (readOnly) lockdown(root);
    return;
  }
  buildTabs();
  rerenderDay();
  if (readOnly) lockdown(root);
}

function unmount() { if (root) root.innerHTML = ""; root = null; DATA = null; }
function getData() { return DATA; }
function dayCount() { return DATA && DATA.days ? DATA.days.length : 0; }

return {
  mount, unmount, getData, dayCount, setActiveDay, upsertDayFromStripboard, setSceneIE, fetchWeather, toggleCastPicker,
  toggleEdit, saveEditable, saveProd, rerenderDay, buildTabs,
  addNote, deleteNote, addLoc, deleteLoc, saveLocCoord, fetchLocCoord, saveHospitalCoord, fetchHospitalCoord, saveRoutePointCoord, fetchRoutePointCoord, toggleRoutePointAddr, toggleOfflineWarning, addKall, deleteKall, grabOn,
  addScene, addInfoRow, deleteScene,
  addCrewContact, deleteCrewContact, deleteCast, syncCastFromSchedule, openAddCastPicker,
  addDay, removeDay
};
})();
