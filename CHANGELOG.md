# Changelog

All notable changes to Shortplanner are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project will start
following [Semantic Versioning](https://semver.org/spec/v2.0.0.html) from its
first tagged release, `v1.0.0`.

## [Unreleased]

Everything below ships in the first tagged release.

### Added

- **Stripboard** with drag-and-drop (mouse and touch), automatically calculated
  start times, lockable times, INT/EXT · day/night · meal/move colour coding,
  per-day page and time totals, and an `Ej schemalagt` (unscheduled) bank.
- **On-the-day working-hours warnings** in the stripboard day footer — long day,
  no meal break, meal too late, too little turnaround from the previous shooting
  day — with the thresholds set per project in Projektinfo.
- Explicit **strip type** picker on non-scene strips (the `i` circle): info,
  company move or meal/break, instead of only guessing from the text.
- **Call sheets** generated from a stripboard day and then freely editable:
  automatic weather (SMHI / MET Norway), sunrise/sunset, cast call times derived
  from the schedule, locations with coordinates and printable QR codes to Google
  Maps, an emergency/hospital block, department call times, a stale-plan banner
  when the stripboard changed after generation, and an edit toggle.
- **Script** import from PDF (numbered shooting script) or Fountain, with each
  scene's status against the plan (scheduled / boneyard / missing), and
  `Skapa stripboard av scenerna` to build the stripboard from the script.
- **Sides** (Dagsmanus) — print-ready A5 pages per shooting day, derived live.
- **Reel budget** (Rullplan) — 16 mm film-stock budget with screen time,
  shooting ratio, reels, per-day subtotals and a budget-burn block.
- **DPR** — daily production report from the call sheet.
- **Shoot day mode** (Inspelningsläge) — a full-screen on-set stepper for the
  1st AD's phone that stamps actual times into the DPR; start-the-day screen,
  tappable step list, tap-to-correct a stamped time.
- **Cast register** driving a multi-select in the stripboard and call sheet.
- **Sharing** — one read-only link per project with a per-component pick of what
  it exposes; the script body is only sent when Manus or Dagsmanus is shared.
- **Projects & versions** — several productions per install, continuous save,
  named versions, atomic restore, optimistic locking across devices.
- **Project import** with a versioned schema (`shortplanner/project@1`),
  validated in full before anything is written, inside one transaction.
- **Site settings** — company name / logo and interface language. **Per-project
  tab visibility** (Reel budget / DPR / Shoot day mode) in Projektinfo.
- **PWA / offline reading** of the most recently fetched documents, dark mode,
  print stylesheets, mobile breakpoints.
- **Public demo mode** (`DEMO_MODE=1`) plus `deploy/docker-compose.demo.yml` and
  `deploy/demo-reset.sh` for a self-hosted, nightly-reset demo.
- **GitHub Actions CI** — lint, tests, Docker build + smoke test on every push
  and pull request.
- Canonical date/time handling (documented in `docs/datetime-canonical.md`) and
  a stripboard time-rules spec (`docs/stripboard-time-rules.md`), both pinned by
  `npm test`.

[Unreleased]: https://github.com/svenbox/shortplanner/commits/main
