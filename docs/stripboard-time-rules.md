# Stripboardens tidsregler — dokumenterat nuvarande beteende

Det här dokumentet beskriver **exakt hur stripboardet räknar idag**, innan någon
refaktorering. Reglerna (inklusive egenheter markerade **EGENHET**) är låsta av
testsviten i `test/stripboard-core.test.js` — ändra inte beteende utan att först
uppdatera både det här dokumentet och testerna medvetet.

All logik som beskrivs här bor i `public/js/stripboard-core.js` (ren, UI-fri,
testbar i Node). `public/js/stripboard.js` konsumerar den och lägger bara DOM
ovanpå.

---

## 1. Tolka estimerad tid — `parseEst(s) → minuter`

Läser en fritextsträng och returnerar minuter (heltal). Tål `null`/tom → `0`.

| Inmatning | Resultat | Kommentar |
|---|---|---|
| `"2h"` | `120` | timmar |
| `"45m"` | `45` | minuter |
| `"1h 30m"` | `90` | timmar + minuter adderas |
| `"90"` | `90` | **bart tal tolkas som minuter** |
| `"0"` | `0` | |
| `""`, `null`, `"abc"` | `0` | inget matchar |
| `"1h30"` | `60` | **EGENHET:** "30" utan `m` ignoreras helt |
| `"1.5h"` | `300` | **EGENHET:** regexen fångar `5h`, `"1."` slängs. Decimaltimmar stöds inte. |

Regex: `(\d+)\s*h` för timmar, `(\d+)\s*m` för minuter, annars `^(\d+)$` för
bart minuttal. Timme och minut plockas oberoende av varandra, var som helst i
strängen.

## 2. Formatera tid — `fmtEst(min) → sträng`

| Inmatning | Resultat | Kommentar |
|---|---|---|
| `0` (eller falsy) | `""` | tomt, inte `"0m"` |
| `45` | `"45m"` | |
| `90` | `"1h 30m"` | |
| `60` | `"1h 0m"` | **hela timmar behåller `" 0m"`** |
| `120` | `"2h 0m"` | |
| `725` | `"12h 5m"` | ingen övre gräns |

## 3. Tolka klockslag — `t2m(s) → minuter sedan midnatt | null`

Regex `(\d{1,2})[:.](\d{2})` — första träffen var som helst i strängen.

| Inmatning | Resultat | Kommentar |
|---|---|---|
| `"08:30"` | `510` | |
| `"8.30"` | `510` | punkt funkar som avgränsare |
| `"8:5"` | `null` | **minutdelen måste vara exakt två siffror** |
| `""`, `"noon"`, `null` | `null` | |
| `"25:00"` | `1500` | **EGENHET:** ingen intervallkontroll — timmar kan överstiga 23 |

## 4. Formatera minuter till klockslag — `m2t(min) → "HH:MM"`

Normaliserar **modulo 1440** (ett dygn) och hanterar negativa tal:
`((min % 1440) + 1440) % 1440`.

| Inmatning | Resultat |
|---|---|
| `510` | `"08:30"` |
| `1440` | `"00:00"` |
| `1500` | `"01:00"` |
| `-30` | `"23:30"` |
| `-1470` | `"23:30"` |

Det är den här funktionen som gör att tider **efter midnatt visas som `00:xx`,
`01:xx` …** i ett stripboard som passerar dygnsgränsen, och att call sheetens
"30 min före"-tider vid en midnattsstart hamnar på `23:30` föregående dygn.

## 5. Sidor (åttondelar) — `parsePages` / `fmtPages`

Inte tid, men samma mönster och används i dagssummorna.

| `parsePages(...)` | Resultat | |
|---|---|---|
| `"2 3/8"` | `19` | `2*8 + 3` |
| `"3/8"` | `3` | |
| `"2"` | `16` | **bart heltal = hela sidor, ×8** |
| `"9/8"` | `9` | ingen normalisering till "1 1/8" |
| `""`, skräp | `0` | |

`fmtPages(19)` → `"2 3/8"`; `fmtPages(0)` → `""`.

## 6. Klassificering av strips — `stripKind(s)` / `stripClass(s) → CSS-klasser`

`stripKind(s)` returnerar undertypen för en icke-scen-strip: `"break"`,
`"move"` eller `"info"` (`""` = odefinierad).

- **Uttryckligt `s.kind`** (`"break"` / `"move"` / `"info"`, satt via i-cirkeln
  i stripboardet) vinner — men bara för strips där `s.type !== "scene"`.
- Saknas `s.kind` härleds typen ur **texten i `s.set`**, skiftlägesokänsligt,
  som delsträng: `/rast|lunch/i` → `break`, `/förflyttning|flytt/i` → `move`.
- Scener har inget `s.kind`; där matchar `s.set`-texten fortfarande (se EGENHET
  nedan).

`stripClass(s)` ovanpå `stripKind`:

- `stripKind` → `break` → lägg till klassen `break`; `move` → `move`
- `s.type === "banner"` → basklass `banner`, annars `int-`/`ext-` + `day`/`night`
- natt om `/natt|night/i` i `s.dn`; ext om `/^ext/i` i `s.ie`

