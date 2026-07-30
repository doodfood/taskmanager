import { amazingWorker } from './categories/amazingWorker.js';
import { backOnTrack } from './categories/backOnTrack.js';
import { eagerBunny } from './categories/eagerBunny.js';
import { streakSuperstar } from './categories/streakSuperstar.js';
import type { BadgeCategory, BadgeDefinition } from './types.js';

/**
 * The badge catalogue: ordered category registry used by the engine and the
 * API. Adding a new category = one new file in categories/ + one line here.
 */
export const badgeCategories: BadgeCategory[] = [amazingWorker, eagerBunny, backOnTrack, streakSuperstar];

/** Look up a badge definition by its stable id (awards reference ids forever). */
export function findBadge(badgeId: string): { category: BadgeCategory; badge: BadgeDefinition } | null {
  for (const category of badgeCategories) {
    const badge = category.badges.find((b) => b.id === badgeId);
    if (badge) return { category, badge };
  }
  return null;
}

/** Catalogue shape served by GET /api/badges (evaluate functions stripped). */
export function badgeCatalogue() {
  return badgeCategories.map((category) => ({
    id: category.id,
    name: category.name,
    description: category.description,
    badges: category.badges.map((badge) => ({
      id: badge.id,
      tier: badge.tier,
      priority: badge.priority,
      valueKind: badge.valueKind,
      /** Display-name override; null = fall back to the category name. */
      name: badge.name ?? null,
      description: badge.description,
    })),
  }));
}
