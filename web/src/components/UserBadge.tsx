'use client';

import type { ReactNode } from 'react';
import { useUser } from '@/context/UserContext';

/** Small pill with a colour dot. Grey dot when colour is null (Anyone / Unknown). */
export function Badge({ color, children }: { color: string | null; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-700">
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color ?? '#a3a3a3' }} />
      {children}
    </span>
  );
}

/**
 * Assignee pill for a task. Handles the three cases: null → "Anyone",
 * known id → name + colour, deleted user id → "Unknown" (grey).
 */
export function AssigneeBadge({ assigneeId }: { assigneeId: string | null }) {
  const { userById } = useUser();
  if (assigneeId === null) return <Badge color={null}>Anyone</Badge>;
  const user = userById(assigneeId);
  return <Badge color={user?.color ?? null}>{user?.name ?? 'Unknown'}</Badge>;
}
