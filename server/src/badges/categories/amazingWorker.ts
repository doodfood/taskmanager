import type { BadgeCategory } from '../types.js';

/**
 * Amazing worker — jobs completed **in-window** (start date ≤ completion
 * date ≤ due date, D7). Tiers at 1/2/3 in-window completions in the week;
 * priorities 1/2/3 mean only the highest reached tier is earned (D5).
 */
export const amazingWorker: BadgeCategory = {
  id: 'amazing-worker',
  name: 'Amazing worker',
  description: 'Complete jobs this week between their start date and due date',
  badges: [
    {
      id: 'amazing-worker-bronze',
      tier: 'bronze',
      priority: 1,
      valueKind: 'none',
      description: 'Complete at least 1 job this week between its start date and due date',
      evaluate: (ctx) => (ctx.currentWeek.inWindowCount >= 1 ? { value: 0 } : null),
    },
    {
      id: 'amazing-worker-silver',
      tier: 'silver',
      priority: 2,
      valueKind: 'none',
      description: 'Complete at least 2 jobs this week between their start date and due date',
      evaluate: (ctx) => (ctx.currentWeek.inWindowCount >= 2 ? { value: 0 } : null),
    },
    {
      id: 'amazing-worker-gold',
      tier: 'gold',
      priority: 3,
      valueKind: 'none',
      description: 'Complete at least 3 jobs this week between their start date and due date',
      evaluate: (ctx) => (ctx.currentWeek.inWindowCount >= 3 ? { value: 0 } : null),
    },
  ],
};