| Strip | Klass |
|---|---|
| banner, set `"Lunch"` | `banner break` |
| banner, set `"Fika"`, `kind: "break"` | `banner break` — **texten spelar ingen roll** |
| banner, set `"Lunch"`, `kind: "info"` | `banner` — uttryckligen bara info |
| banner, set `"Förflyttning till studio"` | `banner move` |
| banner, `kind: "banan"` (okänt) | faller tillbaka på texten |
| scen, INT/DAG, set `"LUNCHRUMMET"` | `int-day break` — **EGENHET:** en riktig scen vars set-namn innehåller "lunch" får rast-stil (scener har inget `s.kind`) |
| scen, EXT/NATT | `ext-night` |

> Det finns alltså ingen egen `type` för lunch/rast/förflyttning — det är
> `type: "banner"`-strips med ett valfritt `s.kind` (eller matchande `set`-text)
> plus en `est` som är pausens/flyttens längd. `s.kind` flödar vidare till call
> sheetens info-rader och till Inspelningslägets steg, och `isBreak()`
> (arbetstidsvarningen, avsnitt 10) använder samma `stripKind`.

## 7. Räkna om starttider i en dag — `recalcDay(day)`

Muterar `day.strips[*].start`. Går igenom striparna uppifrån och ner:

```
run = t2m(day.start)   // om ej tolkningsbar: run = 0  (midnatt)
för varje strip s:
    om s.lock OCH t2m(s.start) != null:   run = t2m(s.start)   // hoppa till låst tid
    s.start = m2t(run)
    run += parseEst(s.est)
```

Följder:

- **Kedja:** `start 08:00`, strips `1h` / `30m` (lunch) / `2h` → starttider
  `08:00`, `09:00`, `09:30`. Lunchens `est` skjuter fram allt efter den.
- **Låst starttid:** en strip med `lock` **och en tolkningsbar `start`** tvingar
  `run` till den tiden. `start 08:00`, strip 1 `1h`, strip 2 låst `13:00` `1h`,
  strip 3 `1h` → `08:00`, `13:00`, `14:00` (glapp mellan strip 1 och 2).
- **Låst men otolkbar `start`** (`""`, `"garbage"`) → låset ignoreras, stripen
  får sekventiell tid som vanligt.
- **EGENHET — lås kan flytta `run` bakåt:** `start 08:00`, strip 1 `2h`
  (skulle sluta 10:00), strip 2 låst `08:30` → starttider `08:00`, `08:30`.
  Strip 2 börjar alltså innan strip 1 är klar. Lås är absoluta, ingen
  krockvalidering görs här (det är tänkt att `Planeringskontroll`-panelen ska
  fånga sånt, se `shortplanner-backlog`).
- **Efter midnatt:** `m2t` slår runt, så `start 20:00` + strips `3h` / `4h`
  ger `20:00`, `23:00`; en fjärde strip skulle visa `03:00`.
- Ett manuellt inskrivet klockslag i ett strip-fält sätter `s.lock = true`
  automatiskt (i `stripboard.js` `applyEdit`), så medvetna glapp överlever en
  omräkning.

`recalcAll()` kör `recalcDay` på alla dagar och visar toasten "Starttider
omräknade".

## 8. Dagssummor — `dayTotals(day) → { pages, mins, scenes, start, end, span }`

```
pages  = Σ parsePages(s.pages)   för s.type === "scene"
mins   = Σ parseEst(s.est)       för ALLA strips (även banner/rast/flytt)
scenes = antal s.type === "scene"
start  = t2m(day.start) ?? 0
end    = max( start + mins ,  sista_strip.start + parseEst(sista_strip.est) )
         där sista strips slut får +1440 om det annars hamnar före start
span   = end - start
```

- `mins` inkluderar **lunch, rast och company move** — de äter av dagen.
- Om ett lås skapat ett glapp blir `span` större än `mins` (exempel i avsnitt 7:
  `mins = 180`, men `span = 420` p.g.a. 13:00-låset).
- **EGENHET:** midnattsjusteringen (`+1440`) tittar bara på **sista** stripen,
  inte på en låst strip mitt i dagen som skulle sträcka sig förbi den.
- Otolkbar `day.start` → `start = 0` (midnatt), summorna räknas därifrån.
- **"Wrap" (dag som passerar midnatt):** om sista stripens beräknade slut
  (`t2m(start) + parseEst(est)`) hamnar före dagens `start` läggs `+1440` till,
  så `end` och `span` blir korrekta. Ex: `start 22:00`, sista strip börjar
  (efter varv) `01:00` med `est 2h` → slut `03:00` nästa dygn, `end = 1620`,
  `span = 300` (5h).

> Not: "wrappad dag" i **Rullplan** (`DATA.rullplanWrapped`, i `script.js`) är
> något helt annat — där markerar man en dag som färdiginspelad för att räkna
> in dess filmåtgång i budget-burn. Det rör inte den här tidslogiken.

## 9. 12-timmarsregeln

