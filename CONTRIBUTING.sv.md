# Bidra till Shortplanner

[English](CONTRIBUTING.md) · **Svenska**

Tack för att du är intresserad! Det här är ett litet, praktiskt verktyg byggt för en specifik arbetsprocess (stripboard → call sheet → dagsmanus/rullplan/DPR) — bidrag är välkomna, men håll gärna storleken på förslag ödmjuk mot det.

## Rapportera en bugg / föreslå en funktion

Öppna en issue. Beskriv:
- Vad du förväntade dig skulle hända, och vad som faktiskt hände.
- Steg för att återskapa, om det är en bugg.
- Webbläsare/enhet om det verkar vara UI-specifikt.

## Köra projektet lokalt

```bash
git clone https://github.com/Svenbox/shortplanner.git
cd shortplanner
npm install
cp .env.example .env
nano .env   # sätt APP_PASSWORD
APP_PASSWORD=$(grep APP_PASSWORD .env | cut -d= -f2) DATA_DIR=./data PORT=3000 node server.js
```

Eller med Docker: `docker compose up -d --build` (se README för fullständiga instruktioner).

Det finns inga byggsteg — klienten är vanilla JS som serveras direkt (`public/js/*.js`). Ändra en fil, ladda om sidan.

## Tester och kontroller

```bash
npm test        # node --test — ren domänlogik (stripboardtider, datum, inspelningsläge, validering)
npm run lint    # node --check över varje förstapartsfil (.js)
```

Båda körs i CI (GitHub Actions) vid varje push och pull request, tillsammans med ett Docker-bygge + smoke-test. Den rena, testbara logiken bor i `public/js/stripboard-core.js`, `public/js/shootday.js`, `store.js` och `validate.js`; reglerna är låsta av `test/*.test.js` och av `docs/stripboard-time-rules.md` / `docs/datetime-canonical.md` — ändra beteende där medvetet, och uppdatera dokumentet och testerna i samma ändring.

## Skicka en pull request

- Ett fokuserat ändringsförslag per PR — hellre flera små än en stor.
- Följ den befintliga kodstilen (inga ramverk, inga transpilerings-steg, kommentarer på svenska där resten av filen redan är det).
- Kör `npm test` och `npm run lint`, och testa manuellt i webbläsaren, innan du skickar in.
- Beskriv *varför* ändringen behövs, inte bara vad den gör.

## Arkitektur i korthet

- `server.js` + `db.js` — Express + better-sqlite3, ett generiskt `docs`-bord (`project_id, kind, data`) håller stripboard/callsheet/script/dpr/meta som JSON.
- `public/js/stripboard.js`, `callsheet.js`, `script.js` (Manus/Dagsmanus/Rullplan), `dpr.js`, `app.js` (skal), `view.js` (publik delad vy) — varje modul exponerar sig som ett globalt objekt (`window.SB`, `window.CS`, …) och renderar in i ett rot-element.
- Inga byggverktyg, inget bundlingsteg, inga externa JS-beroenden i klienten (allt vendorat lokalt i `public/js/vendor/`).

## Uppförande

Var trevlig. Anta god vilja. Det är ett litet community kring ett nischverktyg, inte ett stort projekt — en vänlig ton kostar inget.
