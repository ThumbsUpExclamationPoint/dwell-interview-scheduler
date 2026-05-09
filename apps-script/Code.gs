/**
 * Dwell Interview Scheduler — backend
 *
 * Apps Script web app that powers two static pages on GitHub Pages:
 *   - reviewer.html — reviewers paint their availability on a calendar grid
 *   - index.html    — candidates pick a reviewer + book an open slot
 *
 * State lives in a Google Sheet (acts as a tiny "database"). Calendar
 * invites are sent via CalendarApp.createEvent. Runs as Matt's Google
 * account, so it inherits Matt's Sheet, Calendar, and Mail permissions.
 *
 * Deploy:
 *   1. Open https://script.google.com → New project → paste this file as Code.gs
 *   2. Fill in SHEET_ID below (the file ID of the backing Google Sheet).
 *   3. Function dropdown → "authorize" → ▶ Run → approve permissions.
 *   4. Function dropdown → "seedReviewers" → ▶ Run → check Reviewers tab.
 *   5. Deploy → New deployment → Web app
 *      Execute as: Me (matt@dwellpeninsula.com)
 *      Who has access: Anyone
 *   6. Copy the /macros/s/.../exec URL into:
 *        index.html    → CONFIG.APPS_SCRIPT_URL
 *        reviewer.html → CONFIG.APPS_SCRIPT_URL
 */

// =====================================================================
// Configuration
// =====================================================================

// File ID of the backing Google Sheet. Get it from the URL of the sheet,
// the long opaque string between /d/ and /edit. The sheet must have three
// tabs (DEPLOY.md walks through creating them):
//   Reviewers    — id, name, email
//   Availability — reviewer_id, start_iso, end_iso, created_at
//   Bookings     — id, reviewer_id, start_iso, end_iso, candidate_name,
//                  candidate_email, candidate_phone, status,
//                  calendar_event_id, created_at
const SHEET_ID = "137jDsdG0bK9ynqFq2v-p-KdRGrTXt4nDMXTa_wCu4k8";

// Static reviewer roster — slug → {name, email}. Six people for the life
// of Phase 1. If it changes, update this AND the REVIEWERS array in both
// index.html and reviewer.html (kept in sync by hand on purpose; we want
// reviewers visible at page-load even if the backend is slow to respond).
const REVIEWERS = {
  "matt-stephan":     { name: "Matt Stephan",     email: "matt@dwellpeninsula.com" },
  "karina-wilhelms":  { name: "Karina Wilhelms",  email: "kgorbunoff@yahoo.com" },
  "eunice-nichols":   { name: "Eunice Nichols",   email: "eunice.nichols@gmail.com" },
  "brian-wo":         { name: "Brian Wo",         email: "brian@dwellpeninsula.com" },
  "lisa-mario":       { name: "Lisa Mario",       email: "lisa@dwellpeninsula.com" },
  "annie-kuo":        { name: "Annie Kuo",        email: "anniekuo@gmail.com" },
};

// Soft password for the reviewer page. Anyone with this URL + password
// can submit availability on behalf of any reviewer (they pick their own
// name from a dropdown). Not real security — change it in one place if
// it leaks. Candidate page is fully public, no password.
const REVIEWER_PASSWORD = "dwell-interviews-2026";

// Slot length in minutes. 20 = 15-min phone call + 5-min breather.
// Reviewers paint the grid at this granularity.
const SLOT_MINUTES = 20;

// Where booking notifications go. Matt's inbox is the default — Jenny
// (the AI agent) can scan for the "[Interview booked]" subject prefix
// or read the Bookings tab directly. Set to "" to disable email
// notifications (sheet writes still happen).
const NOTIFY_EMAIL = "matt@dwellpeninsula.com";

// =====================================================================
// HTTP handlers
// =====================================================================

/**
 * GET routes — used by both pages on initial load.
 *   ?action=ping                       → health check
 *   ?action=reviewers                  → list of {id, name}
 *   ?action=availability&reviewer=ID   → list of {start, end} open slots
 */