En dag flaggas som för lång när `span > 720` minuter (**strikt större än** 12h).

- `render()`: statistikrutan "Längsta dag" får klassen `warn`.
- Dagfoten: `span`-siffran får klassen `df-warn` och ett `" ⚠"` läggs till.
- Exakt `720` (12h jämnt) flaggas **inte**.
- Exempel: `start 06:00`, strips `8h` / `6h` → `span = 840` (14h) → flaggad.

Konstant i core: `DAY_LIMIT_MIN = 720`, hjälpare `isLongDay(span)`.

## 10. Arbetstids- och vilovarningar — `dayWarnings(day, prevDay, limits) → [{ level, text }]`

Bedömer en dag mot tre regler och returnerar noll eller flera varningar.
`level` är `"over"` (röd) eller `"warn"` (gul). Renderas av `stripboard.js` som
ett `.day-warns`-block i dagfoten; en `"over"`-varning gör dessutom dagens
`span`-siffra röd (`.df-num.df-over`), utöver 12-timmarsregelns gula flagg.

Gränsvärden (`limits`, alla i minuter) med `WORK_LIMITS` som standard:

| Nyckel | Standard | Betyder |
|---|---|---|
| `maxWorkdayMin` | `600` (10h) | Max arbetstid per dag, exkl. rast/lunch |
| `mealBreakByMin` | `300` (5h) | Lunch ska börja senast så här långt efter samling |
| `minRestMin` | `660` (11h) | Min. vila mellan två inspelningsdagar |

Klienten läser dessa från meta-doket (Projektinfo: `maxWorkdayHrs` /
`mealBreakByHrs` / `minRestHrs`, i timmar) via `app.js` `workLimits()`; tomt
fält → standard.

**Regel 1 — arbetstid.** `arbetstid = dayTotals(day).span − Σ parseEst(s.est)`
för strips där `isBreak(s)` är sant (dvs `stripKind(s) === "break"`: `s.kind`
`"break"` eller matchande `set`-text — se avsnitt 6). Är `arbetstid >
maxWorkdayMin` → `{ level: "over", text: "Arbetstid 11h 30m (över 10h 0m)" }`
(båda via `fmtEst`). Rast/lunch räknas alltså **inte** som arbetstid här, till
skillnad från `dayTotals.mins` (avsnitt 8) som räknar in allt.

**Regel 2 — lunch.** Finns ingen strip med `isBreak(s)` →
`{ level: "warn", text: "Ingen rast eller lunch inplanerad" }`. Finns en, men
`t2m(förstaRasten.start) − t2m(day.start) > mealBreakByMin` →
`{ level: "warn", text: "Lunch 6h 0m efter samling" }`. Otolkbara tider →
regeln hoppas tyst.

**Regel 3 — dygnsvila.** Enda regeln som tittar **över dygnsgränsen**. Körs
bara om `prevDay` finns, båda dagarna har `date`, och
`daysBetween(day.date, prevDay.date) === 1` (två på varandra följande
kalenderdagar — en vilodag emellan → ingen varning). Då:
`vila = (1440 + t2m(day.start)) − dayTotals(prevDay).end`. Är `vila <
minRestMin` → `{ level: "over", text: "8h 0m vila efter Dag 2" }` (`prevDay.label`,
`fmtEst(max(0, vila))`).

Tom dag, ingen `day.start` eller inga strips → `[]` (inga varningar).

## 11. Flytta en strip — `reorderStrips(from, fromIdx, to, toIdx) → bool`

Ren array-operation, utbruten ur `moveStrip` i `stripboard.js`.

- **No-op-skydd:** samma lista **och** (`toIdx === fromIdx` eller
  `toIdx === fromIdx + 1`) → returnerar `false`, listorna orörda (att släppa
  en strip exakt där den redan ligger gör ingenting).
- Annars: `splice` ut vid `fromIdx`; om samma lista och `toIdx > fromIdx`,
  dra av 1 från `toIdx` (kompensera för det borttagna elementet); `splice` in.
  Returnerar `true`.

I `stripboard.js` `moveStrip` ovanpå detta:

- Efter en lyckad flytt körs `recalcDay` på **måldagen** (om index ≥ 0) och på
  **källdagen** (om index ≥ 0 och skild från måldagen).
- Flytt till/från "Ej schemalagt" (`day === -1`) räknar **inte** om den sidan —
  strips i boneyard behåller sin gamla `start`-text tills de dras in på en dag.
- En no-op-flytt ritar bara om, kör inte `notify()` (inget sparas).

## 12. Övrigt

- `addStrip(di, type)`: den nya stripens `start` = föregående strips
  `start + est`, annars dagens `start`, annars `""` (boneyard utan föregående).
  Resten av dagen räknas inte om vid tillägg.
- `dupDay(di)`: djupkopierar dagen, tömmer datumet, kör `recalcDay` på kopian.
- `closestDayIndex(days, field)`: exakt datummatch vinner; annars närmaste dag i
  tid; har hela schemat passerat → **första** dagen (medvetet "börja om från
  toppen", inte närmaste). Delas med Call sheet och Dagsmanus.
