'use client';

import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { useUser } from '@/context/UserContext';
import { toDateStr } from '@/lib/dates';
import { RECURRENCES, recurrenceLabel, type Recurrence, type TaskDefinition } from '@/lib/types';

const RECURRENCE_OPTIONS: { value: Recurrence; label: string }[] = RECURRENCES.map((value) => ({
  value,
  label: value === 'none' ? 'One-off (does not repeat)' : recurrenceLabel(value),
}));

/** Field values the form produces. */
export interface TaskFormValues {
  title: string;
  /** Trimmed; may be an empty string (callers decide undefined-vs-empty semantics). */
  description: string;
  recurrence: Recurrence;
  /** Difficulty estimate (0–100). */
  points: number;
  /** Users new occurrences may be auto-assigned to (least busy wins); empty = no auto-assignment. */
  autoAssignableTo: string[];
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
  const [points, setPoints] = useState(initial?.points ?? 1);
  const [autoAssignableTo, setAutoAssignableTo] = useState<string[]>(initial?.autoAssignableTo ?? []);
  const [dueOffsetDays, setDueOffsetDays] = useState(initial?.dueOffsetDays ?? 0);
  const [startDate, setStartDate] = useState(initial?.startDate ?? toDateStr(new Date()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleAutoAssignable(userId: string) {
    setAutoAssignableTo((current) =>
      current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId],
    );
  }

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
        points,
        autoAssignableTo,
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
          <label htmlFor={`${uid}-points`} className="mb-1 block text-sm font-medium">
            Points
          </label>
          <input
            id={`${uid}-points`}
            type="number"
            min={0}
            max={100}
            value={points}
            onChange={(e) => setPoints(Math.min(100, Math.max(0, Number(e.target.value) || 0)))}
            className={inputCls}
          />
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

      <fieldset>
        <legend className="mb-1 text-sm font-medium">
          Auto-assign to <span className="font-normal text-neutral-400">(optional)</span>
        </legend>
        <p className="mb-2 text-xs text-neutral-500">
          Tick the people this task can be given to automatically. Each new occurrence goes to whoever has the fewest
          outstanding points; with nobody ticked, occurrences are created for Anyone.
        </p>
        <div className="flex flex-wrap gap-2">
          {users.map((u) => {
            const checked = autoAssignableTo.includes(u.id);
            return (
              <label
                key={u.id}
                className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-sm ${
                  checked
                    ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                    : 'border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-50'
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleAutoAssignable(u.id)}
                  className="accent-indigo-600"
                />
                {u.name}
              </label>
            );
          })}
        </div>
      </fieldset>

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
