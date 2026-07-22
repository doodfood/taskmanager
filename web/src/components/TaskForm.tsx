'use client';

import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { useUser } from '@/context/UserContext';
import { toDateStr } from '@/lib/dates';
import type { Recurrence, TaskDefinition } from '@/lib/types';

const ANYONE = '__anyone__';

const RECURRENCE_OPTIONS: { value: Recurrence; label: string }[] = [
  { value: 'none', label: 'One-off (does not repeat)' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
];

/** Field values the form produces. `assigneeId: null` means "anyone". */
export interface TaskFormValues {
  title: string;
  /** Trimmed; may be an empty string (callers decide undefined-vs-empty semantics). */
  description: string;
  recurrence: Recurrence;
  assigneeId: string | null;
  dueOffsetDays: number;
  /** yyyy-MM-dd of the first occurrence (the form always produces a concrete date). */
  startDate: string;
}

interface TaskFormProps {
  /** Definition to edit; omit for a blank create form. */
  initial?: TaskDefinition;
  submitLabel: string;
  busyLabel: string;
  /** Throwing leaves the form open and shows the error message. */
  onSubmit: (values: TaskFormValues) => Promise<void>;
  onCancel: () => void;
  /** Optional hint rendered between the fields and the buttons (e.g. caveats). */
  hint?: ReactNode;
}

/** Shared create/edit form for task definitions (used by /tasks/new and the /tasks manager). */
export function TaskForm({ initial, submitLabel, busyLabel, onSubmit, onCancel, hint }: TaskFormProps) {
  const uid = useId();
  const { users } = useUser();
  const [title, setTitle] = useState(initial?.title ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [recurrence, setRecurrence] = useState<Recurrence>(initial?.recurrence ?? 'none');
  const [assigneeId, setAssigneeId] = useState<string>(initial?.assigneeId ?? ANYONE);
  const [dueOffsetDays, setDueOffsetDays] = useState(initial?.dueOffsetDays ?? 0);
  const [startDate, setStartDate] = useState(initial?.startDate ?? toDateStr(new Date()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit({
        title: title.trim(),
        description: description.trim(),
        recurrence,
        assigneeId: assigneeId === ANYONE ? null : assigneeId,
        dueOffsetDays,
        startDate,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save task');
      setBusy(false);
    }
  }

  const inputCls =
    'w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none';

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-4">
      <div>
        <label htmlFor={`${uid}-title`} className="mb-1 block text-sm font-medium">
          Title
        </label>
        <input
          id={`${uid}-title`}
          type="text"
          required
          maxLength={200}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Take the bins out"
          className={inputCls}
        />
      </div>

      <div>
        <label htmlFor={`${uid}-description`} className="mb-1 block text-sm font-medium">
          Description <span className="font-normal text-neutral-400">(optional)</span>
        </label>
        <textarea
          id={`${uid}-description`}
          rows={3}
          maxLength={2000}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className={inputCls}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label htmlFor={`${uid}-recurrence`} className="mb-1 block text-sm font-medium">
            Repeats
          </label>
          <select
            id={`${uid}-recurrence`}
            value={recurrence}
            onChange={(e) => setRecurrence(e.target.value as Recurrence)}
            className={inputCls}
          >
            {RECURRENCE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor={`${uid}-startDate`} className="mb-1 block text-sm font-medium">
            First occurrence on
          </label>
          <input
            id={`${uid}-startDate`}
            type="date"
            required
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className={inputCls}
          />
        </div>

        <div>
          <label htmlFor={`${uid}-assignee`} className="mb-1 block text-sm font-medium">
            Assigned to
          </label>
          <select
            id={`${uid}-assignee`}
            value={assigneeId}
            onChange={(e) => setAssigneeId(e.target.value)}
            className={inputCls}
          >
            <option value={ANYONE}>Anyone</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor={`${uid}-dueOffset`} className="mb-1 block text-sm font-medium">
            Due after (days)
          </label>
          <input
            id={`${uid}-dueOffset`}
            type="number"
            min={0}
            max={365}
            value={dueOffsetDays}
            onChange={(e) => setDueOffsetDays(Math.max(0, Number(e.target.value) || 0))}
            className={inputCls}
          />
        </div>
      </div>

      {hint}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-100 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={busy || !title.trim()}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {busy ? busyLabel : submitLabel}
        </button>
      </div>
    </form>
  );
}
