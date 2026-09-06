# Contributing to Shortplanner

**English** · [Svenska](CONTRIBUTING.sv.md)

Thanks for your interest! This is a small, practical tool built around one specific workflow (stripboard → call sheet → sides / reel budget / DPR) — contributions are welcome, but please keep the size of proposals humble relative to that.

## Report a bug / suggest a feature

Open an issue. Describe:
- What you expected to happen, and what actually happened.
- Steps to reproduce, if it's a bug.
- Browser / device if it looks UI-specific.

## Running the project locally

```bash
git clone https://github.com/Svenbox/shortplanner.git
cd shortplanner
npm install
cp .env.example .env
nano .env   # set APP_PASSWORD
APP_PASSWORD=$(grep APP_PASSWORD .env | cut -d= -f2) DATA_DIR=./data PORT=3000 node server.js
```

Or with Docker: `docker compose up -d --build` (see the README for full instructions).

There are no build steps — the client is vanilla JS served directly (`public/js/*.js`). Change a file, reload the page.

## Sending a pull request

- One focused change per PR — several small ones rather than one large.
- Follow the existing code style (no frameworks, no transpilation steps, comments in Swedish where the rest of the file already is).
- Test manually in the browser before submitting — there's no automated test suite yet.
- Describe *why* the change is needed, not just what it does.

## Architecture in brief

- `server.js` + `db.js` — Express + better-sqlite3; one generic `docs` table (`project_id, kind, data`) holds stripboard/callsheet/script/dpr/meta as JSON.
- `public/js/stripboard.js`, `callsheet.js`, `script.js` (Script/Sides/Reel budget), `dpr.js`, `app.js` (shell), `view.js` (public shared view) — each module exposes itself as a global object (`window.SB`, `window.CS`, …) and renders into a root element.
- No build tools, no bundling step, no external JS dependencies in the client (everything vendored locally in `public/js/vendor/`).

## Conduct

Be kind. Assume good intent. This is a small community around a niche tool, not a large project — a friendly tone costs nothing.