function doGet(e) {
  try {
    const p = (e && e.parameter) || {};
    if (p.action === "ping")          return jsonResponse({ ok: true, msg: "scheduler alive" });
    if (p.action === "reviewers")     return jsonResponse({ ok: true, reviewers: listReviewers() });
    if (p.action === "availability")  return jsonResponse({ ok: true, slots: getAvailableSlots(p.reviewer, { includeBooked: p.include_booked === "true" }) });
    return textResponse("Dwell Interview Scheduler — alive.\nTry ?action=reviewers");
  } catch (err) {
    console.error(err);
    return jsonResponse({ ok: false, error: String(err && err.message || err) });
  }
}

/**
 * POST routes:
 *   action=postAvailability  → reviewer submits a fresh availability set
 *   action=book              → candidate claims a slot (creates Calendar event)
 *
 * The static pages POST as multipart/form-data with mode "no-cors" so
 * they don't need CORS headers (Apps Script doesn't return them). The
 * tradeoff: the page can't read the response body, so it shows a generic
 * "submitted" message and re-fetches state to confirm. That's good enough
 * for this scale.
 */
function doPost(e) {
  try {
    const p = (e && e.parameter) || {};
    if (p.action === "postAvailability")  return jsonResponse(handlePostAvailability(p));
    if (p.action === "book")              return jsonResponse(handleBook(p));
    return jsonResponse({ ok: false, error: "unknown action: " + (p.action || "(none)") });
  } catch (err) {
    console.error(err);
    return jsonResponse({ ok: false, error: String(err && err.message || err) });
  }
}

// =====================================================================
// Public read API
// =====================================================================

function listReviewers() {
  return Object.keys(REVIEWERS).map(id => ({ id: id, name: REVIEWERS[id].name }));
}

/**
 * Slots for a given reviewer.
 *   Default (used by candidate page): only OPEN, future slots.
 *   With opts.includeBooked (used by reviewer page when re-editing):
 *     all future painted slots, with a `booked: true/false` flag so the
 *     reviewer page can show booked slots in a different color.
 */
function getAvailableSlots(reviewerId, opts) {
  if (!reviewerId || !REVIEWERS[reviewerId]) return [];
  opts = opts || {};

  const ss = SpreadsheetApp.openById(SHEET_ID);

  const availSheet = ss.getSheetByName("Availability");
  const availData = availSheet.getDataRange().getValues();
  availData.shift(); // drop header
  const slots = availData
    .filter(r => r[0] === reviewerId && r[1] && r[2])
    .map(r => ({ start: toIso(r[1]), end: toIso(r[2]) }));

  const bookSheet = ss.getSheetByName("Bookings");
  const bookData = bookSheet.getDataRange().getValues();
  bookData.shift(); // drop header
  const bookedStarts = new Set(
    bookData
      .filter(r => r[1] === reviewerId && r[7] !== "cancelled" && r[2])
      .map(r => toIso(r[2]))
  );

  const nowMs = Date.now();
  return slots
    .filter(s => new Date(s.start).getTime() >= nowMs)
    .map(s => ({ start: s.start, end: s.end, booked: bookedStarts.has(s.start) }))
    .filter(s => opts.includeBooked || !s.booked)
    // Stable order: chronological
    .sort((a, b) => new Date(a.start) - new Date(b.start));
}

// =====================================================================
// Reviewer write: post availability
// =====================================================================

/**
 * Replace this reviewer's availability with the freshly-painted grid.
 * "Replace" (not "append") matches the mental model — reviewers paint
 * the whole week at once, not slot-by-slot.
 *
 * Body fields (form-encoded):
 *   action      : "postAvailability"
 *   password    : must match REVIEWER_PASSWORD
 *   reviewer_id : slug from REVIEWERS
 *   slots       : JSON-stringified array of { start, end } (ISO strings)
 */
