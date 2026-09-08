# Shortplanner — user manual

**English** · [Svenska](manual.sv.md)

A walkthrough of every tab and control. The interface is Swedish; feature names below give the Swedish label with an English gloss in parentheses. For what Shortplanner is, how to install it and the API, see the [README](../README.md).

---

## Getting started

**Projects** is the starting point. Create an empty project, or duplicate / import an existing one. **Projektinfo** (*Project info*, in the top bar inside a project) holds the basics — title, company, producer, director, DP, 1st AD, location manager, shooting dates, format — which pre-fill new call sheets as they are created. It also holds the working-hours rules the stripboard checks each day against (max workday, latest meal break after call, minimum rest between shooting days — in hours; blank = the defaults 10 / 5 / 11), and per-project **tab visibility**: turn off Reel budget, DPR or Shoot day mode for projects that don't use them.

**⚙ Inställningar** (*Settings*, on the project list) applies to the whole install: company name / logo for call sheets and the interface language. Which tabs a project shows is set per project, in **Projektinfo**.

## The Stripboard tab

- Drag the handle (⋮⋮) to move a strip — within a day, between days, or to and from the *Ej schemalagt* (*Unscheduled*) bank at the bottom. Works with a mouse or a finger. The **⋯** menu on a strip moves it to a specific day (or to *Ej schemalagt*) without dragging.
- Pages, est. time, I/E and DAY/NIGHT are dropdowns. I/E and DAY/NIGHT drive the strip's colour.
- On a non-scene strip, click the **i** circle to set its type explicitly — Info, company move or meal/break — instead of relying on the text. "Auto" goes back to deciding from the text.
- Change the est. time and the following start times are recalculated automatically.
- 🔒 locks a start time so it isn't moved on recalculation. Type a time in manually and it locks automatically — that's how you keep deliberate gaps in the day.
- Days over 12 hours are flagged amber in the day footer. Separately, the day footer shows a warning line when a day breaks one of the working-hours rules from **Projektinfo**: working time (day span minus meal/break strips) over the limit, no meal break scheduled or the meal starting too long after call, or less than the minimum rest between the end of the previous shooting day and this day's call. A red warning also turns that day's span figure red.
- **Duplicera dag** (*Duplicate day*) in the day footer copies a whole shooting day (strips and all, date cleared) as a new day.
- **📥 Importera scener** (*Import scenes*) creates one strip per scene in an imported script (into "Ej schemalagt", in script order), or reads a whole stripboard file (JSON, from another Shortplanner install or a project you exported earlier).

**Skapa call sheet →** (*Create call sheet*) in a day footer builds a call sheet from that day: schedule with info rows and a total row, call times (30 min before day start, hair/make-up 60 min before), working hours and a cast list from the scenes' role IDs. Once a call sheet exists for that day the button reads **Uppdatera call sheet →** (*Update call sheet*) — run it again and the schedule is updated while the locations, contacts, weather and cast times you filled in are kept. The Call sheets tab shows a stale-plan banner if the stripboard day was changed after the call sheet was last generated.

Write `MOS` in a scene's set/heading field to mark that it is shot without sound — an established industry term ("Mit Out Sound"), with no special behaviour in the app but good to know.

## The Script tab (*Manus*)

Import a script as a PDF (numbered shooting-script convention, scene numbers in both margins) or Fountain. Each scene shows its status against the actual plan: scheduled (with day and time), boneyard, or missing from the plan. **↳ Skapa stripboard av scenerna** (*Build stripboard from scenes*) turns the whole script into strips at once, if you'd rather plan from the script than the other way around.

## The Sides tab (*Dagsmanus*)

Generates print-ready pages per shooting day straight from the script + the stripboard order — no saved copy; change the schedule and it's mirrored immediately.

## The Reel budget tab (*Rullplan*)

Budgets physical film: screen time per scene (proposed proportional to the script pages, overridable by hand), shooting ratio (editable, default 14:1), reels (11 min/reel). Turn on Redigera (*Edit*) to enter what was actually rolled per scene and mark a day as wrapped — the budget-burn block then shows budget / used / remaining.

## The DPR tab

Daily Production Report, internal — not included in shared links. Generated from a day's call sheet: tick scenes off as done / partial / moved / cut, pages shot, actual vs planned times.

## Shoot day mode (*Inspelningsläge*)

A 🎬 button sits in the tab row, next to DPR. It opens a full-screen view built for the 1st AD's phone on set: a "start the day" screen, then one step at a time — scenes, and the meal / company-move rows from the call sheet — with the general call, planned start, stamped actual start and a rolling estimated wrap that creeps with the clock (green / amber / red against the planned wrap). Big buttons: **✓ Klar** (*Done*, stamps the actual end and moves on), **◐ Delvis** (*Partial*), **→ Hoppa över** (*Skip* — just moves the pointer, leaves the step unmarked), **◂ Backa** (*Back*), **+10 / +20 min** (adds slip to the current step). Tap any row in the step list to make it the current one out of order; tap ✎ on the actual-start line to correct a stamped time. Everything writes straight into the DPR day — lunch out/in, first shot and camera wrap fill themselves in. It needs a network (autosave as usual). When it isn't a shooting day (no DPR day within a day of today) the mode opens with a note explaining that instead of the stepper.

