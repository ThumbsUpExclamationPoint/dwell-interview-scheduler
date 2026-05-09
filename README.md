# Dwell Interview Scheduler

A static GitHub Pages site that lets the search team's reviewers post
their availability and lets candidates self-book a 15-minute phone
interview. Backed by a Google Apps Script web app and a Google Sheet —
zero servers, zero hosting cost.

## Architecture

```
            ┌──────────────────────┐         ┌──────────────────────┐
            │  Reviewer browser     │         │  Candidate browser    │
            │  (reviewer.html)      │         │  (index.html)         │
            └──────────┬────────────┘         └──────────┬────────────┘
                       │ paint availability               │ pick reviewer
                       │ POST                             │ pick slot
                       │                                  │ POST
                       ▼                                  ▼
            ┌────────────────────────────────────────────────────────┐
            │          Google Apps Script web app (Code.gs)           │
            │              runs as matt@dwellpeninsula.com            │
            └──────────────────────┬─────────────────────────────────┘
                                   │
                       ┌───────────┼───────────────┐
                       ▼           ▼               ▼
                ┌────────────┐ ┌────────────┐ ┌────────────┐
                │ Google     │ │ Google     │ │ Matt's     │
                │ Sheet      │ │ Calendar   │ │ inbox      │
                │ (state)    │ │ (invites)  │ │ (alerts)   │
                └────────────┘ └────────────┘ └────────────┘
```

## Repo layout

```
dwell-interview-scheduler/
├── index.html                  # candidate booking page (public, no gate)
├── reviewer.html               # reviewer availability page (password gated)
├── assets/
│   └── dwell-icon.png          # Dwell brand icon, lifted from Next Gen Hub
├── apps-script/
│   └── Code.gs                 # backend: read availability, book slots, send invites
├── DEPLOY.md                   # one-time setup steps for Matt (~10 min)
└── README.md                   # this file
```

## How it works

**Reviewer flow (`reviewer.html`)**

1. Reviewer enters the shared password.
2. Picks their name from a dropdown.
3. Sees a 14-day grid of 20-minute slots from 8am–8pm PT, with any
   previously-saved times pre-selected.
4. Clicks (or click-and-drags) to paint when they're free.
5. Hits "Save" — the page POSTs the painted slots to Apps Script,
   which replaces their availability rows in the Sheet.

**Candidate flow (`index.html`)**

1. Candidate lands on the public page — no password.
2. Picks one of the six reviewers.
3. Sees only that reviewer's open future slots, in the candidate's local
   timezone (storage stays in PT).
4. Clicks a slot, fills in name + email + phone, hits "Confirm booking".
5. Apps Script atomically claims the slot, creates a Google Calendar
   event, and sends invites to both the reviewer and the candidate.
   The candidate sees a confirmation panel.

## Phase 2 (later)

When we move to group Google Meet interviews, the changes are bounded:
- `Code.gs` swaps `CalendarApp.createEvent` for one that adds Meet
  conference data and supports multiple reviewer guests on a single slot.
- A new "panel" data type joins multiple reviewers into one bookable
  block (could be a tab on the same Sheet).
- The candidate page gets a "panel of N" picker.

The static-page + Apps Script + Sheet architecture handles it cleanly —
nothing about Phase 1 paints us into a corner.

## Privacy

- `<meta name="robots" content="noindex, nofollow">` on both pages keeps
  this off Google.
- The reviewer page sits behind a soft password gate (sessionStorage
  unlock, same pattern as the Next Gen Hub).
- Candidates never see other candidates' names — booked slots simply
  disappear from the candidate-facing list.
- The Sheet is private to Matt. Reviewers don't see it; only Matt and
  Jenny do.

## Where state lives

| What | Where |
|------|-------|
| Reviewer roster (id, name, email) | `REVIEWERS` map in `Code.gs` (mirrored on both HTML pages for instant render) |
| Reviewer availability | `Availability` tab in the Google Sheet |
| Bookings + calendar event IDs | `Bookings` tab in the Google Sheet |
| Calendar events | Matt's primary Google Calendar |
| Booking notifications | Matt's Gmail inbox (filterable by `[Interview booked]` subject prefix) |

## See also

- [DEPLOY.md](DEPLOY.md) — step-by-step setup, ~10 minutes total.
