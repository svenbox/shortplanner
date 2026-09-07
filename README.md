# Shortplanner

**English** · [Svenska](README.sv.md)

Stripboard, call sheets, sides and a film-stock budget for film production — self-hosted, one container, one SQLite file, one password.

Why? I'm a indie producer, fed up with paying huge fees to crappy software for planning a short film production. With great help from Claude, I've built this web-based app. It's been tested in the field and my team loved it. 

It's optimized for short, low-budget productions where a single person (often the 1st AD or producer) runs the schedule, and the rest of the team just needs to read it on a phone. Say farewell to printing call sheets! 

> **Note:** the application interface is currently Swedish only. This README is translated; the app itself is not (yet). Feature names below give the Swedish tab label in parentheses. 

![Stripboard](docs/screenshots/stripboard.png)
![Call sheet](docs/screenshots/callsheet.png)

## Live demo

**<https://shortplanner-demo.soxbox.uk>** — password **`demo`**

A public instance you can click around in. It runs on the fictional **"Skuggspel"** project (no real production data) and **everything resets to that state every night at 00:00 Europe/Stockholm**, so edit freely. Creating, importing, duplicating and deleting projects is turned off there; everything else works. Run by whoever maintains this repo, on a home server — it may be slow or down.

## Features

- **Stripboard** — drag-and-drop strips (works on a touch screen), automatically calculated start times, colour coding for INT/EXT, day/night, meals and company moves, page and time totals per day. On-the-day warnings when a day breaks a working-hours or rest rule (long day, no meal break, too little turnaround from the previous shooting day) — thresholds set per project. Import scenes from an imported script, or from a stripboard JSON file (from another Shortplanner install).
- **Call sheets** (*Call sheets*) — generated from a stripboard day with one click, then freely editable. Weather is fetched automatically (SMHI / MET Norway), cast call times are derived from the schedule, locations carry QR codes to Google Maps, and an edit toggle guards against accidental changes. A call sheet whose stripboard day changed after it was generated is flagged as stale.
- **Script** (*Manus*) — import a script (PDF or Fountain) and see each scene's status against the plan (scheduled / boneyard / missing).
- **Sides** (*Dagsmanus*) — pages for each shooting day, derived live from script + stripboard, print-optimised (A5).
- **Reel budget** (*Rullplan*) — a budget for physical film stock (16 mm): screen time, shooting ratio, reels, with an actuals column you fill in at wrap and a budget-burn block (budget / used / remaining).
- **DPR** — daily production report generated from the call sheet: scene status, pages shot, actual times.
- **Shoot day mode** (*Inspelningsläge*) — a stripped-down full-screen view for the 1st AD's phone during the shoot: step through the day one item at a time (scenes, meals, moves) with large buttons that stamp the actual times, so the DPR fills itself in. Pick the current step out of order, correct a stamped time by tapping it.
- **Cast register** (*Skådespelare*) — a small register (ID, role, name) that drives a multi-check dropdown in both the stripboard's cast column and the call sheet's schedule.
- **Sharing** (*Dela*) — one read-only link per project, no login required for the recipient, with a per-component pick of what the link exposes (stripboard, call sheets, script, sides, reel budget); respects the site's feature on/off flags.
- **Locations with QR** — coordinates, parking / toilet / facilities and a safety note per location. Print the call sheet and every location becomes a scannable QR code to Google Maps.
- **Offline reading** — install as an app (PWA); the most recently fetched call sheet / stripboard / sides can be read with no signal on location.
- **Site settings** (*Inställningar*) — company name / logo (replacing Shortplanner's built-in one), turn off tabs (Reel budget / DPR) you don't use.
- **Projects & versions** — several productions in one install; work is saved continuously, named versions freeze a state you can return to. Optimistic locking warns if the same project is edited on more than one device at once.

---

## 1. Server prerequisites

Point DNS at the server's IP:

```
shortplanner.example.com.   A    <server IPv4>
shortplanner.example.com.   AAAA <server IPv6, if you have one>
```

Requires Docker and the Docker Compose plugin:

```bash
docker --version
docker compose version
```

## 2. Install

```bash
# put the directory on the server, e.g. /opt/shortplanner
git clone https://github.com/Svenbox/shortplanner.git /opt/shortplanner
cd /opt/shortplanner

cp .env.example .env
nano .env          # set APP_PASSWORD
```

Generate a real password and a session secret while you're at it:

```bash
openssl rand -base64 24   # -> APP_PASSWORD
openssl rand -hex 32      # -> SESSION_SECRET
```

Start:

```bash
docker compose up -d --build
docker compose logs -f    # should say "Shortplanner kör på port 3000"
```

The app now listens on `127.0.0.1:8080` — local to the server only. The next step publishes it.

## 3. Publish with TLS

### Option A: Caddy (simplest, handles certificates itself)

```bash
sudo apt install caddy
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile     # or paste the block into your existing one
sudo systemctl reload caddy
```

### Option B: Nginx

```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/shortplanner.example.com
sudo ln -s /etc/nginx/sites-available/shortplanner.example.com /etc/nginx/sites-enabled/
sudo certbot --nginx -d shortplanner.example.com
sudo nginx -t && sudo systemctl reload nginx
```

### Option C: Traefik

Run `deploy/docker-compose.traefik.yml` instead of `docker-compose.yml`. It assumes an external network named `traefik` and a cert resolver named `le`.

Then open **https://shortplanner.example.com** and log in with the password from `.env`.

> Don't run the app without TLS over the internet. The password is sent in clear text over HTTP, and the session cookie is only set with the `Secure` flag when the proxy passes `X-Forwarded-Proto: https`.

---

## How the app is used

**Projects** is the starting point. Create an empty project, or duplicate / import an existing one. **Projektinfo** (*Project info*, in the top bar inside a project) holds the basics — title, company, producer, director, DP, 1st AD, location manager, shooting dates, format — which pre-fill new call sheets as they are created. It also holds the working-hours rules the stripboard checks each day against: max workday, latest meal break after call, minimum rest between shooting days (in hours; blank = the defaults 10 / 5 / 11).

**⚙ Inställningar** (*Settings*, on the project list) applies to the whole install: company name / logo for call sheets, and on/off for the Reel budget and DPR tabs if you don't use them.

**The Stripboard tab**

- Drag the handle (⋮⋮) to move a strip — within a day, between days, or to and from the *Ej schemalagt* (*Unscheduled*) bank at the bottom. Works with a mouse or a finger. The **⋯** menu on a strip moves it to a specific day (or to *Ej schemalagt*) without dragging.
- Pages, est. time, I/E and DAY/NIGHT are dropdowns. I/E and DAY/NIGHT drive the strip's colour.
- Change the est. time and the following start times are recalculated automatically.
- 🔒 locks a start time so it isn't moved on recalculation. Type a time in manually and it locks automatically — that's how you keep deliberate gaps in the day.
- Days over 12 hours are flagged amber in the day footer. Separately, the day footer shows a warning line when a day breaks one of the working-hours rules from **Projektinfo**: working time (day span minus meal/break strips) over the limit, no meal break scheduled or the meal starting too long after call, or less than the minimum rest between the end of the previous shooting day and this day's call. A red warning also turns that day's span figure red.
- **Duplicera dag** (*Duplicate day*) in the day footer copies a whole shooting day (strips and all, date cleared) as a new day.
- **📥 Importera scener** (*Import scenes*) creates one strip per scene in an imported script (into "Ej schemalagt", in script order), or reads a whole stripboard file (JSON, from another Shortplanner install or a project you exported earlier).

**Skapa call sheet →** (*Create call sheet*) in a day footer builds a call sheet from that day: schedule with info rows and a total row, call times (30 min before day start, hair/make-up 60 min before), working hours and a cast list from the scenes' role IDs. Once a call sheet exists for that day the button reads **Uppdatera call sheet →** (*Update call sheet*) — run it again and the schedule is updated while the locations, contacts, weather and cast times you filled in are kept. The Call sheets tab shows a stale-plan banner if the stripboard day was changed after the call sheet was last generated.

Write `MOS` in a scene's set/heading field to mark that it is shot without sound — an established industry term ("Mit Out Sound"), with no special behaviour in the app but good to know.

**The Script tab** (*Manus*). Import a script as a PDF (numbered shooting-script convention, scene numbers in both margins) or Fountain. Each scene shows its status against the actual plan: scheduled (with day and time), boneyard, or missing from the plan. **↳ Skapa stripboard av scenerna** (*Build stripboard from scenes*) turns the whole script into strips at once, if you'd rather plan from the script than the other way around.

**The Sides tab** (*Dagsmanus*) generates print-ready pages per shooting day straight from the script + the stripboard order — no saved copy; change the schedule and it's mirrored immediately.

**The Reel budget tab** (*Rullplan*) budgets physical film: screen time per scene (proposed proportional to the script pages, overridable by hand), shooting ratio (editable, default 14:1), reels (11 min/reel). Turn on Redigera (*Edit*) to enter what was actually rolled per scene and mark a day as wrapped — the budget-burn block then shows budget / used / remaining.

**The DPR tab** (Daily Production Report, internal — not included in shared links) is generated from a day's call sheet: tick scenes off as done / partial / moved / cut, pages shot, actual vs planned times.

**Shoot day mode** (*Inspelningsläge*). A 🎬 button appears in the top bar on shooting days (when a DPR day is within a day of today), and there is one in the DPR tab too. It opens a full-screen view built for the 1st AD's phone on set: a "start the day" screen, then one step at a time — scenes, and the meal / company-move rows from the call sheet — with the general call, planned start, stamped actual start and a rolling estimated wrap that creeps with the clock (green / amber / red against the planned wrap). Big buttons: **✓ Klar** (*Done*, stamps the actual end and moves on), **◐ Delvis** (*Partial*), **→ Hoppa över** (*Skip* — just moves the pointer, leaves the step unmarked), **◂ Backa** (*Back*), **+10 / +20 min** (adds slip to the current step). Tap any row in the step list to make it the current one out of order; tap ✎ on the actual-start line to correct a stamped time. Everything writes straight into the DPR day — lunch out/in, first shot and camera wrap fill themselves in. It needs a network (autosave as usual).

**Cast.** The **Skådespelare** (*Cast*) button in the top bar opens a small register: ID, role/character and (optionally) the actor's name. Add and remove freely, edit role/name by clicking in the fields. The ID is what you write in the stripboard's cast column.

In both the stripboard's cast column and the call sheet's schedule, the cast field is a button — click to open a checkbox list of the register and pick one or more. The panel closes and saves when you click outside it or on **Klar** (*Done*).

**Weather.** In the call sheet's weather row, **🔄 Hämta väder** (*Fetch weather*) pulls a forecast from SMHI (fallback MET Norway / Yr.no) plus sunrise/sunset, for 12:00 local time (Stockholm; DST handled) on the day the call sheet applies — based on the address of the first location in the LOCATIONS list, or the hospital's if no location has a real address yet. It only works for dates within roughly the next week — there's no forecast further out yet.

**Cast call times.** The table at the bottom of the call sheet is filled in manually via **+ Lägg till skådespelare** (*Add actor* — pick from the register or free text), or automatically via **🔄 Uppdatera från schema** (*Update from schedule*) — which derives Call / HMU / On set / Wrap per person from their actual first and last scene that day (not the day's general start time). People added manually who don't appear in any scene's schedule are left untouched.

**The Call sheets tab** has an edit button top right. Turn it on to change fields and add rows (including "+ Lägg till skådespelare"); turn it off to read and print. Locations and notes can be reordered in edit mode — grab the handle (⋮⋮) to the left of the entry and drop it where you want it; notes are shown in two columns. Department boxes under the call times can be removed with the cross in the corner.

**Page title.** The browser tab (and therefore the suggested filename when printing to PDF) mirrors what you're looking at — "Project name – Stripboard", or "Project name – Call sheet – Måndag - Dag 1" and so on as you switch days. This applies to both the logged-in app and the public share link.

**Locations.** Each location in the LOCATIONS block — and the Emergency/Hospital box next to it — can be given coordinates, parking, toilet, other facilities and a safety note, all empty until you fill them in in edit mode. The coordinate field takes three kinds of input: type `65.67120, 21.98430` directly (comma or period as decimal separator, both fine), paste a whole Google Maps link (the coordinates are pulled from `@lat,lng`, `?q=`, `?query=` or the embedded `!3d!4d` data — a short `maps.app.goo.gl` link with no visible coordinates is followed and resolved server-side), or click **📍 Från adress** (*From address*) to look up coordinates automatically from the address field (Nominatim / OpenStreetMap). The coordinates are the source of truth: as soon as a location has them, a clickable "📍 Karta" (*Map*) link appears on screen, and on print the link is replaced by a QR code to the same Google Maps position — generated as inline SVG in the browser, no third-party service involved. START/END (the day's departure point / overnight stay) are inherited between days and only show a map pin on mobile until you expand the address. If you expect poor mobile coverage at a location, add an **offline warning** for that day — it reminds you to download offline maps in advance, since the QR codes need a network to resolve the scanned address.

> Always check the QR codes before a plan goes out to the team: print to PDF (or for real) and scan every code, not just a sample.

**Sharing.** The **Dela** (*Share*) button in the top bar generates a read-only link (`/share/<token>`) — no login required to view it, all editing controls removed. Five checkboxes choose what the link exposes: Stripboard, Call sheet, Manus (*Script*), Dagsmanus (*Sides*), Rullplan (*Reel budget*). All are on to begin with; tick one off and it takes effect on the same link immediately (the token doesn't change). The script text is only sent when Manus or Dagsmanus is shared — with only Rullplan ticked, the link gets scene numbers, sluglines and page/screen-time figures but no script body. DPR (internal) is never included. **Ta bort delning** (*Remove sharing*) invalidates the link immediately.

**Versions.** Everything is saved continuously — the indicator in the top bar shows *Sparat HH:MM* (*Saved*). When you want to freeze a state, click **Spara version** (*Save version*) and name it. On **Återställ** (*Restore*), the current state is first saved automatically as *Före återställning* (*Before restore*), so you can never paint yourself into a corner. Edit the same project on two devices at once and the app warns you and lets you choose which version wins, instead of silently overwriting.

**Offline.** Shortplanner can be installed as an app (PWA) from the browser. The most recently fetched call sheet, stripboard and sides can be read with no network — handy on locations with no coverage. Editing still requires a network.

---

## Operations

**Update to a new version of the code**

```bash
cd /opt/shortplanner
git pull
docker compose up -d --build
```

The database lives in a named volume and is untouched by rebuilds.

**Version control of the code.** The directory is a git repo — every meaningful code change should be committed, so a mistake can be looked up and reverted with `git log` / `git diff` / `git checkout -- <file>`. Don't commit `.env` (already in `.gitignore`).

**Back up**

```bash
docker run --rm -v shortplanner_shortplanner-data:/data -v "$PWD":/backup \
  alpine tar czf /backup/shortplanner-$(date +%F).tar.gz -C /data .
```

Put that line in cron once a week. The Export button in the app additionally gives a JSON file per project including all versions — good to keep as a separate copy.

**Restore a backup**

```bash
docker compose down
docker run --rm -v shortplanner_shortplanner-data:/data -v "$PWD":/backup \
  alpine sh -c "rm -rf /data/* && tar xzf /backup/shortplanner-2026-08-20.tar.gz -C /data"
docker compose up -d
```

**Change the password**

Change `APP_PASSWORD` in `.env` and run `docker compose up -d`. Already-logged-in devices keep working until the session expires — to log everyone out immediately, also change `SESSION_SECRET`.

**Logs and status**

```bash
docker compose logs -f
docker compose ps          # the healthcheck shows in STATUS
```

**If a change doesn't show up after a restart** — check caching before you suspect the code. The server sends `Cache-Control: no-cache` on static files and sets an `X-App-Version` header (a hash of the assets) that the client polls against — a tab left open shows a "new version available" banner instead of silently running old code. A service worker caches the page for offline reading; it detects and fetches a new version automatically, but if something still looks stale: `SW_DISABLED=1` in the environment makes it unregister itself.

---

## Under the hood

| | |
|---|---|
| Server | Node 22, Express, better-sqlite3 |
| Database | SQLite in the volume `/data/shortplanner.db` (WAL) |
| Login | One password from `APP_PASSWORD`, HMAC-signed cookie, 30 days |
| Brute-force protection | 10 failed attempts per IP per 15 minutes |
| Client | Vanilla JS, no build step, no CDN, PWA with offline cache |

**API** (everything requires the login cookie except login / version / site-public / share / logo)

```
POST   /api/login                        { password }
POST   /api/logout
GET    /api/me
GET    /api/version                                        build id, for the client's version check
GET    /api/site                                           site settings (auth)
PUT    /api/site                         { ... }
GET    /api/site/public                                    public subset (name / logo / flags / language)
POST   /api/site/logo                    { dataUrl }        data URL png/jpg/svg/webp, max 2 MB
DELETE /api/site/logo
GET    /logo                                               public, the uploaded logo (404 if none)
GET    /api/projects
POST   /api/projects                     { name }
GET    /api/projects/:id
PATCH  /api/projects/:id                 { name }
DELETE /api/projects/:id
POST   /api/projects/:id/duplicate
POST   /api/projects/:id/share       { components? }       → { token, url, components } (creates if needed, else existing)
DELETE /api/projects/:id/share                             invalidates the share link
GET    /api/share/:token                                   public, unauthenticated — the selected docs + site + components[]
PUT    /api/projects/:id/doc/:kind       { data, baseUpdatedAt? }  kind = stripboard | callsheet | script | dpr | meta
GET    /api/projects/:id/export
POST   /api/projects/import
GET    /api/projects/:id/versions
POST   /api/projects/:id/versions        { label, note }
GET    /api/versions/:vid
PATCH  /api/versions/:vid                { label, note }
POST   /api/versions/:vid/restore
DELETE /api/versions/:vid
GET    /api/weather?address=&date=                         geocodes (Nominatim) → SMHI/MET Norway + sunrise-sunset.org
GET    /api/geocode?address=                               geocodes (Nominatim) → { lat, lng, place }
GET    /api/resolve-maps-link?url=                         follows a short Google Maps link, domain allow-listed
```

`PUT .../doc/:kind` supports optimistic locking: pass `baseUpdatedAt` from the last fetched document and the server responds 409 if someone else saved in between.

## Running a public demo

Set `DEMO_MODE=1` and the app becomes safe to expose to anyone: creating, importing, duplicating and deleting projects is refused (403), and the client shows a "DEMO" badge plus an intro overlay. Everything else — editing documents, versions, sharing — still works, so pair it with a scheduled reset.

`deploy/docker-compose.demo.yml` is a ready-made service (`DEMO_MODE=1`, trivial password `demo`, its own volume, localhost port 8092 — put your proxy in front). `deploy/demo-reset.sh` restores the instance from a seed database and is meant to run from cron; its header comment shows how to capture the seed from an instance in the state you want. Example crontab line for a nightly reset in the host's timezone:

```
0 0 * * *  /path/to/shortplanner/deploy/demo-reset.sh >> /var/log/sp-demo-reset.log 2>&1
```

## Running locally without Docker

```bash
npm install
APP_PASSWORD=test1234 DATA_DIR=./data PORT=3000 node server.js
# http://localhost:3000
```

---

## Contributing

Bug reports and suggestions are welcome as issues. See [CONTRIBUTING.md](CONTRIBUTING.md) for how to run the project locally and send a pull request.

## Licence

[MIT](LICENSE).
