import type { BadgeCategory } from '../types.js';

/**
 * Getting back on track — **late** completions (completion date after the
 * due date, D7). Any count ≥ 1 qualifies; the badge carries the count (Q4).
 */
export const backOnTrack: BadgeCategory = {
  id: 'back-on-track',
  name: 'Getting back on track',
  description: 'Clear jobs this week that had gone past their due date',
  badges: [
    {
      id: 'back-on-track-silver',
      tier: 'silver',
      priority: 1,
      valueKind: 'job-count',
      description: 'Complete at least 1 job this week after its due date; value = number of late jobs cleared',
      evaluate: (ctx) => (ctx.currentWeek.lateCount >= 1 ? { value: ctx.currentWeek.lateCount } : null),
    },
  ],
};
