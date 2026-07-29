import type { BadgeCategory } from '../types.js';

/**
 * Eager bunny — jobs completed **early** (completion date before the start
 * date, D7). Any count ≥ 1 qualifies; the badge carries the count (Q4).
 */
export const eagerBunny: BadgeCategory = {
  id: 'eager-bunny',
  name: 'Eager bunny',
  description: 'Complete jobs this week before their start date',
  badges: [
    {
      id: 'eager-bunny-gold',
      tier: 'gold',
      priority: 1,
      valueKind: 'job-count',
      description: 'Complete at least 1 job this week before its start date; value = number of early jobs',
      evaluate: (ctx) => (ctx.currentWeek.earlyCount >= 1 ? { value: ctx.currentWeek.earlyCount } : null),
    },
  ],
};
