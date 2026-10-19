# Family Cars (Car Assigner)

A free planner for a family that shares three cars. It answers "who's driving who, in which car" by
**5pm the day before**, so nobody finds out in the morning that they're driving.

- **Planner:** works out each day's rides from the work schedules and the school calendar (brothers to
  school and back, Mom to and from work, pickup requests), plus who keeps a car all day (commuters,
  bus-lot days).
- **Planner role:** one person (set in the Sheet; Dad by default) assigns drivers and cars. Everyone
  else sees the plan and adds their own busy times, bus-lot days and pickup requests.
- **Phone notifications:** when a ride is assigned, the driver gets "You're driving Brothers to school
  tomorrow…" and the rider gets "Jim is dropping you off at school…". This uses the free ntfy app.
  Grandparents can be added as helpers who drive their own car.
- **Rules:** who can drive which car, nobody in two places at once, no car double-booked, nobody
  assigned during their busy time. Preferences: the EV goes to the longest commute, and driving is
  spread around.
- **Suggest a fix:** fills in a day so every ride is covered, keeping choices people already made
  when possible. For example, if Dad and Sister both work, it gives Dad the Pathfinder so the Lexus
  stays home for whoever drives Mom.
- **Deadline:** an email to the planner at noon if tomorrow has problems, a lock at 5pm with Google Calendar
  invites for each driver, and every change after that is marked **LATE** and emailed to the people
  it affects.

Cost: $0. It runs on Google Sheets + Apps Script and GitHub Pages.

**Set it up:** see [SETUP.md](SETUP.md).
**Try it:** https://jsaraza.github.io/Car-Assigner/?demo=1 (after Pages is turned on).

## How it fits together

```
 Phones (home-screen web app)            Google account
 ┌──────────────────────────┐   POST    ┌─────────────────────────────────────┐
 │ web/  on GitHub Pages     │ ───────▶ │ Apps Script web app (apps-script/)   │
 │ Tomorrow · Week ·         │  + key    │   ├─ Google Sheet: all the data      │
 │ My Plans · Changes        │ ◀─────── │   ├─ Calendar: invites at 5pm        │
 └──────────────────────────┘   JSON    │   └─ Gmail: noon + late-change mail  │
                                         └─────────────────────────────────────┘
```

No personal information is in this repo. Names, emails and schedules only live in the Google Sheet.

## Repo layout

| Path | What |
|---|---|
| `apps-script/Util.js, Schema.js, Planner.js, Notify.js, Sample.js, Actions.js` | Shared logic: plain functions that run in Apps Script, in the browser (demo mode) and in Node (tests) |
| `apps-script/Store.js, Api.js, Jobs.js, Setup.js` | Apps Script only: Sheet storage, the web endpoint, timed jobs, calendar and email, setup |
| `web/` | The phone app (no build step, no dependencies) |
| `tests/` | `node --test`, including the backend run against fake Google services |
| `tools/build.js` | Builds `dist/web`: the app, its `lib/`, and `apps-script/Code.gs` (all backend files in one, for pasting) |

## Development

```
npm test          # unit + backend tests
npm run build     # -> dist/web
npm run serve     # http://localhost:8080/?demo=1
```

Requires Node 20+. There are no npm dependencies.

## Roadmap

1. **Planner** ✅: rules, week view, suggestions, 5pm lock, calendar invites, late-change alerts.
2. **Who has which car:** Bluetooth automations (iPhone Shortcuts / Android MacroDroid) report when a
   phone connects to a car; the schedule decides who's driving when a passenger's phone connects too.
3. **Fair weekly assignment:** spread driving evenly across the week, not just within a day.
