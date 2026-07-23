# Task Manager — Core API

Node.js + Express + TypeScript backend for the household task manager. JSON-file persistence behind a storage-provider interface, recurring-task hydration loop every 60 minutes, and a spoofable clock for scenario testing.

## Quick start

```bash
npm install
npm run dev        # tsx watch, http://localhost:4000
```

First run creates `data/` and seeds the household users (override with `SEED_USERS=Name1,Name2`). Delete `server/data/` at any time to reset everything, then run `npm run seed` (with the API up) to re-insert the users and the cleaning-rota task definitions — see `scripts/seed.ts`.

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Dev server with watch mode |
| `npm run build` / `npm start` | Compile to `dist/` and run |
| `npm test` | Vitest suite (39 tests: storage, hydration, services, API) |
| `npm run lint` | ESLint (flat config, typescript-eslint) |
| `npm run typecheck` | `tsc --noEmit` |

## Configuration (env vars)

| Var | Default | Purpose |
|-----|---------|---------|
| `PORT` | `4000` | HTTP port |
| `DATA_DIR` | `./data` | Where JSON files live |
| `HYDRATION_INTERVAL_MS` | `3600000` | Hydration loop interval (60 min) |
| `HYDRATION_HORIZON_DAYS` | `5` | How far ahead of today to materialise occurrences |
| `SEED_USERS` | `Akhil,Eriko,Maya,Neha` | Comma-separated names for first-run seeding |
| `SPOOF_DATE` | — | Boot with the clock spoofed, e.g. `2026-08-01` |

## API

Base: `http://localhost:4000/api`

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Liveness |
| GET / POST | `/users` | List / create `{ name, color? }` |
| DELETE | `/users/:id` | Remove user |
| GET / POST | `/task-definitions` | List / create `{ title, description?, recurrence, assigneeId?, dueOffsetDays?, startDate? }` |
| PATCH / DELETE | `/task-definitions/:id` | Edit/deactivate / delete (pending instances go too, completed stay) |
| GET | `/task-instances?status=&assigneeId=&from=&to=&includeAnyone=` | List instances (`assigneeId=null` for anyone-tasks) |
| GET | `/task-instances/upcoming?userId=&days=7` | "My week": pending, mine + anyone, overdue included |
| POST | `/task-instances/:id/complete` | `{ completedBy }` |
| POST | `/task-instances/:id/reopen` | Back to pending |
| POST | `/task-instances/:id/reassign` | `{ assigneeId }` (null = anyone) |

Errors are `{ "error": "message" }` with 400/404/409 status codes.

## Date spoofing (for scenario testing)

All server-side time reads go through `src/clock.ts`. Spoof the clock at runtime:

```bash
curl -X POST localhost:4000/api/debug/clock -H "Content-Type: application/json" -d "{\"date\":\"2026-07-28\"}"
curl localhost:4000/api/debug/clock        # inspect state
curl -X DELETE localhost:4000/api/debug/clock   # back to real time
```

Setting the date **re-runs hydration immediately**, so recurring tasks materialise as if time really jumped — the frontend can use this to demo any scenario.

## Architecture notes

- **`src/storage/StorageProvider.ts`** is the DB seam. `JsonFileStorage` is the only implementation; to add a database, implement the interface and change one line in `src/index.ts`.
- **TaskDefinition** = recurring template; **TaskInstance** = concrete occurrence. Hydration (`src/services/hydrationService.ts`) materialises instances from each definition's watermark up to today + horizon, idempotently (uniqueness on `(definitionId, occurrenceDate)`).
- **`src/scheduler.ts`** runs hydration at boot and then on the configured interval.
- One-off tasks (`recurrence: "none"`) create their single instance at creation time.
- Definitions can carry a `startDate` (yyyy-MM-dd): a recurring series anchors its first occurrence on it instead of the creation date (a future date hydrates nothing until the horizon catches up), and a one-off's single instance is created for that date. Once hydration has begun, the `lastHydratedDate` watermark drives the series — editing `startDate` doesn't move already-hydrated instances. Older JSON records without the field anchor on `createdAt` as before.
