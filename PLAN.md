# Badge System — Implementation Plan

> Status: **approved — ready for implementation.** All questions resolved
> (see [Decision log](#decision-log)).
> [Suggested additional badges](#suggested-additional-badges) are parked as the
> backlog for a future update — do not lose them.

## Goal

Add a badge system to the task manager. Badges are **earned** during the week as
jobs are completed, and **awarded** at the start of each week (Monday morning).
Awarded badges are permanent; earned badges are fluid until awarded.

## Terminology (plan ↔ codebase) — confirmed (Q1)

| Plan says | Codebase equivalent |
|---|---|
| job | `TaskInstance` |
| start date (of a job) | `TaskInstance.occurrenceDate` (yyyy-MM-dd) |
| due date | `TaskInstance.dueDate` (yyyy-MM-dd) |
| job completed | `TaskInstance.status === 'completed'`, with `completedBy` / `completedAt` |
| week | Monday 00:00 → next Monday 00:00, **server-local** time (same timezone as `todayStr()` in `src/clock.ts`) |

Note: the existing leaderboard uses a *rolling* N×7-day window, not calendar
weeks. Badges introduce the first Monday-anchored week concept
(`startOfWeek(date, { weekStartsOn: 1 })` from date-fns). The two coexist; the
leaderboard is unchanged.

## Core design decisions

### D1. "Earned" is derived, not stored. "Awarded" is stored, append-only.

- **Earned = a pure computation.** Given (user, as-of date, instance history),
  an evaluation engine returns the badges the user currently qualifies for
  (with their current values). Nothing is persisted for the earned state. This
  gives us for free:
  - upgrading (bronze → silver) and count flips ("Eager bunny — 1" →
    "Eager bunny — 2") — just recomputation;
  - downgrading on reopen (a reopened job no longer counts);
  - mid-week streak invalidation (a job going overdue at midnight is reflected
    on the next read, with no background job needed).
- **Awarded = an append-only ledger** (`BadgeAward` records), written once per
  week at the Monday rollover, never updated or deleted — the same pattern as
  the points ledger. Once awarded, a badge can never be removed, even if the
  underlying jobs are reopened later (Q5).
- UI intent (Q5): earned badges show immediately in a greyed-out "pending"
  state; at rollover they become coloured/permanent.

### D2. Badge evaluation reads task instances, not the points ledger.

The points ledger cannot support the badge rules: `PointGrant` snapshots
`timing`/`daysLate` relative to the **due date** only — it does not record the
occurrence (start) date, so "completed before the start date" (Eager bunny) is
not computable from it. Instances carry everything needed (`occurrenceDate`,
`dueDate`, `completedAt`, `completedBy`, `assigneeId`, `status`), are retained
as history when completed, and reopening flips them back to `pending` — which
is exactly the reopen-aware behaviour badges want.

Known caveats (accepted, household scale):
- `POST /api/debug/clear-instances` wipes badge-relevant history (it's a
  scenario-reset tool; awards already written stay written).
- Deleting a task definition removes its *pending* instances, so a
  pending-and-overdue job that is deleted mid-week stops counting against a
  streak. Edge case; acceptable.

### D3. The scheduler only detects the week boundary; it does not maintain badge state.

The existing scheduler loop (boot + hourly, `src/scheduler.ts`) gets one extra
step after hydration: `badgeService.rolloverIfNewWeek()`:

1. Compute `thisMonday` (yyyy-MM-dd of the current week's Monday, via the
   central clock so spoofed dates work).
2. Compare with the stored watermark `lastAwardedWeekStart`.
3. If `thisMonday > watermark`: evaluate every user **as at the end of the
   week that just finished** (as-of = thisMonday − 1 day), insert a
   `BadgeAward` per earned badge, set watermark = thisMonday.
4. First run ever (no watermark): set `lastAwardedWeekStart` **and**
   `badgesEpoch` = thisMonday, and award nothing — nobody gets badges for a
   partial first week, and no pre-feature history counts (Q11).
5. Multi-week clock jumps (spoofed clock / server downtime): a single award
   pass for the most recently completed week, not one per missed week (Q9 —
   testing-only scenario).

The rollover check also runs lazily at the start of badge API reads (cheap,
idempotent), so awards appear promptly even if the hourly loop hasn't fired
yet. A `POST /api/debug/award-badges` debug endpoint triggers the same
function on demand for scenario testing with the clock spoofer.

### D4. Evaluation is a pure function of (user, as-of date, instances).

`evaluateBadges(userId, asOfDate, instances) → EarnedBadge[]` takes an
explicit as-of date instead of reading the clock. The same function serves:

- the live "currently earned (pending award)" view — as-of = today;
- the Monday award ceremony — as-of = last Sunday.

This makes the whole engine trivially unit-testable and immune to
"scheduler ran at 00:59 vs 01:01" edge cases.

### D5. One earned badge per category per week (Q2).

Within a category, exactly one badge can be earned per week:

1. highest `priority` number wins;
2. same priority → higher tier wins (gold > silver > bronze).

Priorities are per-category and only need to be distinct across badge **lines**
within that category; tiers within a line are ordered by the tier tie-break.

Intended consequence (Q2): in the Streak superstar category the Eager bunny
streak line (priority 2) suppresses the Amazing worker streak line
(priority 1). That is correct by design — an all-early week is necessarily a
no-overdue week, so Eager-bunny-streak qualification implies
Amazing-worker-streak qualification, and only the more valuable badge is
earned.

### D6. Badges can carry a value (Q4, Q6).

Some badges are parameterised by a number at award/earn time:

- **Count badges** (Eager bunny, Back on track): `value` = number of
  qualifying jobs that week ("Eager bunny — 3"). Any count ≥ 1 qualifies;
  there is no threshold.
- **Streak badges**: `value` = current streak length in weeks
  ("Eager Bunny Streak — 4 weeks"). Tier is derived from the value:
  2 weeks → bronze, 3 → silver, ≥ 4 → gold (both streak lines, Q4). Beyond 4
  weeks the tier stays gold and the value keeps growing — re-awarded each
  week with the new number (RQ1, confirmed).
- **Plain badges** (Amazing worker tiers, Clean sweep etc.): no value
  (`valueKind: 'none'`).

The award record stores the value, so the UI can later show counts and —
for streaks — only the highest-week-count award per streak line (Q6). The
catalogue declares per badge how to interpret the value
(`valueKind: 'none' | 'job-count' | 'streak-weeks'`); display formatting is a
UI concern, out of scope for the tracking work (Q10).

### D7. The three completion-timing classes are a strict partition (Q3).

Each completion falls into exactly one class, by comparing the `completedAt`
**local date** against the job's dates:

| Class | Condition | Feeds category |
|---|---|---|
| early | completion date < `occurrenceDate` | Eager bunny |
| in-window | `occurrenceDate` ≤ completion date ≤ `dueDate` | Amazing worker |
| late | completion date > `dueDate` | Getting back on track |

Categories are independent but non-overlapping in their inputs: earning both
Amazing worker and Eager bunny in one week requires at least two different
jobs (Q3). This 3-way classification is badge-specific and separate from the
points system's 2-way `PointTiming` (early/on-time vs due date) — no changes
to scoring.

### D8. Manual assignments can credit but never punish (Q8).

Streak risk only attaches to **auto-assigned** jobs. A job that was manually
assigned (self-assigned, or reassigned to someone) can still *earn* badges for
whoever completes it (Amazing worker / Eager bunny / Back on track credit),
but its lateness or unfinishedness breaks nobody's streak.

Mechanism (required because no assignment history exists today): a new
`assignmentKind` field on `TaskInstance`, snapshotted when the assignment
happens:

- hydration auto-assigns → `'auto'`; hydrated unassigned ("anyone") → `'none'`;
- `reassign()` to a user → `'manual'`; reassigned to "anyone" → `'none'`;
- absent in legacy records → treated as `'auto'` if `assigneeId` is set, else
  `'none'` (only affects tasks hydrated before the feature ships; in practice
  nearly all are auto-assigned).

Consequence (confirmed, RQ3): reassigning one of your auto-assigned jobs to
someone else makes it `'manual'`, so it can no longer break anyone's streak —
including yours. A risky overdue job can be "cleansed" by reassigning it.
Accepted at household trust level; revisit (e.g. risk stays with the original
auto-assignee) only if the family starts exploiting it.

## Proposed file layout

Keeps badge categories in separate files, each self-contained (definition +
rule), as requested:

```
server/src/badges/
  types.ts                    — BadgeTier, ValueKind, BadgeDefinition, BadgeCategory,
                                EvaluationContext, EarnedBadge
  engine.ts                   — builds EvaluationContext from instances; runs all categories; pure
  index.ts                    — category registry (ordered list used by the engine and the API)
  categories/
    amazingWorker.ts          — category definition + its badges + its rule
    eagerBunny.ts
    backOnTrack.ts
    streakSuperstar.ts        — both streak badge lines live here
server/src/services/badgeService.ts  — awarded-ledger persistence, rollover, read APIs
server/src/routes/badges.ts          — REST endpoints
```

Shape of a category file (sketch, not final):

```ts
export const eagerBunny: BadgeCategory = {
  id: 'eager-bunny',
  name: 'Eager bunny',
  lookbackWeeks: 1,               // how much history the engine must slice (streaks declare more)
  badges: [
    { id: 'eager-bunny-gold', tier: 'gold', priority: 1, valueKind: 'job-count',
      description: 'Complete jobs this week before their start date',
      evaluate: (ctx) => ctx.currentWeek.earlyCompletions >= 1
        ? { value: ctx.currentWeek.earlyCompletions }
        : null },
  ],
};
```

- Badge `id`s are stable strings — awards reference them forever, so renaming
  an id orphans history (like the points ledger, history is never rewritten).
- The engine computes the shared `EvaluationContext` (current week slice +
  per-week slices going back `max(lookbackWeeks)` weeks, clipped at
  `badgesEpoch`; completions partitioned per D7; per-week punishable-job
  flags per D8). Categories are pure functions over that context — no
  category does its own storage I/O.
- Adding a new category = adding one file + one line in `index.ts`. No engine
  changes.

## Data model additions

```ts
// server/src/types.ts
export type BadgeTier = 'bronze' | 'silver' | 'gold';

/** Append-only record of a badge awarded at a weekly rollover. */
export interface BadgeAward {
  id: string;
  kind: 'badge-award';
  userId: string;
  badgeId: string;          // e.g. 'amazing-worker-bronze' — references the catalogue in code
  /** Value at award time: job count or streak length, per the badge's valueKind. */
  value: number | null;
  /** yyyy-MM-dd (Monday) of the week the badge was earned in. */
  weekStart: string;
  /** ISO timestamp of the award ceremony (central clock). */
  awardedAt: string;
}

// TaskInstance gains:
/** How the current assignee got the job: auto at hydration, manual via
 *  reassign, or none (anyone). Drives D8 streak immunity. */
assignmentKind: 'auto' | 'manual' | 'none';
```

Storage (`StorageProvider` + `JsonFileStorage`):

- new collection `badgeAwards` → `badge-awards.json` (missing file = empty,
  consistent with existing load behaviour);
- `listBadgeAwards()`, `insertBadgeAward()`;
- rollover state: one small `badge-state.json`
  (`{ lastAwardedWeekStart: string, badgesEpoch: string }`) with get/set
  methods. (Deriving the watermark from `max(awards.weekStart)` was rejected:
  weeks where nobody earns anything write no awards, so the watermark would
  stall and re-evaluate old weeks against mutated data. The epoch can't be
  derived at all after quiet weeks.)

Touch points for `assignmentKind`:

- `instanceFromDefinition` (hydrationService) sets `'auto'`/`'none'`;
- `taskService.reassign()` sets `'manual'`/`'none'`;
- mirror the field in `web/src/lib/types.ts`.

## API additions

- `GET /api/badges` — the catalogue (categories → badges with tier, priority,
  valueKind, description). Powers any "what badges exist" UI.
- `GET /api/users/:id/badges` — `{ awarded: [...], earned: [...] }`:
  - `awarded`: the user's `BadgeAward` records joined with catalogue info
    (repeatable per Q6 — every award kept; grouping/count display is a UI
    concern);
  - `earned`: live evaluation for the current week, including current values
    ("on track to be awarded Monday"), labelled as pending/greyed in the UI.
- `POST /api/debug/award-badges` — run `rolloverIfNewWeek()` on demand
  (debug router, next to the clock endpoints).

No changes to existing endpoints.

## Badge catalogue

### Category: Amazing worker (`amazing-worker`)
Jobs completed **in-window** (start date ≤ completion date ≤ due date, D7).

| Badge | Tier | Priority | Value | Rule |
|---|---|---|---|---|
| `amazing-worker-bronze` | bronze | 1 | — | ≥ 1 in-window completion this week |
| `amazing-worker-silver` | silver | 2 | — | ≥ 2 in-window completions this week |
| `amazing-worker-gold` | gold | 3 | — | ≥ 3 in-window completions this week |

(Priorities corrected to 1/2/3 per Q2.)

### Category: Eager bunny (`eager-bunny`)
Jobs completed **early** (completion date < start date). Any count ≥ 1
qualifies; the badge carries the count (Q4).

| Badge | Tier | Priority | Value | Rule |
|---|---|---|---|---|
| `eager-bunny-gold` | gold | 1 | job-count | ≥ 1 early completion this week; value = count |

### Category: Getting back on track (`back-on-track`)
**Late** completions (completion date > due date). Any count ≥ 1 qualifies;
the badge carries the count (Q4).

| Badge | Tier | Priority | Value | Rule |
|---|---|---|---|---|
| `back-on-track-silver` | silver | 1 | job-count | ≥ 1 late completion this week; value = count |

### Category: Streak superstar (`streak-superstar`)
Tracks performance across multiple weeks. Per the original requirement —
correctly — streaks are evaluated from raw job data, **not** from badge award
history: a week with 1 in-window job and 1 overdue job earns Amazing worker
but must break the Amazing worker streak.

Precise semantics (both lines use week W = jobs **due** in W):

- Week W is **clean** for user U if no job *auto-assigned* to U with
  `dueDate` in W was late (completed after its due date) or unfinished by
  week's end. "Overdue even for a day" disqualifies. Empty weeks are clean
  (vacuous truth, Q7). Manual/anyone jobs are ignored (D8).
- Week W is **all-early** for user U if every job *auto-assigned* to U with
  `dueDate` in W was completed early (before its start date). Empty weeks are
  all-early (vacuous truth, Q7). Manual/anyone jobs are ignored (D8).
- Streak length at the as-of date = consecutive clean (resp. all-early) weeks
  counting back from the week containing the as-of date (that week included,
  with data so far — a job overdue *right now* breaks it immediately).
- Windows are clipped at `badgesEpoch`: weeks before the epoch count as
  nothing (not vacuous-true), so a streak can only start accumulating from
  the epoch. Earliest possible streak award: bronze at the rollover ending
  the second post-epoch week (Q11).
- Award re-fires each rollover while the streak holds (Q6), with value =
  streak length at that rollover.

| Badge | Tier | Priority | Value | Rule |
|---|---|---|---|---|
| `streak-amazing-bronze` | bronze | 1 | streak-weeks | clean streak ≥ 2 weeks |
| `streak-amazing-silver` | silver | 1 | streak-weeks | clean streak ≥ 3 weeks |
| `streak-amazing-gold` | gold | 1 | streak-weeks | clean streak ≥ 4 weeks |
| `streak-eager-bronze` | bronze | 2 | streak-weeks | all-early streak ≥ 2 weeks |
| `streak-eager-silver` | silver | 2 | streak-weeks | all-early streak ≥ 3 weeks |
| `streak-eager-gold` | gold | 2 | streak-weeks | all-early streak ≥ 4 weeks |

Only one badge per week from this category (D5): the Eager line's priority 2
suppresses the Amazing line when both qualify — intended, since all-early
implies clean (Q2).

## Edge cases & rules

- **Week attribution:** completions count in the week containing the
  `completedAt` **local date**; streak clean/all-early flags bucket jobs by
  the week containing their `dueDate`.
- **Completer vs assignee:** completion-credit badges (Amazing worker, Eager
  bunny, Back on track) credit `completedBy`. Streak risk follows
  auto-assignment (D8).
- **Reopened jobs** stop counting (status returns to `pending`), so earned
  badges can downgrade mid-week. Awards already written are unaffected (D1).
- **Deleted users** keep their award history but drop off the UI, same as the
  leaderboard.
- **No retroactivity (Q11):** nothing before `badgesEpoch` counts —
  completions before the epoch don't exist for the engine, and pre-epoch
  weeks can't inflate streaks.

## Testing strategy

- **Per-category unit tests** (vitest): each category's rule against
  hand-built instance lists — no storage, no clock. Include the "1 in-window +
  1 overdue job" case (earns Amazing worker, breaks the clean streak), the
  D7 partition boundaries (completion exactly on start date = in-window;
  exactly on due date = in-window), and count/value flips.
- **Engine tests:** priority/tie-break selection (Eager streak suppresses
  Amazing streak), one-earned-per-category, upgrade and downgrade-on-reopen,
  week-boundary attribution (Sunday 23:59 vs Monday 00:01), epoch clipping,
  D8 (manual job late → streak intact; auto job late → broken).
- **Rollover service tests:** in-memory storage + spoofed clock — award pass
  writes the right records (with values), is idempotent within a week,
  initialises watermark+epoch on first run without awarding, handles
  multi-week clock jumps with a single pass.
- **API tests** alongside the existing `server/test/api.test.ts` style.
- **Manual scenario testing** via the existing ClockSpoofer UI +
  `POST /api/debug/award-badges`.

## Implementation order

1. Types (`BadgeTier`, `BadgeAward`, `assignmentKind`) + catalogue/engine
   skeleton.
2. `assignmentKind` plumbing (hydration, reassign, legacy derivation).
3. Catalogue: all four category files + engine, with unit tests.
4. Storage additions (awards collection, badge-state) + storage tests.
5. `badgeService` (rollover, read APIs) + scheduler hook + rollover tests.
6. Routes (`/api/badges`, `/api/users/:id/badges`, debug trigger) + API tests.
7. Web UI (light, per Q10: greyed earned vs coloured awarded; detail
   formatting later).
8. README/server README updates.

---

## Suggested additional badges

All fit the current framework (one file per category, weekly evaluation,
D1–D8). "Engine impact" flags anything beyond a new category file.
Confirmed scope (RQ2): **none are in v1** — ship the original four categories
first; this table is the backlog for a future update.

| Idea | Category / badges | Rule sketch | Data used | Engine impact |
|---|---|---|---|---|
| **Heavy lifter** | `heavy-lifter`: bronze/silver/gold | Total points of jobs you completed this week ≥ 50 / 100 / 200 | `instance.points` on your completions | none — weekly sum |
| **Helping hand** | `helping-hand`: gold, job-count | Completed ≥1 job assigned to *someone else*; value = count | `completedBy ≠ assigneeId` | none |
| **Clean sweep** | `clean-sweep`: gold | Every job assigned to you due this week is completed (any timing) — nothing left hanging | assigned jobs due in week | none |
| **Steady Eddie** (streak) | `steady-eddie`: bronze/silver/gold, streak-weeks | Completed ≥1 job every week for 2/3/4+ weeks — a "show up every week" streak | completions per week | none — third streak pattern, its own category so it never suppresses/gets suppressed |
| **Weekend warrior** | `weekend-warrior`: silver, job-count | ≥1 job completed on a Saturday/Sunday; value = count | day-of-week of `completedAt` | none |
| **Big rocks** | `big-rocks`: bronze/silver/gold | Completed ≥1/2/3 jobs worth ≥ 40 points this week | `instance.points` threshold | none |
| **Rescue mission** | `rescue-mission`: gold, job-count | Completed ≥1 job that was ≥ 7 days overdue; value = count | `daysLate`-style date math | none |
| **Night owl / Early bird** | two comic count badges | Job completed after 21:00 / before 07:00 server-local | time component of `completedAt` | none |
| **First off the mark** | `first-off-the-mark`: gold | You recorded the week's first completion (earliest `completedAt` across all users) | cross-user comparison | context is already global; zero-sum — only one winner per week |
| **Century club** (lifetime) | `century-club`: bronze/silver/gold | 50 / 100 / 250 jobs completed **all-time** (also: 1,000/5,000 lifetime points) | all-time aggregates | small: add an `allTime` slice to `EvaluationContext`; still awarded at rollover, never revoked |

Notes:
- Helping hand pairs nicely with D8: helping with someone else's overdue job
  earns you Back on track / Helping hand with zero streak risk.
- Steady Eddie and the two existing streak lines demonstrate the category
  design freedom: separate categories → multiple streak badges per week;
  same category → mutual suppression by priority.
- Lifetime badges are the one idea that stretches the framework (all-time
  window); worth doing as a v2 once the weekly engine has proven itself.

## Decision log

- **Q1 — terminology/week def:** confirmed as proposed.
- **Q2 — priority:** decides the single earned badge within a category.
  Amazing worker priorities were a mistake → fixed to 1/2/3. Eager bunny
  streak suppressing Amazing worker streak is intended (all-early implies
  clean, so the more valuable badge wins).
- **Q3 — Amazing worker scope:** gold requires on/before due. Timing classes
  are a strict partition — Amazing worker counts only in-window completions;
  early completions feed Eager bunny only (D7).
- **Q4 — thresholds:** `x` meant "any" — Eager bunny and Back on track are
  count badges (any ≥ 1, badge shows the count). Streaks are parameterised by
  week count and re-awarded weekly with the growing number; both streak lines
  tier at 2/3/4 weeks → bronze/silver/gold (D6).
- **Q5 — permanence:** awarded = permanent (even after later reopens);
  earned = fluid. UI shows earned greyed-out, awarded coloured.
- **Q6 — repeatability:** badges re-award every qualifying week; streak
  badges re-award with the current week count; UI may later show only the
  highest-count streak award (value stored per D6).
- **Q7 — empty weeks:** keep both streaks alive (vacuous truth); quiet weeks
  never punish.
- **Q8 — manual jobs:** manual/self/reassigned jobs can credit but never
  punish → `assignmentKind` (D8). (User expects auto-assignment to cover most
  jobs in practice.)
- **Q9 — clock jumps:** single award pass for the latest completed week.
- **Q10 — UI:** leaderboard/user-page badge display later; v1 focus is
  correct tracking + awarding; earned=greyed, awarded=coloured.
- **Q11 — retroactivity:** none. Badges only count future completions →
  `badgesEpoch` recorded at first run; streak windows clipped at the epoch.
- **RQ1 — streaks beyond 4 weeks:** tier caps at gold; the value keeps
  growing and re-awards weekly with the new number.
- **RQ2 — suggested badges:** keep the suggestions table as a future-update
  backlog; v1 ships the original four categories only.
- **RQ3 — reassignment cleansing:** accepted; revisit only if the family
  starts exploiting it (note in the server README).