## Cast (*Skådespelare*)

The **Skådespelare** button in the top bar opens a small register: ID, role/character and (optionally) the actor's name. Add and remove freely, edit role/name by clicking in the fields. The ID is what you write in the stripboard's cast column.

In both the stripboard's cast column and the call sheet's schedule, the cast field is a button — click to open a checkbox list of the register and pick one or more. The panel closes and saves when you click outside it or on **Klar** (*Done*).

## Call sheets

**The Call sheets tab** has an edit button top right. Turn it on to change fields and add rows (including "+ Lägg till skådespelare"); turn it off to read and print. Locations and notes can be reordered in edit mode — grab the handle (⋮⋮) to the left of the entry and drop it where you want it; notes are shown in two columns. Department boxes under the call times can be removed with the cross in the corner.

**Weather.** In the call sheet's weather row, **🔄 Hämta väder** (*Fetch weather*) pulls a forecast from SMHI (fallback MET Norway / Yr.no) plus sunrise/sunset, for 12:00 local time (Stockholm; DST handled) on the day the call sheet applies — based on the address of the first location in the LOCATIONS list, or the hospital's if no location has a real address yet. It only works for dates within roughly the next week — there's no forecast further out yet.

**Cast call times.** The table at the bottom of the call sheet is filled in manually via **+ Lägg till skådespelare** (*Add actor* — pick from the register or free text), or automatically via **🔄 Uppdatera från schema** (*Update from schedule*) — which derives Call / HMU / On set / Wrap per person from their actual first and last scene that day (not the day's general start time). People added manually who don't appear in any scene's schedule are left untouched.

**Locations.** Each location in the LOCATIONS block — and the Emergency/Hospital box next to it — can be given coordinates, parking, toilet, other facilities and a safety note, all empty until you fill them in in edit mode. The coordinate field takes three kinds of input: type `65.67120, 21.98430` directly (comma or period as decimal separator, both fine), paste a whole Google Maps link (the coordinates are pulled from `@lat,lng`, `?q=`, `?query=` or the embedded `!3d!4d` data — a short `maps.app.goo.gl` link with no visible coordinates is followed and resolved server-side), or click **📍 Från adress** (*From address*) to look up coordinates automatically from the address field (Nominatim / OpenStreetMap). The coordinates are the source of truth: as soon as a location has them, a clickable "📍 Karta" (*Map*) link appears on screen, and on print the link is replaced by a QR code to the same Google Maps position — generated as inline SVG in the browser, no third-party service involved. START/END (the day's departure point / overnight stay) are inherited between days and only show a map pin on mobile until you expand the address. If you expect poor mobile coverage at a location, add an **offline warning** for that day — it reminds you to download offline maps in advance, since the QR codes need a network to resolve the scanned address.

> Always check the QR codes before a plan goes out to the team: print to PDF (or for real) and scan every code, not just a sample.

## Sharing (*Dela*)

The **Dela** (*Share*) button in the top bar generates a read-only link (`/share/<token>`) — no login required to view it, all editing controls removed. Five checkboxes choose what the link exposes: Stripboard, Call sheet, Manus (*Script*), Dagsmanus (*Sides*), Rullplan (*Reel budget*). All are on to begin with; tick one off and it takes effect on the same link immediately (the token doesn't change). The script text is only sent when Manus or Dagsmanus is shared — with only Rullplan ticked, the link gets scene numbers, sluglines and page/screen-time figures but no script body. DPR (internal) is never included. **Ta bort delning** (*Remove sharing*) invalidates the link immediately.

## Versions (*Versioner*)

Everything is saved continuously — the indicator in the top bar shows *Sparat HH:MM* (*Saved*). When you want to freeze a state, click **Spara version** (*Save version*) and name it. On **Återställ** (*Restore*), the current state is first saved automatically as *Före återställning* (*Before restore*), so you can never paint yourself into a corner. Edit the same project on two devices at once and the app warns you and lets you choose which version wins, instead of silently overwriting.

## Page title and printing

The browser tab (and therefore the suggested filename when printing to PDF) mirrors what you're looking at — "Project name – Stripboard", or "Project name – Call sheet – Måndag - Dag 1" and so on as you switch days. This applies to both the logged-in app and the public share link. Call sheets, sides (A5) and the stripboard each have their own print stylesheet.

## Offline

Shortplanner can be installed as an app (PWA) from the browser. The most recently fetched call sheet, stripboard and sides can be read with no network — handy on locations with no coverage. Editing still requires a network.
