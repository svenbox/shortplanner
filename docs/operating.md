# Shortplanner — operating notes

**English** · [Svenska](operating.sv.md)

Day-to-day running of a self-hosted install, the tech stack, the HTTP API, and
how to stand up a public demo. Installation is in the [README](../README.md).

---

## Operations

**Update to a new version of the code**

```bash
cd /opt/shortplanner
git pull
docker compose up -d --build
```

The database lives in a named volume and is untouched by rebuilds.

**Version control of the code.** The directory is a git repo — every meaningful change should be committed, so a mistake can be looked up and reverted with `git log` / `git diff` / `git checkout -- <file>`. Don't commit `.env` (already in `.gitignore`).

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

---

## Running a public demo

Set `DEMO_MODE=1` and the app becomes safe to expose to anyone: creating, importing, duplicating and deleting projects is refused (403), and the client shows a "DEMO" badge plus an intro overlay. Everything else — editing documents, versions, sharing — still works, so pair it with a scheduled reset.

`deploy/docker-compose.demo.yml` is a ready-made service (`DEMO_MODE=1`, trivial password `demo`, its own volume, localhost port 8092 — put your proxy in front). `deploy/demo-reset.sh` restores the instance from a seed database and is meant to run from cron; its header comment shows how to capture the seed from an instance in the state you want. Example crontab line for a nightly reset in the host's timezone:

```
0 0 * * *  /path/to/shortplanner/deploy/demo-reset.sh >> /var/log/sp-demo-reset.log 2>&1
```

---

## Running locally without Docker

```bash
npm install
APP_PASSWORD=test1234 DATA_DIR=./data PORT=3000 node server.js
# http://localhost:3000
```

Run `npm test` and `npm run lint` before sending a change; both also run in CI.
