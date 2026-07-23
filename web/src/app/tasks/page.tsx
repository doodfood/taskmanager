'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { TaskForm, type TaskFormValues } from '@/components/TaskForm';
import { AssigneeBadge } from '@/components/UserBadge';
import { useUser } from '@/context/UserContext';
import { deleteDefinition, listDefinitions, updateDefinition } from '@/lib/api';
import { formatDateShort } from '@/lib/dates';
import { recurrenceLabel, type TaskDefinition } from '@/lib/types';

function dueOffsetLabel(n: number): string {
  return n === 0 ? 'Same day' : `+${n} day${n === 1 ? '' : 's'}`;
}

/** Manager for task templates (definitions) — view, edit, deactivate, delete. */
export default function ManageTasksPage() {
  const { me, loading: userLoading } = useUser();
  const [defs, setDefs] = useState<TaskDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  /** Row with a toggle/delete request in flight. */
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setDefs(await listDefinitions());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load task templates');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch; state updates happen after awaits
    void load();
  }, [load]);

  // Active templates first, then alphabetical.
  const sorted = useMemo(
    () => [...defs].sort((a, b) => (a.active === b.active ? a.title.localeCompare(b.title) : a.active ? -1 : 1)),
    [defs],
  );

  async function saveEdit(def: TaskDefinition, values: TaskFormValues) {
    await updateDefinition(def.id, {
      title: values.title,
      description: values.description,
      recurrence: values.recurrence,
      assigneeId: values.assigneeId,
      dueOffsetDays: values.dueOffsetDays,
      startDate: values.startDate,
    });
    setEditingId(null);
    await load();
  }

  async function runRowAction(def: TaskDefinition, action: () => Promise<void>) {
    setBusyId(def.id);
    setError(null);
    try {
      await action();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusyId(null);
    }
  }

  const toggleActive = (def: TaskDefinition) => runRowAction(def, () => updateDefinition(def.id, { active: !def.active }).then(() => undefined));

  const remove = (def: TaskDefinition) =>
    runRowAction(def, async () => {
      if (
        !window.confirm(
          `Delete “${def.title}”? Its pending occurrences are removed too; completed ones stay as history.`,
        )
      ) {
        return;
      }
      await deleteDefinition(def.id);
      setEditingId((id) => (id === def.id ? null : id));
    });

  if (userLoading || !me) {
    return (
      <main className="mx-auto w-full max-w-5xl px-4 py-10">
        <p className="text-neutral-500">Loading…</p>
      </main>
    );
  }

  const thCls = 'px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500';

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6">
      <Link href="/" className="text-sm text-neutral-500 underline underline-offset-2 hover:text-neutral-800">
        ← Back to dashboard
      </Link>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold">Manage tasks</h1>
        <Link
          href="/tasks/new"
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
        >
          + New task
        </Link>
      </div>
      <p className="mt-1 text-sm text-neutral-500">
        These are the templates the dashboard&rsquo;s occurrences are generated from. Edits apply to{' '}
        <strong>future occurrences only</strong> — tasks already on the dashboard keep the title, description and
        assignee they were created with.
      </p>

      {error && (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => void load()}
            className="shrink-0 rounded-md border border-red-300 px-2 py-1 text-xs font-medium hover:bg-red-100"
          >
            Retry
          </button>
        </div>
      )}

      {loading ? (
        <p className="mt-6 text-neutral-500">Loading templates…</p>
      ) : sorted.length === 0 ? (
        <p className="mt-6 rounded-lg border border-neutral-200 bg-white p-6 text-center text-neutral-500">
          No task templates yet. <Link href="/tasks/new" className="text-indigo-600 underline underline-offset-2">Create one</Link>.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-lg border border-neutral-200 bg-white shadow-sm">
          <table className="w-full min-w-[760px] border-collapse text-sm">
            <thead className="border-b border-neutral-200 bg-neutral-50">
              <tr>
                <th className={thCls}>Task</th>
                <th className={thCls}>Repeats</th>
                <th className={thCls}>Starts</th>
                <th className={thCls}>Assigned to</th>
                <th className={thCls}>Due</th>
                <th className={thCls}>State</th>
                <th className={thCls}>Last hydrated</th>
                <th className={`${thCls} text-right`}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((def) => (
                <DefinitionRow
                  key={def.id}
                  def={def}
                  editing={editingId === def.id}
                  busy={busyId === def.id}
                  onEdit={() => setEditingId((id) => (id === def.id ? null : def.id))}
                  onCancelEdit={() => setEditingId(null)}
                  onSave={(values) => saveEdit(def, values)}
                  onToggleActive={() => void toggleActive(def)}
                  onDelete={() => void remove(def)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

interface RowProps {
  def: TaskDefinition;
  editing: boolean;
  busy: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSave: (values: TaskFormValues) => Promise<void>;
  onToggleActive: () => void;
  onDelete: () => void;
}

function DefinitionRow({ def, editing, busy, onEdit, onCancelEdit, onSave, onToggleActive, onDelete }: RowProps) {
  const actionCls = 'text-sm underline underline-offset-2 disabled:opacity-50 disabled:no-underline';
  return (
    <>
      <tr className={`border-b border-neutral-100 align-top ${def.active ? '' : 'bg-neutral-50 text-neutral-400'}`}>
        <td className="px-3 py-2.5">
          <div className={`font-medium ${def.active ? 'text-neutral-900' : ''}`}>{def.title}</div>
          {def.description && <div className="mt-0.5 max-w-xs truncate text-xs text-neutral-500">{def.description}</div>}
        </td>
        <td className="px-3 py-2.5 whitespace-nowrap">{recurrenceLabel(def.recurrence)}</td>
        <td className="px-3 py-2.5 whitespace-nowrap">{def.startDate ? formatDateShort(def.startDate) : '—'}</td>
        <td className="px-3 py-2.5">
          <AssigneeBadge assigneeId={def.assigneeId} />
        </td>
        <td className="px-3 py-2.5 whitespace-nowrap">{dueOffsetLabel(def.dueOffsetDays)}</td>
        <td className="px-3 py-2.5">
          {def.active ? (
            <span className="inline-block rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
              Active
            </span>
          ) : (
            <span className="inline-block rounded-full bg-neutral-200 px-2 py-0.5 text-xs font-medium text-neutral-600">
              Inactive
            </span>
          )}
        </td>
        <td className="px-3 py-2.5 whitespace-nowrap">
          {def.lastHydratedDate ? formatDateShort(def.lastHydratedDate) : '—'}
        </td>
        <td className="px-3 py-2.5 text-right whitespace-nowrap">
          <button type="button" disabled={busy} onClick={onEdit} className={`${actionCls} text-indigo-600 hover:text-indigo-800`}>
            {editing ? 'Close' : 'Edit'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onToggleActive}
            className={`${actionCls} ml-3 text-neutral-600 hover:text-neutral-800`}
          >
            {def.active ? 'Deactivate' : 'Reactivate'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onDelete}
            className={`${actionCls} ml-3 text-red-600 hover:text-red-800`}
          >
            Delete
          </button>
        </td>
      </tr>
      {editing && (
        <tr className="border-b border-neutral-100 bg-indigo-50/40">
          <td colSpan={8} className="px-3 py-4">
            <TaskForm
              initial={def}
              submitLabel="Save changes"
              busyLabel="Saving…"
              onSubmit={onSave}
              onCancel={onCancelEdit}
              hint={
                <p className="text-xs text-neutral-500">
                  Edits apply to <strong>future occurrences only</strong> — occurrences already on the dashboard keep
                  the title, description and assignee they were created with. Changing the first occurrence date does
                  not move occurrences that have already been generated. Deactivating stops new occurrences from being
                  generated.
                </p>
              }
            />
          </td>
        </tr>
      )}
    </>
  );
}
