# Badge System — Implementation Plan

> Status: **draft, under review — do not implement yet.**
> Open questions are collected in [Open questions](#open-questions) at the bottom.
> Please answer them inline (edit this file) and the plan will be updated accordingly.

## Goal

Add a badge system to the task manager. Badges are **earned** during the week as
jobs are completed, and **awarded** at the start of each week (Monday morning).
Awarded badges are permanent.

## Terminology (plan ↔ codebase)

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

## Core design decisions (proposed — please review)

### D1. "Earned" is derived, not stored. "Awarded" is stored, append-only.

This answers the question in the original notes ("Do badges need state?"):

- **Earned = a pure computation.** Given (user, as-of date, instance history),
  an evaluation engine returns the set of badges the user currently qualifies
  for. Nothing is persisted for the earned state. This gives us for free:
  - upgrading (1 on-time job → bronze earned; 2nd on-time job → silver replaces
    bronze) — it's just a recomputation;
  - downgrading on reopen (a reopened job no longer counts);
  - mid-week streak invalidation (a job going overdue at midnight is reflected
    on the next read, with no background job needed).
- **Awarded = an append-only ledger** (`BadgeAward` records), written once per
  week at the Monday rollover, never updated or deleted — the same pattern as
  the points ledger (`PointGrant`/`PointRevocation`).

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
- Pre-gamification completions (`pointsAwarded === null`) still count for
  badges — they are real completions.

### D3. The scheduler only detects the week boundary; it does not maintain badge state.

The existing scheduler loop (boot + hourly, `src/scheduler.ts`) gets one extra
step after hydration: `badgeService.rolloverIfNewWeek()`:

1. Compute `thisMonday` (yyyy-MM-dd of the current week's Monday, via the
   central clock so spoofed dates work).
2. Compare with the stored watermark `lastAwardedWeekStart`.
3. If `thisMonday > watermark`: evaluate every user **as at the end of the
   week that just finished** (as-of = thisMonday − 1 day), insert a
   `BadgeAward` per earned badge, set watermark = thisMonday.
4. First run ever (no watermark): set watermark = thisMonday and award
   nothing, so nobody gets badges for a partial first week.

The rollover check is also run lazily at the start of badge API reads (cheap,
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

### D5. One earned badge per category per week.

When a person completes jobs, the engine marks as earned the single
highest-priority badge **per category** they qualify for. Earning a higher
tier replaces the lower tier within the same category (bronze → silver →
gold). Badges from different categories coexist (e.g. Amazing worker silver +
Getting back on track in the same week). At rollover, every currently-earned
badge is awarded.

Tie-breaking inside a category (needs confirmation — see Q2):
1. highest `priority` number wins;
2. same priority → higher threshold/tier wins (gold > silver > bronze).

## Proposed file layout

Keeps badge categories in separate files, each self-contained (definition +
rule), as requested:

```
server/src/badges/
  types.ts                    — Tier, BadgeDefinition, BadgeCategory, EvaluationContext, EarnedBadge
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
export const amazingWorker: BadgeCategory = {
  id: 'amazing-worker',
  name: 'Amazing worker',
  lookbackWeeks: 1,               // how much history the engine must slice (streaks declare more)
  badges: [
    { id: 'amazing-worker-bronze', tier: 'bronze', priority: 1, threshold: 1,
      description: 'Complete 1 job this week on or before its due date',
      qualifies: (ctx) => ctx.currentWeek.onTimeCompletions >= 1 },
    // silver, gold…
  ],
};
```

- Badge `id`s are stable strings — awards reference them forever, so renaming
  an id orphans history (like the points ledger, history is never rewritten).
- The engine computes the shared `EvaluationContext` (current week slice +
  per-week slices going back `max(lookbackWeeks)` weeks, completions
  classified by timing, per-week overdue flags). Categories are pure
  predicates over that context — no category does its own storage I/O.
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
  /** yyyy-MM-dd (Monday) of the week the badge was earned in. */
  weekStart: string;
  /** ISO timestamp of the award ceremony (central clock). */
  awardedAt: string;
}
```

Storage (`StorageProvider` + `JsonFileStorage`):

- new collection `badgeAwards` → `badge-awards.json` (missing file = empty,
  consistent with existing load behaviour);
- `listBadgeAwards()`, `insertBadgeAward()`;
- rollover watermark: one small `badge-state.json` (`{ lastAwardedWeekStart:
  string }`) with get/set methods. (Deriving the watermark from
  `max(awards.weekStart)` was considered and rejected: weeks where nobody
  earns anything write no awards, so the watermark would stall and re-evaluate
  old weeks against mutated data.)

## API additions

- `GET /api/badges` — the catalogue (categories → badges with tier, priority,
  threshold, description). Powers any "what badges exist" UI.
- `GET /api/users/:id/badges` — `{ awarded: [...], earned: [...] }`:
  - `awarded`: the user's `BadgeAward` records joined with catalogue info
    (grouped with counts if Q6 = repeatable);
  - `earned`: live evaluation for the current week ("on track to be awarded
    Monday"), clearly labelled as pending.
- `POST /api/debug/award-badges` — run `rolloverIfNewWeek()` on demand
  (debug router, next to the clock endpoints).

No changes to existing endpoints. Leaderboard rows could later embed badge
counts, but that's a UI decision (Q10), not required for v1.

## Badge catalogue (from the original notes — placeholders marked `x?`)

### Category: Amazing worker (`amazing-worker`)
Jobs completed on or before the due date. (Original note said "after the start
date but before the due date" — see Q3 about whether early completions count.)

| Badge | Tier | Priority | Rule (proposed) |
|---|---|---|---|
| `amazing-worker-bronze` | bronze | 1 | ≥ 1 job completed this week on/before its due date |
| `amazing-worker-silver` | silver | 1 | ≥ 2 jobs completed this week on/before their due date |
| `amazing-worker-gold` | gold | 2 | ≥ 3 jobs completed this week on/before their due date |

(Gold's original text says just "3 jobs completed this week" — Q3 asks whether
the on/before-due qualifier applies to gold too; assumed yes.)

### Category: Eager bunny (`eager-bunny`)
Jobs completed **before the start date** (`completedAt` date < `occurrenceDate`).

| Badge | Tier | Priority | Rule |
|---|---|---|---|
| `eager-bunny-gold` | gold | 3 | ≥ `x?` jobs completed this week before their start date |

### Category: Getting back on track (`back-on-track`)
Overdue jobs completed (`completedAt` date > `dueDate`).

| Badge | Tier | Priority | Rule |
|---|---|---|---|
| `back-on-track-silver` | silver | 1 | ≥ `x?` overdue jobs completed this week |

### Category: Streak superstar (`streak-superstar`)
Tracks performance across multiple weeks. Per the original note — correctly —
streaks must be evaluated from raw job data, **not** from badge award history:
a week with 1 on-time job and 1 overdue job earns Amazing worker but must
break the Amazing worker streak.

Proposed precise semantics:

- A week W is **clean** for user U (Amazing-worker-streak sense) if no
  instance *assigned to U* with `dueDate` in W was late: i.e. none with
  `completedAt` null (unfinished by week's end) or `completedAt` date >
  `dueDate`. "Overdue even for a day" disqualifies, per the original note.
  - The current, in-progress week counts with data so far: anything assigned
    to U, pending, with `dueDate` < today makes the week unclean *right now*.
  - Unassigned ("anyone") jobs count against nobody (see Q8).
- A week W is **all-early** for user U (Eager-bunny-streak sense) if every
  instance assigned to U with `occurrenceDate` in W was completed before its
  `occurrenceDate` (and there was at least one such job — see Q7).
- Streak windows are measured in calendar weeks ending at the as-of date
  (current partial week included), via D4's explicit as-of.

| Badge | Tier | Priority | Rule |
|---|---|---|---|
| `streak-amazing-bronze` | bronze | 1 | last 2 weeks clean (no overdue jobs) |
| `streak-amazing-silver` | silver | 1 | last 3 weeks clean |
| `streak-amazing-gold` | gold | 1 | last 4 weeks clean |
| `streak-eager-gold` | gold | 2 | all jobs completed early for the last `x?` weeks |

(Priorities as in the original notes: both streak lines live in one category,
so per D5 only one streak badge can be earned per week — Eager bunny streak
(p2) beats Amazing worker streak (p1) when both qualify. Confirm in Q2.)

## Edge cases & rules (proposed — flag any you disagree with)

- **Week attribution:** completions count in the week containing the
  `completedAt` **local date**; overdue checks use the week containing the
  `dueDate`.
- **Completer vs assignee:** completion-credit badges (Amazing worker, Eager
  bunny, Back on track) credit `completedBy`. Streak cleanliness follows
  `assigneeId` (whoever holds the assignment bears the overdue risk).
  Rationale: doing other people's / unassigned overdue jobs earns Back-on-track
  credit without putting your own streak at risk — otherwise nobody would ever
  help with overdue jobs. (There is no assignment history stored, so "who was
  assignee when it went overdue" is not reconstructible; current `assigneeId`
  is the only option.)
- **Reopened jobs** stop counting (status returns to `pending`), so earned
  badges can downgrade mid-week. Awards already written are unaffected (D1).
- **Deleted users** keep their award history but drop off the UI, same as the
  leaderboard.
- **Retroactivity:** the first rollover evaluates the current week using
  whatever instance history already exists (including pre-badge completions).
  No migration or special-casing.
- **Clock jumps:** with the spoofed clock, jumping forward several weeks
  triggers one award pass for the most recently completed week only (not one
  per missed week) — see Q9.

## Testing strategy

- **Per-category unit tests** (vitest): each category's rule against
  hand-built instance lists — no storage, no clock. Include the "1 on-time +
  1 overdue job" case from the original notes (earns Amazing worker, breaks
  the streak).
- **Engine tests:** priority/tie-break selection, one-earned-per-category,
  upgrade and downgrade-on-reopen behaviour, week-boundary attribution
  (Sunday 23:59 vs Monday 00:01 completions).
- **Rollover service tests:** in-memory storage + spoofed clock — award pass
  writes the right records, is idempotent within a week, initialises the
  watermark on first run without awarding, handles multi-week clock jumps.
- **API tests** alongside the existing `server/test/api.test.ts` style.
- **Manual scenario testing** via the existing ClockSpoofer UI +
  `POST /api/debug/award-badges`.

## Implementation order (after plan sign-off)

1. Types (`BadgeAward`, `BadgeTier`), badge catalogue skeleton + engine +
   one category, with unit tests.
2. Remaining category files + their tests.
3. Storage additions (awards collection, badge-state watermark) + storage
   tests.
4. `badgeService` (rollover, read APIs) + scheduler hook + rollover tests.
5. Routes (`/api/badges`, `/api/users/:id/badges`, debug trigger) + API tests.
6. Web UI (scope per Q10).
7. README/server README updates.

---

## Open questions

**Q1. Terminology & week definition.** Confirm the mapping table above:
"job" = task instance, "start date" = `occurrenceDate`, week = Monday
00:00 → Monday 00:00 server-local time.
*Proposed: as table.* User: Correct this was my intent

**Q2. What is `priority` for?** My reading: within a category, only ONE badge
is earned per week — the highest-priority qualifying one, ties broken by
higher tier. But the catalogue numbers confuse me: Amazing worker bronze and
silver are both priority 1 (so priority alone can't pick between them — tier
must break the tie), and the two streak lines are priority 1 and 2 (so the
Eager bunny streak would *suppress* the Amazing worker streak whenever both
qualify). Is that the intent? Or did you mean priority = display ordering
only, with every qualifying badge in a category being earned?
*Proposed: one earned badge per category; highest priority wins; ties → higher
tier wins.* User: Priority is meant to decide a badge within the category. I made a mistake for the amazing worker priorities. However the streak ones - Doesn't it make sense for the eager bunny streak to suppress the amazing worker one? Because if you earned eager bunny streak you always earned amazing worker streak, that's why the bunny streak one is gold and more valuable.

**Q3. Amazing worker scope.** (a) Does gold ("3 jobs completed this week")
also require on/before the due date? User: Yes (b) Do jobs completed *before the start
date* (Eager bunny jobs) also count toward Amazing worker, or does Amazing
worker only count completions between start and due? User: these 2 are different categories with different criteria, amazing worker only counts jobs completed between the start and due date. Eager bunny only counts jobs completed before the start date. So you could earn both badges in a week but you'd have to do it by completing at least 2 different jobs, 1 within the start/due date, and 1 before the start date.

**Q4. Fill in the `x?` placeholders.**
User: The x indicates any, so if you did 1 job early, you'd get the Eager bunny gold - 1 badge
if you then completed a 2nd job early, that badge would flip to Eager bunny gold - 2
I'm not exactly sure how this will evolve, maybe the badges will have a description and we can explain there that the user completed 2 jobs early or 3 jobs early. Or we can put it in the badge name itself? 
- Eager bunny gold: how many early jobs in a week? User: As above, any number gets you this badge
- Back on track silver: how many overdue jobs completed in a week? User: As above, any number gets you this badge
- Eager bunny streak: how many weeks? User: As above, you earn this streak badge from the 2nd week Eager bunny streak - 2 week, if you go to a new week and you maintain the criteria, you get it again but as Eager bunny streak - 3 etc. Lets make 2 weeks bronze, 3 weeks silver, 4 weeks gold
- Amazing worker streak: 2/3/4 weeks for bronze/silver/gold — confirmed? User: Yes correct

**Q5. "Once a badge is earned it cannot be removed."** This seems to
contradict un-earning bronze when silver is reached. I read it as: once a
badge is **awarded** (Monday rollover) it is never revoked — even if the
underlying jobs are reopened later. The in-progress *earned* set can change
freely during the week. Is that right? User: Yes correct, once awarded, can't be removed, but earned state can change. The idea is that earned badges will show up immediately but in a kind of greyed out state to motivate the user, on rollover when awarded they will become coloured and cannot be removed.

**Q6. Are badges repeatable?** Can the same badge be awarded week after week
(e.g. "Amazing Worker Bronze ×3" in the UI), or is each badge a one-time
unlock after which it can't be earned again? For streaks: while a streak
continues, is the streak badge re-awarded each week?
*Proposed: weekly badges re-award every qualifying week (ledger keeps every
award, UI shows counts); streak badges re-award while the streak holds.* User: Yes correct badges can be awarded again and again. Streak badges can also be awarded again and again, however they number of weeks they have been active for changes, eg on the 2nd week, Eager Bunny Streak (2 weeks), on the 3rd week - Eager Bunny Streak (3 weeks) or similar. Ideally in the UI later, we might want to only show the highest week count streak badge so think about how we might achieve this when creating the data structure for the streak badges.

**Q7. Empty weeks and streaks.** If a user has no jobs assigned in a week,
does that week (a) keep an Amazing-worker streak alive (vacuously "no overdue
jobs")? (b) For the Eager bunny streak ("all jobs completed early"), does an
empty week keep it alive, break it, or is a week only counted when it has ≥1
job?
*Proposed: empty weeks keep both streaks alive (vacuous truth), i.e. a quiet
week never punishes anyone.* User: Nice catch i didn't think of this, I think you are right lets not punish people for not having jobs

**Q8. Unassigned ("anyone") jobs and streaks.** An overdue unassigned job
breaks nobody's streak; only jobs assigned to you count. Completing an
unassigned overdue job still earns the completer Back-on-track credit.
Confirm?
*Proposed: as stated.* User: I think with the auto assignment logic every job will get assigned to a user. But this is a good edge case, if you manually assign a job to yourself or reassign a job to someone else, lets say that job cannot punish you, i.e it cannot break any of your streaks. You can however still pick up the badge for completing that job, eg getting the back on track badge if it was overdue, or having it contributing to your amazing worker or eager bunny badges

**Q9. Multi-week clock jumps.** With the spoofed clock (or a server that was
off for weeks), jumping forward N weeks: award only the most recently
completed week once, or run one award pass per missed week? Note: old weeks
are evaluated against *current* instance data, so passes for older weeks may
be skewed by later edits (reopens, deletions).
*Proposed: single award pass for the latest completed week.* User: Thats fine whatever is easier here, clock spoofs are only for testing and won't be used when in production

**Q10. UI scope.** Where should badges appear in the web app for v1?
*Proposed: (a) awarded badges (with counts, if Q6 = repeatable) shown next to
each user on the leaderboard; (b) a badges section on the users page or a
small per-user badges view showing awarded + "on track to earn" (pending)
badges; (c) no celebration/toast animations in v1.* User: This sounds good but lets not worry too much about the display logic yet, that should be the simpler part, lets get the tracking and awarding part of the badges correct

**Q11. Anything retroactive?** Should existing completed history (jobs
completed before the badge feature ships) count toward the first week's
earned badges and streaks?
*Proposed: yes — evaluation reads all instance history, so the first rollover
just works.* User: Not required, we may introduce more badges later, lets keep it simple badges will only get earned/awarded for future completed tasks.

