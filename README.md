# Shortplanner

**English** · [Svenska](README.sv.md)

[![Licence: MIT](https://img.shields.io/badge/licence-MIT-blue.svg)](LICENSE)
[![Live demo](https://img.shields.io/badge/live%20demo-shortplanner--demo.soxbox.uk-brightgreen)](https://shortplanner-demo.soxbox.uk)
[![Node 22](https://img.shields.io/badge/node-22-informational.svg)](package.json)

Stripboard, call sheets, sides and a film-stock budget for film production — self-hosted, one container, one SQLite file, one password.

Why? I'm an indie producer, fed up with paying huge fees to crappy software for planning a short film production. With great help from Claude, I've built this web-based app. It's been tested in the field and my team loved it.

It's optimized for short, low-budget productions where a single person (often the 1st AD or producer) runs the schedule, and the rest of the team just needs to read it on a phone. Say farewell to printing call sheets!

> **Note:** the application interface is Swedish only. This README is translated; the app itself is not (yet).

**Feature names, Swedish → English:** Stripboard · Call sheets · Manus (Script) · Dagsmanus (Sides) · Rullplan (Reel budget) · DPR · Inspelningsläge (Shoot day mode) · Skådespelare (Cast) · Dela (Share) · Versioner (Versions) · Projektinfo (Project info) · Inställningar (Site settings).

![Stripboard](docs/screenshots/stripboard.png)
![Call sheet](docs/screenshots/callsheet.png)

## Live demo

### 👉 <https://shortplanner-demo.soxbox.uk> — log in with the password `demo`

A public instance running this exact code, so you can try Shortplanner without installing anything. It's loaded with a made-up short film (no real production data). Things worth doing:

- drag strips around the stripboard and watch the start times and the day's working-hours warnings recalculate;
- hit **Skapa call sheet →** in a day footer to generate a call sheet, then toggle **Redigera** to edit it;
- open **🎬 Inspelningsläge** (next to the DPR tab) to see the on-set stepper;
- open **Dela** to get a read-only share link and pick which parts it exposes.

**Everything you change is wiped every night at 00:00 (Europe/Stockholm)** and reset to the starting state, so edit freely. Creating, importing, duplicating and deleting projects is switched off; everything else works. It runs on a home server on a best-effort basis — expect it to be slow or occasionally down. To run your own, see [Running a public demo](docs/operating.md#running-a-public-demo).

## Features

- **Stripboard** — drag-and-drop strips (works on a touch screen), automatically calculated start times, colour coding for INT/EXT, day/night, meals and company moves, page and time totals per day. On-the-day warnings when a day breaks a working-hours or rest rule (long day, no meal break, too little turnaround from the previous shooting day) — thresholds set per project. Import scenes from an imported script, or from a stripboard JSON file (from another Shortplanner install).
- **Call sheets** (*Call sheets*) — generated from a stripboard day with one click, then freely editable. Weather is fetched automatically (SMHI / MET Norway), cast call times are derived from the schedule, locations carry QR codes to Google Maps, and an edit toggle guards against accidental changes. A call sheet whose stripboard day changed after it was generated is flagged as stale.
- **Script** (*Manus*) — import a script (PDF or Fountain) and see each scene's status against the plan (scheduled / boneyard / missing).
- **Sides** (*Dagsmanus*) — pages for each shooting day, derived live from script + stripboard, print-optimised (A5).
- **Reel budget** (*Rullplan*) — a budget for physical film stock (16 mm): screen time, shooting ratio, reels, with an actuals column you fill in at wrap and a budget-burn block (budget / used / remaining).
- **DPR** — daily production report generated from the call sheet: scene status, pages shot, actual times.
- **Shoot day mode** (*Inspelningsläge*) — a stripped-down full-screen view for the 1st AD's phone during the shoot: step through the day one item at a time (scenes, meals, moves) with large buttons that stamp the actual times, so the DPR fills itself in. Pick the current step out of order, correct a stamped time by tapping it.
- **Cast register** (*Skådespelare*) — a small register (ID, role, name) that drives a multi-check dropdown in both the stripboard's cast column and the call sheet's schedule.
- **Sharing** (*Dela*) — one read-only link per project, no login required for the recipient, with a per-component pick of what the link exposes (stripboard, call sheets, script, sides, reel budget).
- **Locations with QR** — coordinates, parking / toilet / facilities and a safety note per location. Print the call sheet and every location becomes a scannable QR code to Google Maps.
- **Offline reading** — install as an app (PWA); the most recently fetched call sheet / stripboard / sides can be read with no signal on location.
- **Site settings** (*Inställningar*) — company name / logo (replacing Shortplanner's built-in one) and interface language, for the whole install.
- **Projects & versions** — several productions in one install; work is saved continuously, named versions freeze a state you can return to. Optimistic locking warns if the same project is edited on more than one device at once.

No build step, no CDN, no external JavaScript — vanilla JS served straight from `public/`. Dark mode, print stylesheets and mobile breakpoints are built in.

## Manual

Every tab and control is walked through in **[docs/manual.md](docs/manual.md)** ([svenska](docs/manual.sv.md)). The rest of this README is about running it yourself.

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
git clone https://github.com/svenbox/shortplanner.git /opt/shortplanner
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

## Running it

Day-to-day operation, the tech stack, the full HTTP API, hosting a public demo,
and running locally without Docker are in **[docs/operating.md](docs/operating.md)**
([svenska](docs/operating.sv.md)).

Under the hood: Node 22 · Express · better-sqlite3 · vanilla-JS PWA, no build
step and no CDN. Auth is a single shared password with an HMAC-signed cookie —
see [SECURITY.md](SECURITY.md).

---

## Contributing

Bug reports and suggestions are welcome as issues. See [CONTRIBUTING.md](CONTRIBUTING.md) for how to run the project locally and send a pull request, and [SECURITY.md](SECURITY.md) for the security model and how to report a vulnerability.

## Licence

[MIT](LICENSE).
