# Demo material — *Pälsen*

These files drive the public demo at <https://shortplanner-demo.soxbox.uk>.

| File | What it is |
|---|---|
| `../../deploy/demo-seed/palsen-project.json` | The full project (`shortplanner/project@1`) the demo is seeded from — stripboard, script, cast, project info. Imported by `deploy/demo-reset.sh` (via `scripts/demo-redate.js`, which rolls the shooting dates so day 1 is always tomorrow). |
| `palsen.fountain` | The screenplay in Fountain format. |
| `palsen.pdf` | The same screenplay as a numbered shooting script (PDF) — used to exercise Shortplanner's PDF importer. |

## About the script

*Pälsen* ("The Fur Coat") is a 16-scene short, **written for this demo**, freely
after Hjalmar Söderberg's short story *Pälsen* from *Historietter* (1898).
Söderberg died in 1941, so the source story is in the public domain.

Christmas Eve in turn-of-the-century Stockholm: a poor doctor borrows a fur coat
from his rich friend, is treated for one afternoon as a different man — and comes
home in the dark to a wife who mistakes him for someone else.

It is built to show the stripboard off: INT and EXT, morning / day / dusk /
evening / night, a mid-day blackout, five location moves on day 2, background
groups, a horse in shot, a child in shot with working-hours limits, a hard
sunset window, and a scene left in the boneyard because it belongs with another.
**Day 2 deliberately breaks the working-hours rules** — drag scene 7 (Richardt's
office) to *Ej schemalagt* and the warnings clear.

## Licence

The screenplay (`palsen.fountain`, `palsen.pdf`) and the project file are
released under **[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)** —
public domain, use / change / redistribute freely, no attribution required.
The names, company (*Vinterljus Film AB*) and crew in the files are invented.
