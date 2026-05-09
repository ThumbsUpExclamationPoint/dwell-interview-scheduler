# Deploy guide — Dwell Interview Scheduler

Total time: ~10 minutes. You'll do four things:

1. Create a Google Sheet (the "database")
2. Paste `Code.gs` into a new Apps Script project, point it at the Sheet, deploy it
3. Plug the Apps Script URL into the two HTML pages
4. Push the repo to GitHub and turn on Pages

You don't need a credit card, a domain, or any paid services.

---

## 1. Create the Google Sheet

1. Go to **https://sheets.google.com** while signed in as
   `matt@dwellpeninsula.com`.
2. Create a new blank spreadsheet. Title it **"Dwell Interview Scheduler — DB"**.
3. Rename the default tab `Reviewers`. Then create two more tabs (➕ at
   the bottom-left): `Availability` and `Bookings`.

   The `Reviewers` tab will be auto-populated by a helper function
   (don't worry about its headers yet). For the other two, paste these
   header rows into row 1:

   **`Availability` tab — row 1:**
   ```
   reviewer_id    start_iso    end_iso    created_at
   ```

   **`Bookings` tab — row 1:**
   ```
   id    reviewer_id    start_iso    end_iso    candidate_name    candidate_email    candidate_phone    status    calendar_event_id    created_at
   ```

4. Copy the Sheet's **file ID** from the URL — it's the long opaque
   string between `/d/` and `/edit`:
   `https://docs.google.com/spreadsheets/d/`**`THIS_PART_HERE`**`/edit`
5. Save that ID somewhere — you'll paste it in the next step.

---

## 2. Create the Apps Script project

1. Go to **https://script.google.com** while signed in as the same
   account that owns the Sheet.
2. Click **New project**. Rename it to **"Dwell Interview Scheduler"**.
3. In the editor, delete the placeholder `function myFunction()` and
   paste the contents of `apps-script/Code.gs` from this repo.
4. At the top of the file, replace the value of `SHEET_ID` with the
   file ID you copied from the Sheet. The line should look like:
   ```js
   const SHEET_ID = "1AbC2dEf3GhI4jKl5MnO6pQ7rS8tU9vWx";
   ```
5. **Save** (⌘S / Ctrl+S).

### 2a. Authorize the script (one-time)

This step ensures Apps Script asks for every permission the app needs
in one auth dialog instead of failing later with partial scopes.

1. In the function dropdown above the editor, select **`authorize`**.
2. Click **▶ Run**.
3. A dialog appears: "Authorization required". Click **Review permissions**.
4. Pick the `matt@dwellpeninsula.com` account.
5. You'll see "Google hasn't verified this app." Click **Advanced** →
   **Go to Dwell Interview Scheduler (unsafe)**. (It's safe — it's our
   own code. Google just hasn't gone through formal verification, which
   is for public-facing apps.)
6. Approve the requested permissions:
   - See, edit, create, and delete your spreadsheets in Google Drive
   - View and edit events on all your calendars
   - Send email as you
7. The function should finish with no errors. Check the **Execution log**
   at the bottom — last line should say "Authorization complete."

### 2b. Seed the Reviewers tab

1. In the function dropdown, select **`seedReviewers`**.
2. Click **▶ Run**.
3. Open the Sheet → `Reviewers` tab. You should see six rows with
   names, slugs, and emails. If you change names or emails later, update
   the `REVIEWERS` map at the top of `Code.gs` and re-run `seedReviewers`.

### 2c. Deploy as a web app

1. Top-right: **Deploy** → **New deployment**.
2. Click the gear ⚙ next to "Select type" → **Web app**.
3. Fill in:
   - **Description**: `v1`
   - **Execute as**: **Me (matt@dwellpeninsula.com)**
   - **Who has access**: **Anyone** (this allows non-signed-in candidates
     to POST without each having to log into Google)
4. Click **Deploy**.
5. Copy the **Web app URL**. It looks like:
   `https://script.google.com/macros/s/AKfycb.../exec`
6. Save it — you'll paste it into the two HTML files next.

---

## 3. Paste the Apps Script URL into the HTML pages

In **`index.html`**, find the `CONFIG` block near the bottom of the file
and replace `REPLACE_ME_AFTER_DEPLOYING_APPS_SCRIPT` with the URL you
just copied:
```js
const CONFIG = {
  APPS_SCRIPT_URL: "https://script.google.com/macros/s/AKfycb.../exec",
};
```

Do the same in **`reviewer.html`**. Same value, both files.

While you're in `reviewer.html`, also confirm that `CONFIG.PASSWORD`
matches `REVIEWER_PASSWORD` in `Code.gs`. They both default to
`dwell-interviews-2026`. If you change it in one place, change it in
the other.

---

## 4. Push to GitHub and enable Pages

1. Create a new GitHub repo named `dwell-interview-scheduler` (under your
   personal account or the Dwell org). Make it public — GitHub Pages
   needs the repo to be public for the free tier.
2. From the project folder:
   ```bash
   git init
   git add .
   git commit -m "Initial deploy"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/dwell-interview-scheduler.git
   git push -u origin main
   ```
3. On GitHub: **Settings** → **Pages**.
4. **Source**: Deploy from a branch. **Branch**: `main`, folder `/ (root)`.
   Click **Save**.
5. Wait ~30 seconds. Pages will publish at:
   `https://YOUR_USERNAME.github.io/dwell-interview-scheduler/`

Two URLs to share:
- **Reviewers**: `https://YOUR_USERNAME.github.io/dwell-interview-scheduler/reviewer.html`
- **Candidates**: `https://YOUR_USERNAME.github.io/dwell-interview-scheduler/`

---

## 5. Smoke-test before going live

Run through this end-to-end before the URL goes anywhere near a real
candidate:

1. Open `reviewer.html`, enter the password, pick **Test** (any reviewer
   — you'll be the test). Paint 4–5 slots. Save. Confirm the success
   message says "Saved — N slots on the calendar."
2. Open the Sheet → `Availability` tab. Confirm the rows appeared.
3. Open `index.html` (no password, public). Pick the same reviewer.
   Confirm the painted slots show up in your local timezone. (If they
   look wrong, scroll to the bottom — the timezone label should match
   your machine.)
4. Click a slot. Fill in fake name / email / phone. Hit "Confirm booking."
5. You should see the green confirmation panel within ~2 seconds.
6. Check your Gmail: there should be a Calendar invite from yourself
   (the reviewer guest) and a `[Interview booked]` notification.
7. Check Google Calendar: the event should be on your calendar at the
   right time, with both guest emails attached.
8. Refresh the candidate page. The slot you booked should be gone.
9. Open the Sheet → `Bookings` tab. Your booking row should be there.

If any step fails, the **Execution log** in the Apps Script editor
(View → Executions) shows what the backend saw — that's where to
debug.

---

## 6. Roll out to reviewers

Once smoke test passes:

1. Delete the test booking row from the `Bookings` tab in the Sheet
   (and delete the test event from your Google Calendar).
2. Email the six reviewers the **reviewer URL** + the password +
   "please paint times you can do 15-minute calls between Sun May 10
   and Sun May 17."
3. Once at least 2-3 reviewers have posted availability, share the
   **candidate URL** with the candidates.

---

## Operational notes

**If a candidate reports the page is broken.** First place to look:
Apps Script → **Executions** (left sidebar). Each `doGet` and `doPost`
shows up there with timing and any errors. Most issues are auth
(re-run `authorize`) or a typo in `SHEET_ID`.

**If a reviewer needs to remove a slot they painted.** Have them open
`reviewer.html`, pick their name, click the painted slot to un-select
it, hit Save. The POST replaces their full schedule.

**If a candidate needs to cancel.** Open the Sheet → `Bookings` tab,
find their row, change the `status` cell from `confirmed` to
`cancelled`. The slot will reappear as available in the candidate page.
Manually delete the Google Calendar event too (or let it sit if the
candidate already has the invite).

**If you need to change the reviewer password.** Update both
`REVIEWER_PASSWORD` in `Code.gs` AND `CONFIG.PASSWORD` in `reviewer.html`,
then redeploy the Apps Script (Deploy → Manage deployments → ✏️ Edit →
Version: New version → Deploy) and push the HTML change to GitHub.

**If you change anything in `Code.gs`.** You must redeploy a new
version: Deploy → Manage deployments → ✏️ Edit → Version: New version
→ Deploy. The web app URL stays the same.
