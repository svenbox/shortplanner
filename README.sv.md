# Shortplanner

[English](README.md) · **Svenska**

[![Licens: MIT](https://img.shields.io/badge/licens-MIT-blue.svg)](LICENSE)
[![Livedemo](https://img.shields.io/badge/livedemo-shortplanner--demo.soxbox.uk-brightgreen)](https://shortplanner-demo.soxbox.uk)
[![Node 22](https://img.shields.io/badge/node-22-informational.svg)](package.json)

Stripboard, call sheets, dagsmanus och produktionsbudget för filmproduktion — självhostat, en container, en SQLite-fil, ett lösenord.

Byggt för korta, låg­budget­produktioner där en enda person (ofta 1:e AD eller producent) sköter schemat, och resten av teamet bara behöver läsa det på en telefon utan täckning.

**Flikar:** Stripboard · Call sheets · Manus · Dagsmanus · Rullplan · DPR · Inspelningsläge · Skådespelare · Dela · Versioner · Projektinfo · Inställningar.

![Stripboard](docs/screenshots/stripboard.png)
![Call sheet](docs/screenshots/callsheet.png)

## Livedemo

### 👉 <https://shortplanner-demo.soxbox.uk> — logga in med lösenordet `demo`

En publik instans som kör exakt den här koden, så du kan prova Shortplanner utan att installera något. Den är laddad med en påhittad kortfilm (ingen verklig produktionsdata). Värt att göra:

- dra strips i stripboardet och se hur starttider och dagens arbetstidsvarningar räknas om;
- tryck **Skapa call sheet →** i en dagfot för att generera en call sheet, och slå sedan på **Redigera** för att ändra i den;
- öppna **🎬 Inspelningsläge** (bredvid DPR-fliken) för att se steg-för-steg-läget på inspelningsplatsen;
- öppna **Dela** för en skrivskyddad delningslänk och välj vilka delar den visar.

**Allt du ändrar nollställs varje natt kl 00:00 (svensk tid)** till utgångsläget, så ändra fritt. Att skapa, importera, duplicera och ta bort projekt är avstängt; allt annat fungerar. Den körs på en hemmaserver i mån av tid — räkna med att den kan vara långsam eller nere ibland. Vill du köra en egen, se [Köra en publik demo](docs/operating.sv.md#köra-en-publik-demo).

## Funktioner

- **Stripboard** — dra och släpp strips (funkar på pekskärm), automatiskt beräknade starttider, färgkodning INT/EXT, dag/natt, rast/lunch och förflyttning, sid- och tidssummor per dag. Varningar på dagen när en dag bryter mot en arbetstids- eller viloregel (lång dag, ingen rast/lunch, för kort dygnsvila efter föregående inspelningsdag) — gränsvärden per projekt. Importera scener från ett importerat manus, eller från en stripboard-JSON (från en annan Shortplanner-installation).
- **Call sheets** — genereras från en stripboarddag med ett klick, redigeras sedan fritt. Väder hämtas automatiskt (SMHI/MET Norway), kallningstider för skådespelare räknas fram från schemat, platser med QR-koder till Google Maps, redigeringsläge som skyddar mot råkade ändringar. En call sheet vars stripboarddag ändrats efter att den genererades märks som inaktuell.
- **Manus** — importera ett manus (PDF eller Fountain), se varje scens status mot planen (schemalagd/boneyard/saknas).
- **Dagsmanus** — sidor för varje inspelningsdag, härledda live ur manus + stripboard, tryckoptimerade (A5).
- **Rullplan** — budget för fysisk film (16mm): skärmtid, skjutförhållande, rullar, med en utfallskolumn du fyller i vid wrap och ett budget-burn-block (budget/förbrukat/kvar).
- **DPR** — daglig produktionsrapport genererad från call sheeten: scenstatus, sidor tagna, faktiska tider.
- **Inspelningsläge** — ett avskalat helskärmsläge för 1:e AD:ns telefon under inspelning: gå igenom dagen ett steg i taget (scener, luncher, förflyttningar) med stora knappar som stämplar de faktiska tiderna, så DPR:n nästan fyller i sig själv. Tryck-välj aktuell scen ur ordning, tryck-korrigera en stämplad tid.
- **Skådespelarregister** — ett litet register (ID, roll, namn) som driver en multi-check-dropdown i både stripboardets Roller-kolumn och call sheetens schema.
- **Delning** — en skrivskyddad länk per projekt, ingen inloggning krävs för mottagaren, med per-komponent-val av vad länken visar (stripboard, call sheets, manus, dagsmanus, rullplan).
- **Platser med QR** — koordinater, parkering/toalett/faciliteter och säkerhetsnoteringar per inspelningsplats. Skriver du ut call sheeten blir varje plats en skannbar QR-kod till Google Maps.
- **Offline-läsning** — installera som app (PWA); senast hämtad call sheet/stripboard/dagsmanus går att läsa utan täckning på inspelningsplatsen.
- **Sajtinställningar** — företagsnamn/logga (ersätter Shortplanners inbyggda) och gränssnittsspråk, för hela installationen.
- **Projekt & versioner** — flera produktioner i samma installation; arbetet sparas löpande, namngivna versioner fryser ett läge du kan återgå till. Optimistisk låsning varnar om samma projekt redigeras på flera enheter samtidigt.

Ingen byggkedja, ingen CDN, inga externa JavaScript-beroenden — vanilla JS serveras direkt ur `public/`. Mörkt läge, utskriftsstilark och mobila brytpunkter finns inbyggda.

## Manual

Varje flik och kontroll gås igenom i **[docs/manual.sv.md](docs/manual.sv.md)** ([english](docs/manual.md)). Resten av den här README:n handlar om att köra det själv.

---

## 1. Förberedelser på servern

Peka DNS mot serverns IP:

```
shortplanner.example.com.   A   <serverns IPv4>
shortplanner.example.com.   AAAA <serverns IPv6, om du har>
```

Kräver Docker och Docker Compose-pluginet:

```bash
docker --version
docker compose version
```

## 2. Installera

```bash
# lägg katalogen på servern, t.ex. /opt/shortplanner
git clone https://github.com/svenbox/shortplanner.git /opt/shortplanner
cd /opt/shortplanner

cp .env.example .env
nano .env          # sätt APP_PASSWORD
```

Generera gärna ett riktigt lösenord och en sessionshemlighet:

```bash
openssl rand -base64 24   # -> APP_PASSWORD
openssl rand -hex 32      # -> SESSION_SECRET
```

Starta:

```bash
docker compose up -d --build
docker compose logs -f    # ska säga "Shortplanner kör på port 3000"
```

Appen lyssnar nu på `127.0.0.1:8080` — bara lokalt på servern. Nästa steg publicerar den.

## 3. Publicera med TLS

### Alternativ A: Caddy (enklast, sköter certifikat själv)

```bash
sudo apt install caddy
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile     # eller klistra in blocket i din befintliga
sudo systemctl reload caddy
```

### Alternativ B: Nginx

```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/shortplanner.example.com
sudo ln -s /etc/nginx/sites-available/shortplanner.example.com /etc/nginx/sites-enabled/
sudo certbot --nginx -d shortplanner.example.com
sudo nginx -t && sudo systemctl reload nginx
```

### Alternativ C: Traefik

Kör `deploy/docker-compose.traefik.yml` istället för `docker-compose.yml`. Det förutsätter ett externt nätverk `traefik` och en certresolver som heter `le`.

Öppna sedan **https://shortplanner.example.com** och logga in med lösenordet från `.env`.

> Kör inte appen utan TLS över internet. Lösenordet skickas i klartext över HTTP, och sessionscookien sätts bara med `Secure`-flaggan när proxyn skickar `X-Forwarded-Proto: https`.

---

## Köra det

Daglig drift, teknikstacken, hela HTTP-API:t, hur man kör en publik demo och hur man kör lokalt utan Docker finns i **[docs/operating.sv.md](docs/operating.sv.md)** ([english](docs/operating.md)).

Under huven: Node 22 · Express · better-sqlite3 · vanilla-JS-PWA, inga byggsteg och ingen CDN. Autentiseringen är ett delat lösenord med HMAC-signerad cookie — se [SECURITY.md](SECURITY.md).

---

## Bidra

Buggrapporter och förslag är välkomna som issues. Se [CONTRIBUTING.sv.md](CONTRIBUTING.sv.md) för hur man kör projektet lokalt och skickar en pull request, och [SECURITY.md](SECURITY.md) för säkerhetsmodellen och hur man rapporterar en sårbarhet.

## Licens

[MIT](LICENSE).
