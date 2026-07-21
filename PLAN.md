# Household Task Manager — Plan

> **Status: backend ✅ complete & tested · frontend ✅ built & verified live**
> Next up: steps 13–14 (§7) — a definitions manager (view/edit recurring
> templates) and a start date for tasks. Everything the frontend needed is
> documented in §3 (as-built API contract) and §4 (frontend spec).

## 1. Overview

A household task manager with two deployable parts:

| Part | Tech | Status |
|------|------|--------|
| `server/` | Node.js + Express + TypeScript | ✅ Built, 31/31 tests passing, lint clean, smoke-tested live |
| `web/` | Next.js 16 (App Router) + TypeScript + Tailwind v4 | ✅ Built, lint clean, verified live with the API |

No authentication. The web app asks "who are you?" once and remembers the choice
in `localStorage`. Trust-based, household-only.

All persistence is JSON files on disk (`server/data/`), hidden behind a
storage-provider interface so a real database can be dropped in later without
touching business logic.

---

## 2. What's built (backend)

Run with `npm run dev` in `server/` → http://localhost:4000. See `server/README.md`
for full docs. First run seeds users `Alex, Jordan, Sam` (override with `SEED_USERS` env var).

- Express API with users / task-definitions / task-instances routers and a
  consistent `{ "error": "..." }` shape with 400/404/409 statuses.
- `StorageProvider` interface = the DB seam; `JsonFileStorage` implements it
  (atomic writes, in-memory cache, write queue). Swap-in point is one line in
  `server/src/index.ts`.
- Hydration engine: **TaskDefinition** (recurring template) → **TaskInstance**
  (concrete occurrence). Idempotent via `(definitionId, occurrenceDate)`
  uniqueness. One-off tasks hydrate their single instance at creation time.
- Scheduler: hydration runs at boot + every 60 min (`HYDRATION_INTERVAL_MS`).
  Horizon: today + 1 day (`HYDRATION_HORIZON_DAYS`).
- **Spoofable clock** for scenario testing (all time reads go through
  `server/src/clock.ts`): boot-time via `SPOOF_DATE=2026-08-01`, or runtime via API:
  - `GET /api/debug/clock` → `{ spoofed, spoofedDate, now, today }`
  - `POST /api/debug/clock { "date": "2026-07-28" }` → sets clock **and re-runs
    hydration immediately** (recurring tasks materialise as if time jumped);
    response adds `hydrated: <count>`. `{"date": null}` or `DELETE` resets to real time.
  - Date-only strings are anchored to local noon server-side (no TZ off-by-one).
- Tooling: Vitest + supertest (`npm test`, 31 tests), ESLint 9 flat config
  (`npm run lint`), `npm run typecheck`.

## 3. As-built API contract (for the frontend)

Base URL `http://localhost:4000/api`, CORS open. Dates: `yyyy-MM-dd` strings for
occurrence/due dates; full UTC ISO timestamps for `createdAt`/`completedAt`
(**render these in local time** client-side).

### Types

```ts
type Recurrence = 'none' | 'daily' | 'weekly' | 'monthly' | 'quarterly';

interface User { id: string; name: string; color: string; createdAt: string }

interface TaskDefinition {
  id: string; title: string; description: string;
  recurrence: Recurrence;
  assigneeId: string | null;      // null = "anyone"
  dueOffsetDays: number;          // due N days after each occurrence
  active: boolean;
  lastHydratedDate: string | null;
  createdAt: string;
}

interface TaskInstance {
  id: string; definitionId: string;
  title: string; description: string;       // snapshot of the definition at hydration time
  assigneeId: string | null;                // null = anyone
  occurrenceDate: string;                   // yyyy-MM-dd
  dueDate: string;                          // yyyy-MM-dd = occurrence + offset
  status: 'pending' | 'completed';
  completedBy: string | null; completedAt: string | null;
  createdAt: string;
}
```

### Endpoints

