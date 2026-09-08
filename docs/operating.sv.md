# Shortplanner — driftanteckningar

[English](operating.md) · **Svenska**

Daglig drift av en självhostad installation, teknikstacken, HTTP-API:t och hur
man startar en publik demo. Installation finns i [README](../README.sv.md).


## Drift

**Uppdatera till en ny version av koden**

```bash
cd /opt/shortplanner
git pull
docker compose up -d --build
```

Databasen ligger i en namngiven volym och rörs inte av ombyggen.

**Versionshantering av koden.** Katalogen är ett git-repo — varje meningsfull kodändring bör committas, så att ett misstag går att slå upp och backa med `git log` / `git diff` / `git checkout -- <fil>`. Committa inte `.env` (redan i `.gitignore`).

**Säkerhetskopiera**

```bash
docker run --rm -v shortplanner_shortplanner-data:/data -v "$PWD":/backup \
  alpine tar czf /backup/shortplanner-$(date +%F).tar.gz -C /data .
```

Lägg den raden i cron en gång i veckan. Exportknappen i appen ger dessutom en JSON-fil per projekt inklusive alla versioner — bra att ha som separat kopia.

**Återläs en säkerhetskopia**

```bash
docker compose down
docker run --rm -v shortplanner_shortplanner-data:/data -v "$PWD":/backup \
  alpine sh -c "rm -rf /data/* && tar xzf /backup/shortplanner-2026-08-20.tar.gz -C /data"
docker compose up -d
```

**Byta lösenord**

Ändra `APP_PASSWORD` i `.env` och kör `docker compose up -d`. Redan inloggade enheter fortsätter fungera tills sessionen går ut — vill du logga ut alla direkt byter du även `SESSION_SECRET`.

**Loggar och status**

```bash
docker compose logs -f
docker compose ps          # healthcheck syns i STATUS
```

**Om en ändring inte syns efter omstart** — kolla cachning innan du misstänker koden. Servern skickar `Cache-Control: no-cache` på statiska filer och sätter en `X-App-Version`-header (hash av tillgångarna) som klienten pollar mot — en flik som stått öppen visar en "ny version finns"-banner istället för att tyst köra gammal kod. En service worker cachar sidan för offline-läsning; den upptäcker och hämtar en ny version automatiskt, men om något ändå ser gammalt ut: `SW_DISABLED=1` i miljön får den att avregistrera sig själv.

---

## Under huven

| | |
|---|---|
| Server | Node 22, Express, better-sqlite3 |
| Databas | SQLite i volymen `/data/shortplanner.db` (WAL) |
| Inloggning | Ett lösenord från `APP_PASSWORD`, HMAC-signerad cookie, 30 dagar |
| Bruteforce-skydd | 10 misslyckade försök per IP per 15 minuter |
| Klient | Vanilla JS, inga byggsteg, ingen CDN, PWA med offline-cache |

**API** (allt kräver inloggningscookie utom login/version/site-public/share/logo)

```
POST   /api/login                        { password }
POST   /api/logout
GET    /api/me
GET    /api/version                                         build-id, för klientens versionskoll
GET    /api/site                                            sajtinställningar (auth)
PUT    /api/site                         { ... }
GET    /api/site/public                                     publik delmängd (namn/logga/flaggor/språk)
POST   /api/site/logo                    { dataUrl }         data-URL png/jpg/svg/webp, max 2 MB
DELETE /api/site/logo
GET    /logo                                                 publik, den uppladdade loggan (404 om ingen)
GET    /api/projects
POST   /api/projects                     { name }
GET    /api/projects/:id
PATCH  /api/projects/:id                 { name }
DELETE /api/projects/:id
POST   /api/projects/:id/duplicate
POST   /api/projects/:id/share       { components? }        → { token, url, components } (skapar vid behov, annars befintlig)
DELETE /api/projects/:id/share                               ogiltigförklarar delningslänken
GET    /api/share/:token                                     publik, oautentiserad — de valda dokumenten + site + components[]
PUT    /api/projects/:id/doc/:kind       { data, baseUpdatedAt? }  kind = stripboard | callsheet | script | dpr | meta
GET    /api/projects/:id/export
POST   /api/projects/import
GET    /api/projects/:id/versions
POST   /api/projects/:id/versions        { label, note }
GET    /api/versions/:vid
PATCH  /api/versions/:vid                { label, note }
POST   /api/versions/:vid/restore
DELETE /api/versions/:vid
GET    /api/weather?address=&date=                          geokodar (Nominatim) → SMHI/MET Norway + sunrise-sunset.org
GET    /api/geocode?address=                                 geokodar (Nominatim) → { lat, lng, place }
GET    /api/resolve-maps-link?url=                           följer en kort Google Maps-länk, domän-allowlistad
```

`PUT .../doc/:kind` stödjer optimistisk låsning: skicka med `baseUpdatedAt` från senast hämtade dokument, servern svarar 409 om någon annan hunnit spara emellan.

## Köra en publik demo

Sätt `DEMO_MODE=1` så blir appen trygg att exponera för vem som helst: att skapa, importera, duplicera och ta bort projekt nekas (403), och klienten visar en ”DEMO”-badge plus en intro-overlay. Allt annat — redigera dokument, versioner, delning — funkar fortfarande, så kombinera med en schemalagd nollställning.

`deploy/docker-compose.demo.yml` är en färdig tjänst (`DEMO_MODE=1`, trivialt lösenord `demo`, egen volym, localhost-port 8092 — sätt din proxy framför). `deploy/demo-reset.sh` återställer instansen från en seed-databas och är tänkt att köras från cron; kommentaren överst i skriptet visar hur man fångar seed-filen från en instans i önskat läge. Exempelrad i crontab för nattlig nollställning i värdens tidszon:

```
0 0 * * *  /sökväg/till/shortplanner/deploy/demo-reset.sh >> /var/log/sp-demo-reset.log 2>&1
```

## Köra lokalt utan Docker

```bash
npm install
APP_PASSWORD=test1234 DATA_DIR=./data PORT=3000 node server.js
# http://localhost:3000
```

Kör `npm test` och `npm run lint` innan du skickar in en ändring; båda körs även i CI.

