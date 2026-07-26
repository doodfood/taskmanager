import { randomUUID } from 'node:crypto';
import { nowIso, todayStr } from '../clock.js';
import { computeAward } from '../scoring.js';
import type { StorageProvider } from '../storage/StorageProvider.js';
import type { PointGrant, PointRevocation, TaskInstance } from '../types.js';

/**
 * Writes to the append-only points ledger: a grant on every completion, a
 * revocation (against the exact grant it cancels) on every reopen. Reading
 * and aggregating the ledger (leaderboard) is a separate concern.
 */
export function createPointsService(storage: StorageProvider) {
  /** Grants that have not been cancelled by a revocation entry. */
  async function activeGrants(): Promise<PointGrant[]> {
    const events = await storage.listPointEvents();
    const revokedIds = new Set(
      events.filter((e): e is PointRevocation => e.kind === 'revocation').map((e) => e.grantId),
    );
    return events.filter((e): e is PointGrant => e.kind === 'grant' && !revokedIds.has(e.id));
  }

  /**
   * Record the award for a completion. The award is derived once, here, from
   * the central clock (so spoofed dates work) and snapshotted into the grant
   * — later edits or rule changes never rewrite it.
   */
  async function recordCompletion(instance: TaskInstance, completerId: string): Promise<PointGrant> {
    // `?? 0`: legacy instances predate the points field; the 1-point floor
    // in computeAward still guarantees a minimum award.
    const faceValue = instance.points ?? 0;
    const award = computeAward(faceValue, instance.dueDate, todayStr());
    const grant: PointGrant = {
      id: randomUUID(),
      kind: 'grant',
      userId: completerId,
      instanceId: instance.id,
      definitionId: instance.definitionId,
      title: instance.title,
      faceValue,
      points: award.points,
      timing: award.timing,
      daysLate: award.daysLate,
      completedAt: nowIso(),
    };
    await storage.insertPointEvent(grant);
    return grant;
  }

  /**
   * Record the revocation for a reopen: cancels the instance's outstanding
   * (un-revoked) grant, naming the user it was taken from and the exact
   * amount. Returns null for pre-gamification completions, which have no
   * grant to revoke (no retroactive points, nothing to take back).
   */
  async function recordRevocation(instance: TaskInstance): Promise<PointRevocation | null> {
    const grants = (await activeGrants())
      .filter((g) => g.instanceId === instance.id)
      .sort((a, b) => a.completedAt.localeCompare(b.completedAt));
    const grant = grants.at(-1);
    if (!grant) return null;
    const revocation: PointRevocation = {
      id: randomUUID(),
      kind: 'revocation',
      grantId: grant.id,
      userId: grant.userId,
      instanceId: grant.instanceId,
      points: grant.points,
      reopenedAt: nowIso(),
    };
    await storage.insertPointEvent(revocation);
    return revocation;
  }

  return { activeGrants, recordCompletion, recordRevocation };
}

export type PointsService = ReturnType<typeof createPointsService>;
