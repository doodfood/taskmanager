'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { useUser } from '@/context/UserContext';
import { createDefinition } from '@/lib/api';
import type { Recurrence } from '@/lib/types';

const ANYONE = '__anyone__';

const RECURRENCE_OPTIONS: { value: Recurrence; label: string }[] = [
  { value: 'none', label: 'One-off (does not repeat)' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
];

export default function NewTaskPage() {
  const router = useRouter();
  const { me, users, loading: userLoading } = useUser();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [recurrence, setRecurrence] = useState<Recurrence>('none');
  const [assigneeId, setAssigneeId] = useState<string>(ANYONE);
  const [dueOffsetDays, setDueOffsetDays] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await createDefinition({
        title: title.trim(),
        description: description.trim() || undefined,
        recurrence,
        assigneeId: assigneeId === ANYONE ? null : assigneeId,
        dueOffsetDays,
      });
      router.push('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create task');
      setBusy(false);
    }
  }

  if (userLoading || !me) {
    return (
      <main className="mx-auto w-full max-w-2xl px-4 py-10">
        <p className="text-neutral-500">Loading…</p>
      </main>
    );
  }

  const inputCls =
    'w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none';

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-6">
      <Link href="/" className="text-sm text-neutral-500 underline underline-offset-2 hover:text-neutral-800">
        ← Back to dashboard
      </Link>
      <h1 className="mt-2 text-xl font-bold">New task</h1>

      <form onSubmit={(e) => void submit(e)} className="mt-4 space-y-4 rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
        <div>
          <label htmlFor="title" className="mb-1 block text-sm font-medium">
            Title
          </label>
          <input
            id="title"
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
          <label htmlFor="description" className="mb-1 block text-sm font-medium">
            Description <span className="font-normal text-neutral-400">(optional)</span>
          </label>
          <textarea
            id="description"
            rows={3}
            maxLength={2000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className={inputCls}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="recurrence" className="mb-1 block text-sm font-medium">
              Repeats
            </label>
            <select
              id="recurrence"
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
            <label htmlFor="assignee" className="mb-1 block text-sm font-medium">
              Assigned to
            </label>
            <select
              id="assignee"
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
            <label htmlFor="dueOffset" className="mb-1 block text-sm font-medium">
              Due after (days)
            </label>
            <input
              id="dueOffset"
              type="number"
              min={0}
              max={365}
              value={dueOffsetDays}
              onChange={(e) => setDueOffsetDays(Math.max(0, Number(e.target.value) || 0))}
              className={inputCls}
            />
          </div>
        </div>

        <p className="text-xs text-neutral-500">
          Recurring tasks materialise automatically; a one-off task is created for today. Setting due-after to 2 means
          each occurrence is due two days after it appears.
        </p>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2">
          <Link
            href="/"
            className="rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-100"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={busy || !title.trim()}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {busy ? 'Creating…' : 'Create task'}
          </button>
        </div>
      </form>
    </main>
  );
}
