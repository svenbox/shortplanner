# Datum och tid — kanonisk representation

Kort version: **en inspelningsdag lagras som `"YYYY-MM-DD"`, en väggklockstid
som `"HH:MM"`, och schemamatten räknar i heltalsminuter sedan midnatt.**
Ingen `Date` och ingen UTC-konvertering rör produktionens schema. Reglerna är
låsta av `test/datetime.test.js` (som bl.a. kör mot flera tidszoner, UTC−12
till UTC+14, och de svenska sommartidsbytena 2026).

---

## Kanoniska former

| Vad | Form | Var |
|---|---|---|
| Inspelningsdagens **datum** | `"YYYY-MM-DD"` (sträng) | `day.date` (stripboard), `day.date_iso` (call sheet/DPR) |
| **Väggklockstid** (dagsstart, scenstart, kallningstid …) | `"HH:MM"` (sträng) | `day.start`, `strip.start`, kallningstider |
| Schemaräkning internt | **heltal = minuter sedan midnatt** | `t2m` / `m2t` i `stripboard-core.js` |
| "Sparat/uppdaterat/importerat"-**tidsstämpel** | ISO-8601 i **UTC** (`new Date().toISOString()`) | `created_at`, `updated_at`, `exported_at`, `importedAt` |

Call sheetens `day.date` är dessutom en **fritt redigerbar visningssträng**
("mån 5 okt 2026"); `day.date_iso` är det maskinläsbara värdet och det enda
som används i beräkningar och mot väder-API:t.

## Varför det inte kan glida

- **Schematiderna** (`recalcDay`, `dayTotals`, lås, lunch, company move, 12 h-
  regeln) rör aldrig ett `Date`-objekt. Allt är `t2m("HH:MM") → minuter`,
  addition, och `m2t(minuter)` som normaliserar **modulo 1440**. En dag som
  passerar midnatt visar `00:xx` / `01:xx` och `span` räknas rätt — helt
  oberoende av tidszon och sommartid, eftersom ingen tidszon är inblandad.
- **Kalenderräkning** (veckodag, datumdifferens, `+1 dag`, "närmaste dag till
  idag") sker alltid genom att parsa `"YYYY-MM-DD"` vid **lokal middag**
  (`new Date(iso + "T12:00:00")`, ingen `Z`) och läsa **lokala** delar
  (`getFullYear/getMonth/getDate/getDay`) — **aldrig** `toISOString()`.
  Middagsankaret gör att sommartidsbytet (kl 02–03) och midnatt inte kan
  knuffa dagen till gårdagen eller morgondagen, i någon tidszon.
  - `daysBetween`: en DST-dag är 23 eller 25 timmar, men `Math.round(Δ/24h)`
    suger upp den avvikande timmen (71 h → 3 dygn, 49 h → 2 dygn).
  - `addDays(iso, n)`: `setDate(getDate()+n)` följt av att läsa tillbaka
    lokala delar. Ersatte en tidigare `.toISOString().slice(0,10)` i
    `addDay()` som fungerade för svensk tid av en slump (lokal middag = 10–11
    UTC, korsar aldrig UTC-midnatt) men var implicit och tidszonsberoende.
- **`todayIso()`** bygger `"YYYY-MM-DD"` av **lokala** delar av `new Date()`,
  inte `toISOString()` — så "idag" är användarens lokala datum, inte UTC:s
  (som kan ligga en dag fel strax före/efter midnatt).

## Ende stället som medvetet konverterar tidszon: vädret

`GET /api/weather` (`server.js`) måste matcha en prognospunkt mot "kl 12:00
svensk tid på inspelningsdagen". Det görs korrekt och explicit:

- `Intl.DateTimeFormat("en-US", { timeZone: "Europe/Stockholm", … })` plockar
  ut väggklocksdelarna, och `Date.parse(...Z)` gör om "svensk middag" till en
  UTC-tidsstämpel — hanterar DST automatiskt.
- Prognos-API:ernas tidsstämplar (SMHI `validTime`, MET `time`) är ISO med
  `Z` och jämförs som `getTime()`.
- Soluppgång/nedgång formateras till svensk `HH:MM` med
  `Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm" })`.

Ingen produktionsdata lagras härifrån — bara en hämtad prognos visas.

## Visnings­stämplar i lokal tid (medvetet)

"Sparat HH:MM" (spar-indikatorn), "Uppdaterad HH:MM" (delade vyns färskhets-
rad) och versionslistans "YYYY-MM-DD HH:MM" formaterar en **UTC-tidsstämpel**
i **läsarens** lokala tid. Det är avsiktligt — de svarar på "när hände det
här" för den som tittar, inte på schemaläggningsfrågor. De rör ingen
produktionsdata.

## Om appen någon gång ska stödja en annan tidszon än svensk

`Europe/Stockholm` är hårdkodat i väderkoden och `sv-SE`/svenska månads- och
veckodagsnamn i `stripboard-core.js`. Datum- och schemalogiken i övrigt är
redan tidszons­oberoende. En framtida flertidszons­variant skulle behöva en
`site_config.timezone` som väderkoden och (ev.) `todayIso` läser — men
`"YYYY-MM-DD"` + `"HH:MM"` + minutmatten är rätt kanonisk grund att bygga på.
