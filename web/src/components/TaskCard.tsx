'use client';

import { useState } from 'react';
import { useUser } from '@/context/UserContext';
import { completeInstance, reassignInstance, reopenInstance } from '@/lib/api';
import { formatDateShort, formatTimeLocal } from '@/lib/dates';
import type { TaskInstance } from '@/lib/types';
import { pointsForCompletionToday } from '@/lib/scoring';
import { AssigneeBadge } from './UserBadge';

interface TaskCardProps {
  instance: TaskInstance;
  /** Server's effective current date, including when the debug clock is spoofed. */
  today: string;
  /** True when rendered inside the Overdue group. */
  overdue: boolean;
  /** Called after any successful mutation so the parent can refetch. */
  onChanged: () => void;
}

const ANYONE = '__anyone__';

export function TaskCard({ instance, today, overdue, onChanged }: TaskCardProps) {
  const { me, users, userById } = useUser();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const completed = instance.status === 'completed';
  const completedByUser = userById(instance.completedBy);

  // Credit the assignee, not whoever happens to have the page open — the
  // overview board is shared, so the viewer is rarely the doer. Unassigned
  // ("Anyone") tasks and tasks whose assignee was deleted have no one to
  // credit, so the person tapping Complete takes the credit there (the
  // server also rejects completedBy ids that aren't existing users).
  const completerId =
    instance.assigneeId !== null && userById(instance.assigneeId) ? instance.assigneeId : me?.id;

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
            {/* Completed cards show the points actually earned. Pending cards
                show the award for completing on the server's current date. */}
            {completed && instance.pointsAwarded != null ? (
              <span className="font-semibold text-emerald-600">
                +{instance.pointsAwarded} pt{instance.pointsAwarded === 1 ? '' : 's'}
              </span>
            ) : (
              <span>
                {pointsForCompletionToday(instance.points ?? 0, instance.occurrenceDate, instance.dueDate, today)} pt
                {pointsForCompletionToday(instance.points ?? 0, instance.occurrenceDate, instance.dueDate, today) === 1
                  ? ''
                  : 's'}
              </span>
            )}
            {/* "for" = the occurrence day — when the task becomes actionable.
                Only shown when it differs from the due date (dueOffsetDays > 0);
                otherwise the due date already carries the same information. */}
            {instance.occurrenceDate !== instance.dueDate && (
              <span>for {formatDateShort(instance.occurrenceDate)}</span>
            )}
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
              disabled={busy || !completerId}
              onClick={() => void run(() => completeInstance(instance.id, completerId!))}
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
