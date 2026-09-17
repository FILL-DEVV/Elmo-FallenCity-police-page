# Callsign Log

A single-page, self-contained callsign / roster tracker for a NSW Police-style
Discord community. No build step, no dependencies — just open `index.html`
in a browser. All data is stored locally in the browser via `localStorage`.

## Features
- Separate rosters for General Duties, Highway Patrol, Tactical Operations
  Unit, and Criminal Investigations Unit, plus a shared executive tier
  (Commissioner–Chief Inspector) that appears on every division.
- Auto-assigned callsigns per rank/division block.
- Promote / Terminate workflow, with a Terminated Officers archive and an
  auto-generated Promotion Logs history.
- Academy tab: auto-rolled FTO list and a Student Police Officer checklist
  with a promotion-readiness tracker.
- CSV export per tab, roster bulk-import buttons, and a global search bar
  with a jump-to-officer dropdown.

## Usage
Open `index.html` directly in any modern browser — no server required.

## Data
Everything is stored in `localStorage` in the browser that opened the page.
Clearing site data, or opening the file in a different browser/profile,
starts you with an empty roster. Use the "Export .csv" buttons on each tab
to keep an external backup.
