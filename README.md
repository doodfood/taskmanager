# Household Task Manager

Trust-based household chore tracker. Recurring task **definitions** (templates) hydrate concrete **instances** on a schedule; household members pick who they are (no auth) and check things off.

## Repo layout

| Path | What |
|------|------|
| `server/` | Express + TypeScript API — JSON-file persistence behind a storage-provider seam, hydration loop, spoofable clock. [Docs](server/README.md) |
| `web/` | Next.js 16 (App Router) + TypeScript + Tailwind v4 frontend. [Docs](web/README.md) |
| `PLAN.md` | Design doc, as-built API contract, roadmap |

## Quick start

```bash
npm install          # root tooling (concurrently)
npm run setup        # install server/ and web/ dependencies
npm run dev          # boot API (:4000) + web (:3000) together
```

Open http://localhost:3000 — the browser uses the same-origin Next.js `/api` proxy, which forwards to the API on :4000. The first visit asks who you are (seeded users: Akhil, Eriko, Maya, Neha, overridable via `SEED_USERS`). Delete `server/data/` to reset everything, then `npm run seed` (with the API running) to re-insert the users and the cleaning rota.

## Scripts (root)

| Command | Purpose |
|---------|---------|
| `npm run dev` | Boot server + web together |
| `npm run dev:server` / `npm run dev:web` | Boot just one side |
| `npm test` | Server test suite (Vitest) |
| `npm run seed` | Insert the household users + cleaning-rota tasks via the API (idempotent; API must be running) |
| `npm run lint` | Lint both packages |
| `npm run build` | Build both packages |

## Scenario testing (spoofable clock)

All server-side time reads go through a clock you can jump:

- **UI**: the "clock spoofer" panel at the bottom of the dashboard.
- **API**: `POST /api/debug/clock { "date": "2026-08-01" }` re-runs hydration immediately; `DELETE` resets to real time.

Try it: create a weekly task, jump a few weeks forward — the missed occurrences materialise and the early ones render as overdue.

## Status

- Backend ✅ complete, 39/39 tests passing, lint clean
- Frontend ✅ dashboard week view, new-task form (with first-occurrence date), user picker, complete/reopen/reassign, clock spoofer, definitions manager
- Next up: pick from the backlog in `PLAN.md` §6
