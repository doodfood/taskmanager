# Gamification Plan — Points & Leaderboard

## 1. Overview

Add a scoring layer on top of the existing task manager so that completing
tasks earns points for the person who completed them, with bonuses for
finishing early and penalties for finishing late, and a leaderboard page to
compare everyone's earnings over rolling time windows (1, 2, 4 or 8 weeks).

Three functional changes:

1. **Default points** — new task definitions default to **10 points** instead of 1.
2. **Points scoring** — completing / reopening tasks grants and revokes points.
3. **Leaderboard** — a ranked view of points earned over a selectable period.

---

## 2. Scoring Rules

Every task instance has a **face value**: its `points` snapshot (copied from
the definition at hydration time, as today). When a task is completed, the
**award** actually granted is derived from the face value and how the
completion date compares to the due date:

| Timing | Award |
|---|---|
| Completed **early** (any number of days before the due date) | face value **+ 5** |
| Completed **on the due date** | face value (unchanged) |
| Completed **overdue** | face value **− 1 per calendar day late** |
| Any completion | **minimum of 1 point**, always |

Notes on the rules:

- The early bonus is a flat +5 — it does not scale with how early the task is
  finished.
- The overdue penalty is −1 per whole calendar day past the due date
  (comparing the completion *date* to the `dueDate`, both as yyyy-MM-dd).
- The minimum-of-1 floor applies in every case, so even a 0-point task or a
  hopelessly overdue task still grants 1 point on completion.

### Worked examples (10-point task due Sunday)

| Completed | Days vs due | Award |
|---|---|---|
| Saturday (early) | −1 | 10 + 5 = **15** |
| Sunday (due date) | 0 | **10** |
| Monday | +1 | 10 − 1 = **9** |
| Wednesday | +3 | 10 − 3 = **7** |
| Friday | +5 | 10 − 5 = **5** |
| Two weeks later | +14 | floor → **1** |

### Who earns the points

Points go to the **completer** — the user recorded as `completedBy` on the
instance (which is who the complete API already requires). In the normal flow
that is the assignee; for "anyone" tasks it is whoever actually does the task.
This is what makes the reopen → reassign → re-complete flow attribute points
correctly (see §3).

---

## 3. Points Lifecycle (complete / reopen / re-complete)

Scoring follows the existing task lifecycle endpoints:

- **Complete** (`POST /task-instances/:id/complete`)
  The award is calculated once, at completion time, using the central clock
  (so date spoofing for testing keeps working), and granted to the completer.
  The granted amount is **snapshotted** — later edits to the definition or
  rule changes never rewrite history.

- **Reopen** (`POST /task-instances/:id/reopen`)
  The points from the previous completion are **revoked from the user who
  completed it** — exactly the amount they were granted, even if they are no
  longer the assignee. After a reopen, that completion contributes **zero**
  points in every leaderboard window, as if it never happened.

- **Re-complete after reopen** (same or different person)
  Treated as a brand-new completion: a fresh award is calculated from the
  *new* completion date and granted to the *new* completer. Because the award
  is recalculated, a task that was on-time when first completed may be worth
  less if it is now overdue — and vice versa it can never be worth more than
  the rules allow.

### The key scenario this supports

1. Alice completes a 10-point task on time → **Alice +10**.
2. The task is reopened → **Alice −10** (net 0 for that completion).
3. The task is reassigned to Bob.
4. Bob completes it, now 2 days overdue → **Bob +8**.

Final standing: Alice 0, Bob 8 — points always track the completion that
actually "stuck".

---

## 4. Default Points: 1 → 10

- The server-side default for a definition's `points` (when the field is
  omitted/blank on create) changes from 1 to **10**.
- The new-task form pre-fills **10** to match.
- **Existing data is untouched**: definitions and hydrated instances keep
  their current point values. The new default only applies to newly created
  definitions where no value is given.

The `points` field keeps its existing dual role as the difficulty weighting
used by auto-assignment balancing — that behaviour is unchanged; only the
default and the new "earned points" meaning are added on top.

---

## 5. Points Ledger (how scores are remembered)

Scores are stored as an append-only **points ledger** rather than being
recomputed from task state:

- A **grant entry** is recorded on every completion: who, which task
  instance, how many points, when, and the timing outcome
  (early / on-time / days-late) for display purposes.
- A **revocation entry** is recorded on every reopen, linked to the grant it
  cancels and naming the user it was taken back from.

Why a ledger instead of deriving from instances:

- **Exact reversals** — a revocation cancels the precise amount originally
  granted, even if scoring rules or the task's points change later.
- **History survives reopen** — reopening an instance wipes its
  `completedBy`/`completedAt`, but the leaderboard still needs to know the
  completion happened so it can exclude it correctly.
- **Time windows** — the leaderboard filters by when points were earned,
  which the ledger records directly.