| Method | Path | Body / query | Notes |
|--------|------|--------------|-------|
| GET | `/health` | — | `{ ok, uptime }` |
| GET | `/users` | — | List users |
| POST | `/users` | `{ name, color? }` | Colour auto-assigned from a palette if omitted |
| DELETE | `/users/:id` | — | 204 |
| GET | `/task-definitions` | — | List templates |
| POST | `/task-definitions` | `{ title, description?, recurrence?, assigneeId?, dueOffsetDays? }` | Defaults: `recurrence=none`, `assigneeId=null` (anyone), `dueOffsetDays=0`. One-offs hydrate instantly; recurring hydrates first occurrence(s) immediately |
| PATCH | `/task-definitions/:id` | partial fields + `active?` | Edit / deactivate |
| DELETE | `/task-definitions/:id` | — | Deletes template + its **pending** instances; completed stay as history |
| GET | `/task-instances` | `status=`, `assigneeId=` (`null` string = anyone), `from=`, `to=` (dueDate range), `includeAnyone=true` | Sorted by dueDate then title |
| GET | `/task-instances/upcoming` | `userId` (required), `days` (1–90, default 7) | **The dashboard endpoint**: pending tasks assigned to user OR anyone, `dueDate <= today + days`, **overdue included** |
| POST | `/task-instances/:id/complete` | `{ completedBy: userId }` | 409 if already completed |
| POST | `/task-instances/:id/reopen` | — | Back to pending |
| POST | `/task-instances/:id/reassign` | `{ assigneeId: userId \| null }` | null = anyone |
| GET/POST/DELETE | `/debug/clock` | see §2 | Date spoofing for scenario testing |

Gotchas for the UI:
- `upcoming` includes **overdue** pending tasks (dueDate < today) — style them.
- Completing an "anyone" task records `completedBy` — show who did it.
- Editing a definition does **not** rewrite already-hydrated instances
  (title/description/assignee are snapshots). Intended behaviour.
- Deleting a user does **not** cascade their `assigneeId` — instances can point
  at a non-existent user. Handle unknown user ids gracefully (see §6 backlog).

## 4. Frontend spec (steps 7–12)

Scaffold `web/` with create-next-app (App Router, TS, Tailwind, ESLint).
Point it at the API with `NEXT_PUBLIC_API_URL=http://localhost:4000/api` in
`web/.env.local`. Wrap all fetches in `src/lib/api.ts` (typed, throws on
`{ error }` responses). All pages are client components talking to the API
directly — no SSR/data-fetching-on-server needed (keeps date spoofing simple).

### Pages & components

- **`/` dashboard** — header: current user chip + "switch" link, "New task"
  button, spoofed-date banner when clock is spoofed. Body: next-7-days list
  from `GET /task-instances/upcoming?userId=<me>&days=7`, grouped by dueDate
  (labels: Overdue / Today / Tomorrow / weekday+date). Each `TaskCard`: title,
  description, due date, assignee badge (user name+colour, or "Anyone"),
  Complete button, reassign `<select>` (users + "Anyone"), reopen for completed.
- **`/tasks/new`** — `TaskForm`: title, description, recurrence select
  (one-off/daily/weekly/monthly/quarterly), assignee select (users + "Anyone"),
  due offset (number input "due N days after"), submit → POST
  `/task-definitions` → redirect to dashboard.
- **`/users`** — `UserPicker` tiles (colour avatar + name); pick → save to
  localStorage → redirect to `/`. Also add/remove users here.
- **`src/context/UserContext.tsx`** — holds current user; on first visit (no
  stored user) redirect to `/users` picker. Validate stored id still exists
  against `GET /users` (it may have been deleted).
- **`src/components/ClockSpoofer.tsx`** (dev tool) — read `GET /debug/clock`;
  date input + "jump" / "reset" buttons hitting the POST/DELETE endpoints;
  refresh dashboard data afterwards. This is how scenarios get tested.
- Completed state: strike-through + "done by X at HH:mm" (local time).

### Frontend build steps

| # | Step | Done when |
|---|------|-----------|
| 7 ✅ | Scaffold `web/` (create-next-app) + `lib/api.ts` + `.env.local` | App renders, health check to API works |
| 8 ✅ | `UserContext` + `/users` picker with localStorage | Identity persists across reloads; first visit forces picker |
| 9 ✅ | Dashboard week view (grouped, overdue styling) | Sees own + anyone tasks for next 7 days |
| 10 ✅ | `/tasks/new` form | Can create one-off + recurring, specific/anyone, offset |
| 11 ✅ | Complete / reopen / reassign on `TaskCard` | Full lifecycle in UI |
| 12 ✅ | `ClockSpoofer` + E2E smoke: seed data → spoof forward a week → verify recurrence & overdue rendering | Both apps verified together; root README written |
| 13 ⬜ | Definitions manager: view/edit/deactivate/delete templates | See §7.1 |
| 14 ⬜ | Start date on definitions (backend + form field) | See §7.2 |

## 5. Decisions & conventions (as built)

