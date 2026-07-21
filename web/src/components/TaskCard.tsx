'use client';

import { useState } from 'react';
import { useUser } from '@/context/UserContext';
import { completeInstance, reassignInstance, reopenInstance } from '@/lib/api';
import { formatDateShort, formatTimeLocal } from '@/lib/dates';
import type { TaskInstance } from '@/lib/types';
import { AssigneeBadge } from './UserBadge';

interface TaskCardProps {
  instance: TaskInstance;
  /** True when rendered inside the Overdue group. */
  overdue: boolean;
  /** Called after any successful mutation so the parent can refetch. */
  onChanged: () => void;
}

const ANYONE = '__anyone__';

export function TaskCard({ instance, overdue, onChanged }: TaskCardProps) {
  const { me, users, userById } = useUser();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const completed = instance.status === 'completed';
  const completedByUser = userById(instance.completedBy);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <li
      className={`rounded-lg border bg-white p-3 shadow-sm ${
        completed ? 'border-neutral-200 opacity-75' : overdue ? 'border-red-300 bg-red-50' : 'border-neutral-200'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={`font-medium ${completed ? 'text-neutral-400 line-through' : 'text-neutral-900'}`}>
            {instance.title}
          </p>
          {instance.description && (
            <p className={`mt-0.5 text-sm ${completed ? 'text-neutral-400' : 'text-neutral-600'}`}>
              {instance.description}
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
            <AssigneeBadge assigneeId={instance.assigneeId} />
            <span>due {formatDateShort(instance.dueDate)}</span>
            {overdue && !completed && <span className="font-semibold text-red-600">overdue</span>}
            {completed && instance.completedAt && (
              <span className="text-neutral-500">
                done by {completedByUser?.name ?? 'Unknown'} at {formatTimeLocal(instance.completedAt)}
              </span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          {completed ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(() => reopenInstance(instance.id))}
              className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-100 disabled:opacity-50"
            >
              Reopen
            </button>
          ) : (
            <button
              type="button"
              disabled={busy || !me}
              onClick={() => void run(() => completeInstance(instance.id, me!.id))}
              className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              Complete
            </button>
          )}

          {!completed && (
            <label className="flex items-center gap-1 text-xs text-neutral-500">
              <span>for</span>
              <select
                value={instance.assigneeId ?? ANYONE}
                disabled={busy}
                onChange={(e) =>
                  void run(() => reassignInstance(instance.id, e.target.value === ANYONE ? null : e.target.value))
                }
                className="rounded-md border border-neutral-300 bg-white px-1.5 py-1 text-xs text-neutral-700 disabled:opacity-50"
              >
                <option value={ANYONE}>Anyone</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
                {/* Keep an orphaned (deleted) assignee selectable so the select stays controlled. */}
                {instance.assigneeId !== null && !userById(instance.assigneeId) && (
                  <option value={instance.assigneeId}>Unknown</option>
                )}
              </select>
            </label>
          )}
        </div>
      </div>

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </li>
  );
}
