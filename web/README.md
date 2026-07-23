# Task Manager — Web App

Next.js 16 (App Router) + TypeScript + Tailwind v4 frontend for the household task manager. All pages are client components talking to the Express API directly from the browser — no SSR data fetching, which keeps the server's spoofable-clock scenarios simple to reason about.

## Quick start

```bash
npm install
npm run dev        # http://localhost:3000 — expects the API on :4000
```

The API base URL comes from `NEXT_PUBLIC_API_URL` in `.env.local` (default `http://localhost:4000/api`).

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Dev server (Turbopack) |
| `npm run build` / `npm start` | Production build / serve |
| `npm run lint` | ESLint (flat config, eslint-config-next) |

## Pages

| Route | Purpose |
|-------|---------|
| `/` | Dashboard — your next 7 days (pending, **overdue included**) plus recently completed, grouped by due date: Overdue / Today / Tomorrow / weekday+date |
| `/tasks/new` | Create a task: one-off or recurring (weekly, every 2 weeks … every 13 weeks), assignee or "Anyone", due offset in days |
| `/users` | Identity picker (colour tiles, no auth) + add/remove household members |

## Structure

- `src/lib/api.ts` — typed fetch wrapper around the API; throws `ApiError` on `{ "error": "..." }` responses.
- `src/lib/types.ts` — mirrors `server/src/types.ts` **by hand** (shared-types package is on the backlog, see `PLAN.md` §6).
- `src/lib/dates.ts` — yyyy-MM-dd ↔ local-date helpers (never `new Date(str)` on a date-only string); UTC ISO timestamps rendered in local time.
- `src/context/UserContext.tsx` — current identity persisted in `localStorage` (`tm.userId`); redirects to `/users` when unset or when the stored user was deleted server-side.
- `src/components/TaskCard.tsx` — complete / reopen / reassign lifecycle.
- `src/components/ClockSpoofer.tsx` — dev tool: jump/reset the server clock (re-runs hydration server-side).
- `src/components/UserBadge.tsx` — assignee pill; handles "Anyone" and deleted-user ("Unknown") gracefully.

## Conventions

- Grouping and overdue logic use the **server's** "today" (`GET /api/debug/clock`), not the client clock — spoofed-date scenarios render exactly as the server sees them.
- Mutations refetch rather than optimistically updating: simple and always consistent with the hydration loop.
- Completed tasks show who did them: strike-through + "done by X at HH:mm" (local time).
