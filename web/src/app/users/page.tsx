'use client';

import { useState, type FormEvent } from 'react';
import { useUser } from '@/context/UserContext';
import { createUser, deleteUser } from '@/lib/api';
import type { User } from '@/lib/types';

export default function UsersPage() {
  const { me, users, loading, error, selectUser, refreshUsers } = useUser();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function addUser(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    setFormError(null);
    try {
      await createUser(trimmed); // colour auto-assigned server-side
      setName('');
      await refreshUsers();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to add user');
    } finally {
      setBusy(false);
    }
  }

  async function removeUser(user: User) {
    if (!window.confirm(`Remove ${user.name}? Tasks they completed stay in history.`)) return;
    setFormError(null);
    try {
      await deleteUser(user.id);
      // Revalidates the stored identity — if we just deleted ourselves, `me` becomes null.
      await refreshUsers();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to remove user');
    }
  }

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
      <h1 className="text-xl font-bold">Who are you?</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Trust-based, household-only — pick your name. {me && `You're currently ${me.name}; pick another to switch.`}
      </p>

      {loading ? (
        <p className="mt-6 text-neutral-500">Loading users…</p>
      ) : error ? (
        <p className="mt-6 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : (
        <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {users.map((u) => (
            <li key={u.id} className="relative">
              <button
                type="button"
                onClick={() => selectUser(u)}
                className={`flex w-full flex-col items-center gap-2 rounded-lg border bg-white p-4 shadow-sm hover:border-indigo-400 hover:shadow ${
                  me?.id === u.id ? 'border-indigo-500 ring-1 ring-indigo-500' : 'border-neutral-200'
                }`}
              >
                <span
                  className="flex h-10 w-10 items-center justify-center rounded-full text-lg font-bold text-white"
                  style={{ backgroundColor: u.color }}
                >
                  {u.name.charAt(0).toUpperCase()}
                </span>
                <span className="text-sm font-medium">{u.name}</span>
              </button>
              <button
                type="button"
                title={`Remove ${u.name}`}
                onClick={() => void removeUser(u)}
                className="absolute right-1.5 top-1.5 rounded-full px-1.5 text-xs text-neutral-400 hover:bg-neutral-100 hover:text-red-600"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={(e) => void addUser(e)} className="mt-8 flex items-center gap-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Add a household member…"
          maxLength={50}
          className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={busy || !name.trim()}
          className="shrink-0 rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          Add
        </button>
      </form>

      {formError && <p className="mt-2 text-sm text-red-600">{formError}</p>}
    </main>
  );
}
