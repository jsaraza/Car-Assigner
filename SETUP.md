# Setting up Family Cars

This takes about 15 minutes, once. You need:

- a computer with a web browser (a phone works but is fiddly)
- the Google account that will own the plan (its Sheet, its calendar, and the emails come from it)

Nothing here costs money.

---

## Part 1: Put the app online (GitHub Pages)

1. Merge this branch into `main`.
2. In the repo on GitHub, open **Settings → Pages**. Under **Build and deployment → Source**, pick **GitHub Actions**.
3. Open the **Actions** tab. The **Deploy app** run should go green within a couple of minutes.
   If it ran before step 2 and failed, open it and press **Re-run all jobs**.
4. The app is now at **https://jsaraza.github.io/Car-Assigner/**.
   To try it with made-up data, open **https://jsaraza.github.io/Car-Assigner/?demo=1**.

## Part 2: Set up the Google side (the Sheet, calendar and emails)

### 2a. Create the Sheet and paste in the code

1. Go to **https://sheets.new** while signed in to the Google account that should own the plan. Name the sheet **Family Cars**.
2. In the sheet, choose **Extensions → Apps Script**. A code editor opens with a file called `Code.gs`.
3. Click the gear icon (**Project Settings**):
   - Set **Time zone** to your own time zone.
   - Tick **Show "appsscript.json" manifest file in editor**.
4. Go back to the editor (the `< >` icon).
5. Open **https://jsaraza.github.io/Car-Assigner/apps-script/Code.gs**, select everything (Ctrl+A or Cmd+A) and copy it.
   In the editor, select everything in `Code.gs`, delete it, and paste.
6. Open `appsscript.json` in the editor. Replace its contents with
   **https://jsaraza.github.io/Car-Assigner/apps-script/appsscript.json**, then change `"timeZone"` to match step 3
   (for example `"America/Chicago"` or `"America/Los_Angeles"`).
7. Press **Save** (the disk icon).

### 2b. Run setup

1. In the toolbar's function dropdown, pick **setup**, then press **Run**.
2. Google asks for permission. Choose your account. You'll see **"Google hasn't verified this app"** because you wrote it yourself.
   Click **Advanced → Go to Family Cars (unsafe)**, then **Allow**.
   It needs access to this spreadsheet, your calendar (for the "Family Cars" calendar and invites), and sending email (for alerts).
3. When it finishes, the sheet has new tabs filled with **sample** data, and Google Calendar has a new calendar called **Family Cars**.

### 2c. Turn on the web app

1. In the editor, press **Deploy → New deployment**.
2. Click the gear next to "Select type" and pick **Web app**.
   - **Execute as:** Me
   - **Who has access:** Anyone
3. Press **Deploy** and copy the **Web app URL** (it ends in `/exec`).

"Anyone" only means the address can be reached. Every request still needs the secret family key, which is part of the family link.

### 2d. Make the family link

1. In the sheet's **Settings** tab, fill in:
   - `api_url`: the Web app URL from 2c
   - `app_url`: `https://jsaraza.github.io/Car-Assigner/`
2. In the editor, run **familyLink**. Copy the link from the log at the bottom.
   This is the link you send to the family. It has the key in it, so only share it in the family.
3. Run **installTriggers**. This turns on the noon check and the 5pm lock.

## Part 3: Put in the real information

Fill these in on the sheet's tabs:

| Tab | What to do |
|---|---|
| **People** | Real names in `name` (keep the `id` column as is), and everyone's `email` for calendar invites. `commute_minutes` is how long Dad's and your sister's drive to work takes, one way. |
| **Places** | Rough driving minutes from home to the brothers' school, Mom's work and the bus lot. |
| **Settings** | `school_dropoff`: the real morning time. Check `school_pickup` (3:05pm = `15:05`). |
| **Work Schedule** | One row per shift: `person` (`mom`, `dad` or `sister`), `date` (`2026-10-20`), `start` and `end` (24-hour, for example `08:00` and `16:30`). |
| **School Exceptions** | Days with no school (`no_school` = `TRUE`), or a different `dropoff`/`pickup` time that day. |

When the real schedules are in, run **removeSampleData** to delete the made-up shifts and plans. They're the rows marked `sample`.

Times are 24-hour (`15:05`), dates are `YYYY-MM-DD`, and lists like `can_drive` are separated by commas (`ev, lexus`).

## Part 4: Phones

**Everyone who plans** (you and your sister, and your parents if they ever want to look):
open the family link on the phone, pick your name, then:

- **iPhone (Safari):** Share button → **Add to Home Screen**
- **Android (Chrome):** ⋮ menu → **Add to Home screen** or **Install app**

**Your parents don't need to open anything.** At 5pm the day before, each driver gets a Google Calendar
invite for their rides, for example "🚗 Mom: Brothers to school (Pathfinder)". These show up in the
calendar app on their phones with normal reminders.

To see everyone's rides in one place, open Google Calendar on a computer, find **Family Cars** under
"My calendars", choose **Settings and sharing**, and share it with the family's emails.

---

## How the day works

| When | What happens |
|---|---|
| Any time before 5pm the day before | Anyone can plan, change and use **Suggest a fix**. |
| ~12:00pm the day before | If tomorrow still has problems, every driver gets an email. |
| 5:00pm the day before | Tomorrow locks. Between 5:00 and 5:30, calendar invites go out to each driver. |
| After 5pm | Changes still work, but they're marked **LATE**. The calendar updates right away and the people affected get an email saying who changed what. |

To use different times, change `cutoff_time` / `alert_time` in Settings and run **installTriggers** again.

## Updating the code later

1. Copy the new `Code.gs` from **https://jsaraza.github.io/Car-Assigner/apps-script/Code.gs** into the editor and save.
2. **Deploy → Manage deployments** → pencil icon → **Version: New version** → **Deploy**.
   This keeps the same Web app URL, so the family link keeps working.

(If you have Node.js installed you can use `clasp` instead of copy and paste: copy `.clasp.json.example`
to `.clasp.json`, put in the Script ID from Project Settings, then run `npx @google/clasp login` and `npx @google/clasp push`.)

## If something goes wrong

- **"This family link is wrong or out of date"**: the key changed. Run **familyLink** and send the new link.
- **A link got shared outside the family**: run **newFamilyKey**, then send everyone the new link.
- **The app says it can't load**: check that the Web app was deployed with "Who has access: Anyone", and that `api_url` is the `/exec` URL.
- **Times look an hour off**: the time zone in Project Settings (and `appsscript.json`) doesn't match where you live.
