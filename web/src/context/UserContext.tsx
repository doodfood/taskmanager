'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { listUsers } from '@/lib/api';
import type { User } from '@/lib/types';

const STORAGE_KEY = 'tm.userId';

interface UserContextValue {
  /** The currently selected household member (null until picked / after deletion). */
  me: User | null;
  users: User[];
  /** True until the first users fetch resolves. */
  loading: boolean;
  error: string | null;
  /** Persist identity to localStorage and go to the dashboard. */
  selectUser: (user: User) => void;
  /** Forget identity and go back to the picker. */
  switchUser: () => void;
  /** Re-fetch users and re-validate the stored identity. Returns the fresh list. */
  refreshUsers: () => Promise<User[]>;
  /** Resolve a (possibly deleted) user id; null id = "anyone". */
  userById: (id: string | null) => User | null;
}

const UserContext = createContext<UserContextValue | null>(null);

export function UserProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [users, setUsers] = useState<User[]>([]);
  const [me, setMe] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshUsers = useCallback(async (): Promise<User[]> => {
    try {
      const list = await listUsers();
      setUsers(list);
      setError(null);
      // Validate the stored identity — the user may have been deleted server-side.
      const storedId = window.localStorage.getItem(STORAGE_KEY);
      const found = storedId ? (list.find((u) => u.id === storedId) ?? null) : null;
      if (storedId && !found) window.localStorage.removeItem(STORAGE_KEY);
      setMe(found);
      return list;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users');
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch; state updates happen after the await
    void refreshUsers();
  }, [refreshUsers]);

  // First visit (or a deleted identity): force the user picker.
  useEffect(() => {
    if (!loading && !me && pathname !== '/users') {
      router.replace('/users');
    }
  }, [loading, me, pathname, router]);

  const selectUser = useCallback(
    (user: User) => {
      window.localStorage.setItem(STORAGE_KEY, user.id);
      setMe(user);
      router.push('/');
    },
    [router],
  );

  const switchUser = useCallback(() => {
    window.localStorage.removeItem(STORAGE_KEY);
    setMe(null);
    router.push('/users');
  }, [router]);

  const userById = useCallback((id: string | null) => (id ? (users.find((u) => u.id === id) ?? null) : null), [users]);

  const value = useMemo(
    () => ({ me, users, loading, error, selectUser, switchUser, refreshUsers, userById }),
    [me, users, loading, error, selectUser, switchUser, refreshUsers, userById],
  );

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}

export function useUser(): UserContextValue {
  const ctx = useContext(UserContext);
  if (!ctx) throw new Error('useUser must be used inside <UserProvider>');
  return ctx;
}