- IDs: `crypto.randomUUID()`. Date math: `date-fns` on the server; dates stored
  as `yyyy-MM-dd` strings (compare lexicographically), timestamps as UTC ISO.
- Server is ESM (`"type": "module"`), NodeNext resolution, relative imports use
  `.js` extensions. Tests: Vitest, temp-dir JSON storage per test, spoofed clock
  reset in `afterEach`.
- The machine ran **Node v18.13** when the backend was built (eslint 9 warned
  but ran). Upgraded to **Node 24** before scaffolding the web app — Next.js 16
  requires a modern Node, so this was a hard prerequisite.

## 6. Future backlog (noticed during backend build — not yet scheduled)

- **Auth**: currently trust-based user picker; no sessions/permissions at all.
- **DB provider**: implement `StorageProvider` for Postgres/SQLite when JSON
  files outgrow household scale (composition root: `server/src/index.ts`).
- **User deletion cascade**: reassign or null-out `assigneeId`/`completedBy`
  when a user is deleted (API currently leaves orphans).
- **Instance editing**: no PATCH on single occurrences (e.g. rename just this
  one, move a due date). Definition edits only affect future hydrations.
- **More recurrences**: fortnightly, yearly, "every N days", specific weekday
  rules (e.g. "bins every Tuesday").
- **History/stats view**: completed instances per user, streaks for recurring
  tasks, "who did what this month".
- **Notifications**: overdue nudges (email/push/Telegram), daily digest of
  today's tasks.
- **PWA**: installable on phones, offline tolerance, quick-complete from home screen.
- **Shared types package**: avoid drift between `server/src/types.ts` and
  `web/src/lib/types.ts` (currently mirrored by hand). ~~Root tooling~~ done:
  root `package.json` with `concurrently` boots server+web together.
- **Rate of hydration**: scheduler is interval-based; could become cron-based
  (e.g. node-cron at 00:05) once exact semantics matter.

---

## 7. Next steps (planned)

### 13. Definitions manager — `/tasks` page (frontend only)

**Problem:** once a recurring template exists ("water plants weekly") there is
no UI to view or edit it — the dashboard only shows hydrated instances, and
editing a definition's properties (title, recurrence, assignee, offset) means
hand-crafting API calls.

The API is already complete for this (`GET/PATCH/DELETE /task-definitions`), so
it's purely frontend work:

- New page `web/src/app/tasks/page.tsx`: table of **all** definitions —
  title, recurrence, assignee (badge), due offset, active state,
  `lastHydratedDate`. Dashboard header gains a "Manage tasks" link.
- Row actions: **edit** (inline expandable form reusing the `TaskForm` fields →
  `PATCH /task-definitions/:id`), **deactivate/reactivate** (`active` toggle),
  **delete** (confirm; pending instances are removed, completed stay as history).
- Extract the form fields from `/tasks/new` into a shared `TaskForm` component
  used by both create and edit.
- Surface the snapshot caveat in the UI: edits apply to **future hydrations
  only** — already-hydrated instances keep their snapshotted
  title/description/assignee (§3 gotchas).

### 14. Start date on definitions (backend + frontend)

**Problem:** occurrences are always anchored on the creation date. "Recurs
every 3 months, first instance 1 month from now" is currently impossible —
recurring tasks anchor on `createdAt` and one-offs hydrate for `today`.

Backend:
- `TaskDefinition` gains `startDate: string | null` (yyyy-MM-dd; null/absent =
  anchor on creation date — back-compatible with existing JSON files).
- `POST /task-definitions` accepts optional `startDate`; validate `yyyy-MM-dd`.
- `hydrateDefinition` (`server/src/services/hydrationService.ts`) anchors the
  cursor on `startDate ?? localDate(createdAt)` instead of always
  `localDate(createdAt)`. A future startDate naturally hydrates nothing until
  the horizon catches up — no special-casing needed.
- One-off tasks (`server/src/services/taskService.ts`): the single instance is
  created with `occurrenceDate = startDate ?? today` instead of always today.
- `PATCH` accepts `startDate` too. Document the caveat: after hydration has
  begun, the `lastHydratedDate` watermark drives the series, so changing
  `startDate` does not move already-hydrated instances (same snapshot
  semantics as other edits).
- Tests: one-off with a future date; weekly anchored to startDate; quarterly
  starting next month; spoofed clock crossing the startDate; back-compat with
  definitions lacking the field.

Frontend:
- `TaskForm` gains a "First occurrence on" date input (defaults to today).
- Definitions manager (step 13) displays the start date.