function handlePostAvailability(p) {
  if (p.password !== REVIEWER_PASSWORD)        return { ok: false, error: "bad password" };
  const reviewerId = p.reviewer_id;
  if (!reviewerId || !REVIEWERS[reviewerId])   return { ok: false, error: "unknown reviewer" };

  let slots;
  try { slots = JSON.parse(p.slots || "[]"); }
  catch (err) { return { ok: false, error: "bad slots JSON" }; }
  if (!Array.isArray(slots))                   return { ok: false, error: "slots must be an array" };

  // Lock so two reviewers (or two tabs) submitting at once can't
  // interleave deletions with appends.
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000))                    return { ok: false, error: "server busy, retry" };

  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sheet = ss.getSheetByName("Availability");
    const data = sheet.getDataRange().getValues();

    // Walk bottom-up so deleting a row doesn't shift the indices we
    // haven't visited yet.
    for (let i = data.length - 1; i >= 1; i--) {
      if (data[i][0] === reviewerId) sheet.deleteRow(i + 1);
    }

    if (slots.length > 0) {
      const now = new Date();
      const rows = slots.map(s => [reviewerId, s.start, s.end, now]);
      sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 4).setValues(rows);
    }

    return { ok: true, slots_saved: slots.length };
  } finally {
    lock.releaseLock();
  }
}

// =====================================================================
// Candidate write: book a slot
// =====================================================================

/**
 * Atomically claim a slot:
 *   1. Lock
 *   2. Re-check that the slot is still open (guards against the race
 *      where two browsers GET the same slot, then both POST)
 *   3. Create the Calendar event with both reviewer + candidate as guests
 *   4. Append the booking row
 *   5. Notify Matt's inbox
 *   6. Unlock
 *
 * Body fields (form-encoded):
 *   action            : "book"
 *   reviewer_id       : slug from REVIEWERS
 *   slot_start        : ISO string (must match a posted availability slot)
 *   slot_end          : ISO string (matches slot_start + SLOT_MINUTES)
 *   candidate_name    : full name
 *   candidate_email   : email (Calendar invite is sent here)
 *   candidate_phone   : phone (reviewer dials this)
 */
function handleBook(p) {
  const reviewerId = p.reviewer_id;
  const start  = p.slot_start;
  const end    = p.slot_end;
  const cName  = (p.candidate_name  || "").trim();
  const cEmail = (p.candidate_email || "").trim();
  const cPhone = (p.candidate_phone || "").trim();

  if (!reviewerId || !REVIEWERS[reviewerId])  return { ok: false, error: "unknown reviewer" };
  if (!start || !end)                         return { ok: false, error: "missing slot times" };
  if (!cName || !cEmail || !cPhone)           return { ok: false, error: "name, email, and phone are all required" };
  if (!isValidEmail(cEmail))                  return { ok: false, error: "that email looks invalid" };

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000))                   return { ok: false, error: "server busy, retry" };

  try {
    // Re-validate inside the lock — between the candidate's GET and POST,
    // someone else may have grabbed the slot. Better to fail clean here
    // than to double-book.
    const stillOpen = getAvailableSlots(reviewerId).some(s => s.start === start);
    if (!stillOpen) return { ok: false, error: "that slot just got booked — please pick another" };

    const reviewer = REVIEWERS[reviewerId];
    const startDt  = new Date(start);
    const endDt    = new Date(end);

    // Create the Calendar event. {sendInvites: true} fires off invites
    // to both guests immediately, so neither party has to wait for Matt
    // or Jenny to do anything by hand.
    const event = CalendarApp.getDefaultCalendar().createEvent(
      "Dwell interview — " + cName + " × " + reviewer.name,
      startDt,
      endDt,
      {
        description:
          "Phone interview for Dwell Church.\n\n" +
          "Reviewer: " + reviewer.name + " (" + reviewer.email + ")\n" +
          "Candidate: " + cName + " (" + cEmail + ")\n" +
          "Candidate phone: " + cPhone + "\n\n" +
          "The reviewer initiates the call at the scheduled time.\n" +
          "Booked via the Dwell interview scheduler.",
        guests: reviewer.email + "," + cEmail,
        sendInvites: true,
      }
    );

    // Append the booking row. Sheet schema:
    //   id, reviewer_id, start_iso, end_iso, candidate_name,
    //   candidate_email, candidate_phone, status, calendar_event_id, created_at
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const bSheet = ss.getSheetByName("Bookings");
    const bookingId = Utilities.getUuid();
    bSheet.appendRow([
      bookingId,
      reviewerId,
      start,
      end,
      cName,
      cEmail,
      cPhone,
      "confirmed",
      event.getId(),
      new Date(),
    ]);

    // Notify Matt's inbox. Failure here shouldn't fail the booking —
    // the calendar invite already went out, the sheet row is written.
    if (NOTIFY_EMAIL) {
      try {
        MailApp.sendEmail({
          to: NOTIFY_EMAIL,
          subject: "[Interview booked] " + cName + " × " + reviewer.name,
          body:
            "A new interview was just booked.\n\n" +
            "Reviewer: " + reviewer.name + " (" + reviewer.email + ")\n" +
            "Candidate: " + cName + "\n" +
            "Email: " + cEmail + "\n" +
            "Phone: " + cPhone + "\n\n" +
            "Time: " + formatPT(startDt) + " — " + formatPT(endDt) + "\n\n" +
            "Booking ID: " + bookingId + "\n" +
            "Calendar event: " + event.getId() + "\n\n" +
            "Both parties have been auto-invited via Calendar.",
        });
      } catch (mailErr) {
        console.warn("notification email failed: " + mailErr);
      }
    }

    return { ok: true, booking_id: bookingId, calendar_event_id: event.getId() };
  } finally {
    lock.releaseLock();
  }
}

