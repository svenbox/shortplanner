# Security

## The security model

Shortplanner authenticates with **a single shared password** (`APP_PASSWORD`).
A successful login sets one HMAC-signed cookie (`SESSION_SECRET`, or a value
generated and stored in the database if you leave it blank), valid for
`SESSION_DAYS` (default 30). There are **no user accounts, no roles and no
permission levels** — anyone with the password can see and edit everything in
the install.

This is a deliberate choice, not a missing feature. Shortplanner is built for a
single production run by a small team; the schedule is not secret from the
people making the film, and a shared password is one less thing to administer on
set. If you need per-user access control, Shortplanner is the wrong tool.

What the code does do:

- **Brute-force throttle** — 10 failed logins per IP per 15 minutes.
- **Cookie hardening** — `HttpOnly`, `SameSite=Lax`, and `Secure` whenever the
  proxy passes `X-Forwarded-Proto: https`. Run it behind TLS; over plain HTTP
  the password travels in clear text.
- **Read-only share links** — `/share/<token>` exposes only the components the
  project owner ticked, with all editing controls stripped. The script body is
  withheld unless Manus or Dagsmanus is explicitly shared. Revoking a link is
  immediate.
- **Input validation** — every document and every project import is checked
  against a schema (`validate.js`) for structure and size before anything is
  written to SQLite; imports run in a single transaction.
- **No third-party runtime** — no CDN, no external JavaScript, no analytics.
  Weather and geocoding are the only outbound calls (SMHI / MET Norway /
  Nominatim / sunrise-sunset.org), made server-side.
- **`DEMO_MODE=1`** additionally refuses project create / import / duplicate /
  delete, for public demo instances.

## Supported versions

Only the latest `main` (and the most recent tagged release) is supported. There
are no backported fixes.

## Reporting a vulnerability

Please **do not** open a public issue for a security problem.

Use GitHub's private vulnerability reporting:
**<https://github.com/svenbox/shortplanner/security/advisories/new>**
(Security tab → *Report a vulnerability*).

This is a small hobby project maintained in spare time — expect a first reply
within about a week. Fixes land on `main` and are noted in `CHANGELOG.md`.
