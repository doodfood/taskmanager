# Household Task Manager — Plan

## 1. Overview

A household task manager with two deployable parts:

| Part | Tech | Responsibility |
|------|------|----------------|
| `server/` | Node.js + Express + TypeScript | Core API. Stores users, task definitions and task instances. Runs a hydration loop every 60 minutes to materialise recurring tasks. |
| `web/` | Next.js (App Router) + TypeScript + Tailwind | Frontend. User picker, weekly task view, task creation, complete/reassign actions. |

No authentication. The web app asks "who are you?" it doesn't remember the choice as the app will be used by different members in the same household, trust based only.

All persistence is JSON files on disk, hidden behind a storage-provider interface so a real database can be dropped in later without touching business logic.

---

## 2. Requirements

### Functional

1. **Users**
   - Simple user records (name, optional avatar colour).
   - Manageable via API; seeded on first run so the app is usable immediately.
2. **Tasks**
   - Created as **one-off** or **recurring** (daily, weekly, monthly, quarterly).
   - Assigned to a **specific user** or to **anyone** (first person to complete it / visible to all).
   - Due date set as **N days after creation/occurrence date** (e.g. "due 2 days after it appears").
   - Title + optional description.
3. **Hydration**
   - A scheduler runs **every 60 minutes** (and once at boot).
   - It scans active recurring task definitions and materialises any **task instances** that are now due to exist, so the UI always has concrete tasks to show.
   - One-off tasks create their single instance immediately at creation time.
4. **Task instances**
   - Fetch pending tasks (filter by assignee, by date range).
   - "My next 7 days" view — tasks due in the coming week for the selected user, including "anyone" tasks.
   - **Complete** a task (records who completed it and when).
   - **Reassign** a task instance to another user or back to "anyone".
5. **Recurring lifecycle**
   - When an instance of a recurring task is completed, the next occurrence is hydrated by the loop when its time comes (definition stays alive until deactivated).

### Non-functional

- **Modular storage**: all reads/writes go through a `StorageProvider` interface. `JsonFileStorage` is the only implementation for now; a `PostgresStorage`/`MongoStorage` can be added later by implementing the same interface and changing one config line.
- **No auth**: user selection is a UI convenience, not a security boundary.
- **Configurable**: ports, data directory, hydration interval via environment variables with sensible defaults.
- **Time-zone aware**: dates handled in local server time (`Australia/Sydney`); due dates stored as ISO date strings.

---

## 3. Architecture

```
taskmanager/
├── PLAN.md                      ← this file
├── server/                      ← Node.js API
│   ├── package.json
│   ├── tsconfig.json
│   ├── data/                    ← JSON files live here (git-ignored, auto-created)
│   │   ├── users.json
│   │   ├── task-definitions.json
│   │   └── task-instances.json
│   └── src/
│       ├── index.ts             ← entry: starts HTTP + scheduler
│       ├── config.ts            ← env vars (port, data dir, interval)
│       ├── types.ts             ← User, TaskDefinition, TaskInstance, enums
│       ├── storage/
│       │   ├── StorageProvider.ts   ← interface (the DB seam)
│       │   └── JsonFileStorage.ts   ← JSON file implementation
│       ├── services/
│       │   ├── userService.ts
│       │   ├── taskService.ts       ← CRUD for definitions & instances
│       │   └── hydrationService.ts  ← recurrence math + materialisation
│       ├── scheduler.ts         ← setInterval loop (60 min) + run-on-boot
│       └── routes/
│           ├── users.ts
│           └── tasks.ts
└── web/                         ← Next.js frontend
    ├── package.json
    └── src/
        ├── app/
        │   ├── page.tsx             ← dashboard (my week)
        │   ├── layout.tsx
        │   ├── users/page.tsx       ← switch user / manage users
        │   └── tasks/new/page.tsx   ← create task
        ├── components/
        │   ├── UserPicker.tsx
        │   ├── TaskCard.tsx
        │   ├── WeekView.tsx
        │   └── TaskForm.tsx
        ├── context/UserContext.tsx  ← current user (localStorage)
        └── lib/api.ts               ← fetch wrapper for the API
```

### Data model

**User**
```json
{ "id": "uuid", "name": "Akhil", "color": "#f59e0b", "createdAt": "ISO" }
```

**TaskDefinition** (the template — what repeats)
```json
{
  "id": "uuid",
  "title": "Take bins out",
  "description": "Red bin this week",
  "recurrence": "none | daily | weekly | monthly | quarterly",
  "assigneeId": "uuid | null",        // null = anyone
  "dueOffsetDays": 1,                  // due N days after each occurrence appears
  "active": true,
  "lastHydratedDate": "2026-07-20",    // watermark to avoid duplicates
  "createdAt": "ISO"
}
```