// =====================================================================
// Helpers
// =====================================================================

/**
 * Sheets stores Date cells as native Date objects, but ISO strings if a
 * value was written as a string. Normalize either to an ISO string so
 * comparisons are stable.
 */
function toIso(v) {
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function formatPT(d) {
  return Utilities.formatDate(d, "America/Los_Angeles", "EEE MMM d, h:mm a 'PT'");
}

function isValidEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function textResponse(msg) {
  return ContentService.createTextOutput(msg).setMimeType(ContentService.MimeType.TEXT);
}

// =====================================================================
// One-time setup helpers (run from the Apps Script editor)
// =====================================================================

/**
 * Run this once after pasting in the code (▶ Run with "authorize"
 * selected in the function dropdown). It touches every Google API the
 * web app uses — Sheets, Calendar, Mail — so Apps Script's permission
 * scanner asks for all the needed scopes in a single auth dialog.
 *
 * Without this step you'd get partial-permission errors at first request.
 */
function authorize() {
  if (SHEET_ID === "REPLACE_ME_AFTER_CREATING_SHEET") {
    throw new Error("Fill in SHEET_ID first (top of this file), then re-run authorize.");
  }
  SpreadsheetApp.openById(SHEET_ID);  // Sheets scope
  CalendarApp.getDefaultCalendar();    // Calendar scope
  MailApp.getRemainingDailyQuota();    // Mail scope
  console.log("Authorization complete. Now redeploy as a new version: Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy.");
}

/**
 * Run this once to populate the Reviewers tab with the static REVIEWERS
 * map above. Idempotent — running again clears the tab and rewrites it,
 * which is what you want if you've changed names or emails.
 */
function seedReviewers() {
  if (SHEET_ID === "REPLACE_ME_AFTER_CREATING_SHEET") {
    throw new Error("Fill in SHEET_ID first.");
  }
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName("Reviewers") || ss.insertSheet("Reviewers");
  sheet.clear();
  sheet.appendRow(["id", "name", "email"]);
  Object.keys(REVIEWERS).forEach(id => {
    sheet.appendRow([id, REVIEWERS[id].name, REVIEWERS[id].email]);
  });
  console.log("Seeded " + Object.keys(REVIEWERS).length + " reviewers.");
}

/**
 * Convenience for end-to-end verification: prints what's currently
 * available for each reviewer to the Apps Script log. Run after a
 * reviewer has posted availability and (optionally) a booking has been
 * made — confirms the booked slot disappears from the available list.
 */
function debugDumpAvailability() {
  Object.keys(REVIEWERS).forEach(id => {
    const slots = getAvailableSlots(id);
    console.log(REVIEWERS[id].name + " (" + id + "): " + slots.length + " open slots");
    slots.slice(0, 5).forEach(s => console.log("  " + s.start + " → " + s.end));
  });
}
