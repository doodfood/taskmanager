import { randomUUID } from 'node:crypto';
import { addDaysStr, nowIso, todayStr } from '../clock.js';
import { evaluateBadges, mondayOf } from '../badges/engine.js';
import { badgeCatalogue, findBadge } from '../badges/index.js';
import type { EarnedBadge } from '../badges/types.js';
import type { StorageProvider } from '../storage/StorageProvider.js';
import { notFound, type BadgeAward, type BadgeState } from '../types.js';

export interface RolloverResult {
  /** true when this call initialised the watermark + epoch (first run ever). */
  initialised: boolean;
  /** yyyy-MM-dd (Monday) of the week awards were written for; null when no award pass ran. */
  awardedWeekStart: string | null;
  /** Number of BadgeAward records written by this call. */
  awarded: number;
}

export interface AwardedBadgeView extends BadgeAward {
  /**
   * Catalogue info joined at read time; null if the badge id is unknown.
   * `name` is the display name: the badge's name override when set, else the category name.
   */
  badge: { tier: string; categoryId: string; categoryName: string; name: string; description: string } | null;
}

export interface EarnedBadgeView extends EarnedBadge {
  categoryName: string;
  /** Display name: the badge's name override when set, else the category name. */
  name: string;
  description: string;
}

export interface UserBadges {
  awarded: AwardedBadgeView[];
  earned: EarnedBadgeView[];
}

export function createBadgeService(storage: StorageProvider) {
  return {
    catalogue() {
      return badgeCatalogue();
    },

    /**
     * Monday-anchored weekly rollover (D3). Detects the week boundary and,
     * when a week has finished since the last check, evaluates every user as
     * at the end of the finished week and appends one BadgeAward per earned
     * badge. Idempotent within a week; safe to call lazily from API reads.
     *
     * - First run ever: records the watermark + epoch as this Monday and
     *   awards nothing — nobody gets badges for a partial first week, and no
     *   pre-feature history counts (Q11).
     * - Multi-week clock jumps: a single award pass for the most recently
     *   completed week, not one per missed week (Q9).
     */
    async rolloverIfNewWeek(): Promise<RolloverResult> {
      const thisMonday = mondayOf(todayStr());
      const state = await storage.getBadgeState();

      if (state === null) {
        const initial: BadgeState = { lastAwardedWeekStart: thisMonday, badgesEpoch: thisMonday };
        await storage.setBadgeState(initial);
        return { initialised: true, awardedWeekStart: null, awarded: 0 };
      }

      if (thisMonday <= state.lastAwardedWeekStart) {
        return { initialised: false, awardedWeekStart: null, awarded: 0 };
      }

      // Evaluate as at the end of the week that just finished.
      const asOf = addDaysStr(thisMonday, -1);
      const awardedWeekStart = mondayOf(asOf);
      const instances = await storage.listInstances();
      const awardedAt = nowIso();

      let awarded = 0;
      for (const user of await storage.listUsers()) {
        const earned = evaluateBadges(user.id, asOf, instances, state.badgesEpoch);
        for (const badge of earned) {
          await storage.insertBadgeAward({
            id: randomUUID(),
            kind: 'badge-award',
            userId: user.id,
            badgeId: badge.badgeId,
            value: badge.value,
            weekStart: awardedWeekStart,
            awardedAt,
          });
          awarded++;
        }
      }

      await storage.setBadgeState({ ...state, lastAwardedWeekStart: thisMonday });
      return { initialised: false, awardedWeekStart, awarded };
    },

    /**
     * `{ awarded, earned }` for a user: the permanent award ledger joined
     * with catalogue info, plus the live evaluation for the current week
     * ("on track to be awarded Monday" — pending/greyed in the UI, D1/Q5).
     * Triggers the lazy rollover first so awards appear promptly (D3).
     */
    async badgesForUser(userId: string): Promise<UserBadges> {
      await this.rolloverIfNewWeek();
      const user = await storage.getUser(userId);
      if (!user) throw notFound(`user ${userId} not found`);

      // rolloverIfNewWeek guarantees the state exists.
      const state = (await storage.getBadgeState())!;

      const awarded = (await storage.listBadgeAwards())
        .filter((award) => award.userId === userId)
        .map((award) => {
          const found = findBadge(award.badgeId);
          return {
            ...award,
            badge: found
              ? {
                  tier: found.badge.tier,
                  categoryId: found.category.id,
                  categoryName: found.category.name,
                  name: found.badge.name ?? found.category.name,
                  description: found.badge.description,
                }
              : null,
          };
        });

      const earned = evaluateBadges(userId, todayStr(), await storage.listInstances(), state.badgesEpoch).map(
        (badge) => {
          const found = findBadge(badge.badgeId);
          return {
            ...badge,
            categoryName: found?.category.name ?? '',
            name: found?.badge.name ?? found?.category.name ?? '',
            description: found?.badge.description ?? '',
          };
        },
      );

      return { awarded, earned };
    },
  };
}

export type BadgeService = ReturnType<typeof createBadgeService>;