**TaskInstance** (the concrete, actionable task)
```json
{
  "id": "uuid",
  "definitionId": "uuid",
  "title": "Take bins out",            // snapshot so edits to the template don't rewrite history
  "description": "Red bin this week",
  "assigneeId": "uuid | null",
  "occurrenceDate": "2026-07-21",      // the day this occurrence is for
  "dueDate": "2026-07-22",
  "status": "pending | completed",
  "completedBy": "uuid | null",
  "completedAt": "ISO | null",
  "createdAt": "ISO"
}
```

### Hydration algorithm

Every 60 minutes (and at boot):

1. Load all `active` definitions.
2. For each recurring definition, walk occurrence dates from `lastHydratedDate + 1 interval` (or `createdAt` date if never hydrated) up to **today + 1 day** (small lookahead so tomorrow's tasks are visible).
3. For each occurrence date, if no instance already exists for `(definitionId, occurrenceDate)`, create one with `dueDate = occurrenceDate + dueOffsetDays`.
4. Update `lastHydratedDate`. Uniqueness guard on `(definitionId, occurrenceDate)` makes the loop idempotent — safe to run at any frequency.

Recurrence stepping: daily = +1 day, weekly = +7 days, monthly = +1 calendar month, quarterly = +3 calendar months.

### API surface

Base URL `http://localhost:4000/api`, CORS open.

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/users` | List users |
| POST | `/users` | Create user `{ name, color? }` |
| DELETE | `/users/:id` | Remove user |
| GET | `/task-definitions` | List task templates |
| POST | `/task-definitions` | Create task (one-off hydrates immediately) |
| PATCH | `/task-definitions/:id` | Edit / deactivate |
| DELETE | `/task-definitions/:id` | Delete template (+ future pending instances) |
| GET | `/task-instances?assigneeId=&status=&from=&to=&includeAnyone=` | List instances, filtered |
| GET | `/task-instances/upcoming?userId=&days=7` | "My week": pending instances due within N days, assigned to me or anyone |
| POST | `/task-instances/:id/complete` | `{ completedBy }` → status completed |
| POST | `/task-instances/:id/reassign` | `{ assigneeId }` (null = anyone) |
| POST | `/task-instances/:id/reopen` | Back to pending |
| GET | `/health` | Liveness |

### Frontend behaviour

- **`/` dashboard**: header with current user + switch button. "Next 7 days" list grouped by due date (Today / Tomorrow / Wed 23 Jul …), showing tasks assigned to me + anyone-tasks. Each card: title, due date, assignee badge, Complete button, reassign dropdown.
- **`/tasks/new`**: form — title, description, recurrence select, assignee select (specific user or "Anyone"), due offset (number of days). One-off tasks appear immediately.
- **`/users`**: user picker tiles + add/remove users.
- Overdue tasks highlighted in red; due-today in amber.

---

## 4. Build plan

Keep the files small and modular where possible.

| # | Step | Output |
|---|------|--------|
| 1 | Scaffold `server/` — package.json, tsconfig, Express boot, `/health` | Server runs, health check 200 |
| 2 | Storage layer — `StorageProvider` interface + `JsonFileStorage` | CRUD against JSON files with atomic writes |
| 3 | Types + services + hydration engine with recurrence math | Unit-testable hydration, idempotent |
| 4 | REST routes for users, definitions, instances | Full API per table above |
| 5 | Scheduler — 60-min `setInterval` + run-at-boot | Recurring tasks materialise automatically |
| 6 | Seed data — default household users on first run | Usable out of the box |
| 7 | Scaffold `web/` — Next.js + Tailwind, API client | App renders, talks to API |
| 8 | User picker + `UserContext` (localStorage) | Identity persists across reloads |
| 9 | Dashboard week view (grouped by due date, overdue styling) | See my upcoming week |
| 10 | Task creation form (one-off + recurring, anyone/specific) | Can create everything |
| 11 | Complete + reassign actions | Full task lifecycle in UI |
| 12 | End-to-end smoke test both apps + README with run instructions | Done |

## 5. Decisions & conventions

- **IDs**: `crypto.randomUUID()`.
- **Dates**: `yyyy-MM-dd` strings for occurrence/due dates; full ISO timestamps for createdAt/completedAt. Date math via `date-fns` (server) to keep month/quarter arithmetic correct.
- **Writes**: JSON files written atomically (write temp file → rename) to avoid corruption.
- **Concurrency**: a simple in-process write queue in `JsonFileStorage` serialises mutations — fine for household scale.
- **DB migration path**: implement `StorageProvider` (methods like `listUsers`, `insertDefinition`, `findInstances`) against your DB of choice; swap one line in `config.ts`/composition root.
- **Ports**: API `4000`, web `3000`. `NEXT_PUBLIC_API_URL` points the web app at the API.
