import type { BadgeCategory, EvaluationContext } from '../types.js';

const streakAt = (weeks: number, threshold: number): { value: number } | null =>
  weeks >= threshold ? { value: weeks } : null;

/**
 * Streak superstar — sustained performance across multiple weeks, evaluated
 * from raw job data (not award history), tiered bronze/silver/gold at
 * 2/3/4+ consecutive weeks (Q4). Both lines re-award every rollover while
 * the streak holds, with value = current streak length (Q6/RQ1).
 *
 * The Eager bunny streak line (priority 2) suppresses the Amazing worker
 * streak line (priority 1) when both qualify — intended, since an all-early
 * week is necessarily a clean week (Q2/D5).
 */
export const streakSuperstar: BadgeCategory = {
  id: 'streak-superstar',
  name: 'Streak superstar',
  description: 'Keep every auto-assigned job under control for consecutive weeks',
  badges: [
    {
      id: 'streak-amazing-bronze',
      tier: 'bronze',
      priority: 1,
      valueKind: 'streak-weeks',
      name: 'Amazing worker streak',
      description: 'No auto-assigned job late or left undone for 2 consecutive weeks',
      evaluate: (ctx: EvaluationContext) => streakAt(ctx.cleanStreak, 2),
    },
    {
      id: 'streak-amazing-silver',
      tier: 'silver',
      priority: 1,
      valueKind: 'streak-weeks',
      name: 'Amazing worker streak',
      description: 'No auto-assigned job late or left undone for 3 consecutive weeks',
      evaluate: (ctx: EvaluationContext) => streakAt(ctx.cleanStreak, 3),
    },
    {
      id: 'streak-amazing-gold',
      tier: 'gold',
      priority: 1,
      valueKind: 'streak-weeks',
      name: 'Amazing worker streak',
      description: 'No auto-assigned job late or left undone for 4+ consecutive weeks',
      evaluate: (ctx: EvaluationContext) => streakAt(ctx.cleanStreak, 4),
    },
    {
      id: 'streak-eager-bronze',
      tier: 'bronze',
      priority: 2,
      valueKind: 'streak-weeks',
      name: 'Eager bunny streak',
      description: 'Every auto-assigned job completed before its start date for 2 consecutive weeks',
      evaluate: (ctx: EvaluationContext) => streakAt(ctx.allEarlyStreak, 2),
    },
    {
      id: 'streak-eager-silver',
      tier: 'silver',
      priority: 2,
      valueKind: 'streak-weeks',
      name: 'Eager bunny streak',
      description: 'Every auto-assigned job completed before its start date for 3 consecutive weeks',
      evaluate: (ctx: EvaluationContext) => streakAt(ctx.allEarlyStreak, 3),
    },
    {
      id: 'streak-eager-gold',
      tier: 'gold',
      priority: 2,
      valueKind: 'streak-weeks',
      name: 'Eager bunny streak',
      description: 'Every auto-assigned job completed before its start date for 4+ consecutive weeks',
      evaluate: (ctx: EvaluationContext) => streakAt(ctx.allEarlyStreak, 4),
    },
  ],
};