Functionally: **grant + its revocation cancel out everywhere** — in every
time window and every total.

The ledger lives in its own JSON data file behind the existing
`StorageProvider` seam, consistent with the current architecture.

### Pre-gamification history

Tasks completed before this feature ships have no ledger entries and earn
nothing retroactively — leaderboards start from go-live. No backfill.

---

## 6. Leaderboard

A new page showing who has earned the most points over a rolling period.

### Behaviour

- **Time filters:** tabs for **1, 2, 4 and 8 weeks**. The window is "the last
  N weeks" measured back from today (via the central clock, so spoofed dates
  work for demos/tests).
- **Ranking:** users sorted by net points earned within the window,
  descending. Ties broken alphabetically by name (stable, predictable).
- **Every registered user appears**, even with 0 points in the window — it's
  a leaderboard, not just a winners list.
- **Per-user row shows:** rank, the user's colour chip and name, number of
  tasks completed in the window, and net points earned. The top 3 get
  medal-style visual treatment (🥇🥈🥉).
- **Reopened completions count for nothing** — they contribute neither
  points nor to the "tasks completed" tally, in any window.
- The **currently signed-in user** is visually highlighted so you can find
  yourself at a glance.

### API

One new endpoint:

- `GET /api/leaderboard?weeks=1|2|4|8` → ranked list of
  `{ user, totalPoints, tasksCompleted, rank }`.

Anything outside 1/2/4/8 is rejected as a bad request.

### UI

- New route **`/leaderboard`** with the filter tabs and ranked table, plus a
  navigation link from the existing pages so it's reachable from anywhere.
- Small supporting touches elsewhere:
  - Completed task cards show the **points earned** (e.g. "+15") instead of
    just the face value.
  - The new-task form defaults to 10 points (§4).

---

## 7. Summary of Changes by Layer

**Server**

- `types` — new `PointEvent` (ledger entry) type; default-points constant.
- Scoring logic — one pure function: `(faceValue, dueDate, completionDate) → award`,
  easy to unit-test exhaustively.
- `taskService` — `complete()` also writes a grant entry; `reopen()` writes a
  revocation entry against the original grant.
- New leaderboard service — sums ledger entries within the requested window,
  excluding revoked grants, joined with users and ranked.
- `StorageProvider` + JSON storage — persist and read the ledger file.
- Routes — mount `GET /api/leaderboard`.
- Validation — default points 10 when omitted.

**Web**

- `types.ts` mirror — ledger/leaderboard response types; default-points
  comment update.
- `api.ts` — leaderboard fetch function.
- New `/leaderboard` page with 1/2/4/8-week tabs, ranked table, medals,
  current-user highlight; nav link added to existing pages.
- `TaskForm` — points field defaults to 10.
- `TaskCard` — show earned points on completed tasks.

---

## 8. Edge Cases & Decisions

| Case | Decision |
|---|---|
| Task completed by someone other than the assignee | Completer (`completedBy`) earns the points |
| "Anyone" task completed | Whoever completes it earns the points |
| 0-point task completed | Grants the 1-point minimum |
| Very overdue task | Award floors at 1, never 0 or negative |
| Completed early by many days | Flat +5, regardless of how early |
| Reopen then never re-complete | Original grant stays revoked; nobody has those points |
| Reopen → re-complete by same person | Fresh award from the new completion date |
| Task edited after completion | No effect — the granted amount was snapshotted |
| Definition deleted | Completed instances (and their grants) remain as history, as today |
| User deleted | They drop off the leaderboard; their ledger history is harmless |
| Pre-existing completions (pre-feature) | No retroactive points; leaderboard starts clean |
| `weeks` param other than 1/2/4/8 | 400 bad request |
| Scores within a window | Never negative in practice: only valid (un-revoked) grants in the window are counted |

---

## 9. Testing Strategy

- **Scoring unit tests** — the pure award function: early (several offsets),
  on-time, 1-day-late, many-days-late, floor-at-1, 0-point task, early bonus
  independence from face value.
- **Lifecycle tests** — complete grants; reopen revokes the right user and
  amount; reopen→reassign→complete attributes to the new completer; reopen→
  re-complete recomputes from the new date (uses clock spoofing).
- **Leaderboard tests** — window boundaries (an entry at exactly N weeks is
  in/out as specified), revoked grants excluded from points and counts,
  ranking order, zero-point users included, invalid `weeks` rejected.
- **Default points** — definition created without points gets 10; explicit
  values (including 0) are respected.

## 10. Rollout Order

1. [x] Scoring function + unit tests (pure logic, no wiring)
2. [x] Points ledger: storage, grant on complete, revoke on reopen + tests
3. [x] Default points 10 (server validation + task form)
4. [ ] Leaderboard endpoint + tests
5. [ ] Leaderboard page (filters, ranking, medals, current-user highlight) + nav link
6. [x] TaskCard earned-points display polish
