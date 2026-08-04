import type { ClockState, LeaderboardEntry, Recurrence, TaskDefinition, TaskInstance, User, UserBadges } from './types';

const API_URL = '/api';

/** Thrown for `{ "error": "..." }` API responses and network failures. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      cache: 'no-store',
      ...init,
      headers: { 'Content-Type': 'application/json', ...init?.headers },
    });
  } catch {
    throw new ApiError(0, `Cannot reach the API at ${API_URL} — is the server running?`);
  }
  if (res.status === 204) return undefined as T;

  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      body !== null && typeof body === 'object' && 'error' in body && typeof (body as { error: unknown }).error === 'string'
        ? (body as { error: string }).error
        : `Request failed with status ${res.status}`;
    throw new ApiError(res.status, message);
  }
  return body as T;
}

// ---- health ---------------------------------------------------------------

export const health = () => request<{ ok: boolean; uptime: number }>('/health');

// ---- users ------------------------------------------------------------------

export const listUsers = () => request<User[]>('/users');

export const createUser = (name: string) =>
  request<User>('/users', { method: 'POST', body: JSON.stringify({ name }) });

export const deleteUser = (id: string) => request<void>(`/users/${id}`, { method: 'DELETE' });

// ---- task definitions -------------------------------------------------------

export interface CreateDefinitionInput {
  title: string;
  description?: string;
  recurrence?: Recurrence;
  /** Difficulty estimate (0–100); defaults to 10 server-side. */
  points?: number;
  /** Users new occurrences may be auto-assigned to (least busy wins); empty = no auto-assignment. */
  autoAssignableTo?: string[];
  dueOffsetDays?: number;
  /** yyyy-MM-dd of the first occurrence; null / undefined = anchor on the creation date */
  startDate?: string | null;
}

export const listDefinitions = () => request<TaskDefinition[]>('/task-definitions');

export const createDefinition = (input: CreateDefinitionInput) =>
  request<TaskDefinition>('/task-definitions', { method: 'POST', body: JSON.stringify(input) });

export type UpdateDefinitionInput = Partial<CreateDefinitionInput> & { active?: boolean };

export const updateDefinition = (id: string, input: UpdateDefinitionInput) =>
  request<TaskDefinition>(`/task-definitions/${id}`, { method: 'PATCH', body: JSON.stringify(input) });

/** Deletes the template and its PENDING instances; completed instances stay as history. */
export const deleteDefinition = (id: string) => request<void>(`/task-definitions/${id}`, { method: 'DELETE' });

// ---- task instances ---------------------------------------------------------

export interface ListInstancesParams {
  status?: 'pending' | 'completed';
  /** Pass null for "anyone" tasks; omit for no assignee filter. */
  assigneeId?: string | null;
  /** yyyy-MM-dd dueDate lower bound */
  from?: string;
  /** yyyy-MM-dd dueDate upper bound */
  to?: string;
  includeAnyone?: boolean;
}

export function listInstances(params: ListInstancesParams = {}) {
  const q = new URLSearchParams();
  if (params.status) q.set('status', params.status);
  if (params.assigneeId !== undefined) q.set('assigneeId', params.assigneeId === null ? 'null' : params.assigneeId);
  if (params.from) q.set('from', params.from);
  if (params.to) q.set('to', params.to);
  if (params.includeAnyone) q.set('includeAnyone', 'true');
  const qs = q.toString();
  return request<TaskInstance[]>(`/task-instances${qs ? `?${qs}` : ''}`);
}

export const upcoming = (userId: string, days = 7) =>
  request<TaskInstance[]>(`/task-instances/upcoming?userId=${encodeURIComponent(userId)}&days=${days}`);

export const completeInstance = (id: string, completedBy: string) =>
  request<TaskInstance>(`/task-instances/${id}/complete`, { method: 'POST', body: JSON.stringify({ completedBy }) });

export const reopenInstance = (id: string) =>
  request<TaskInstance>(`/task-instances/${id}/reopen`, { method: 'POST' });

export const reassignInstance = (id: string, assigneeId: string | null) =>
  request<TaskInstance>(`/task-instances/${id}/reassign`, { method: 'POST', body: JSON.stringify({ assigneeId }) });

// ---- badges -----------------------------------------------------------------

/**
 * Permanent awards + live (pending) evaluation for the current week. Reading
 * this also triggers the lazy Monday rollover server-side, so a fresh fetch
 * reflects any week boundary just crossed.
 */
export const getUserBadges = (userId: string) => request<UserBadges>(`/users/${userId}/badges`);

// ---- leaderboard ------------------------------------------------------------

/** Rolling-window sizes the leaderboard endpoint accepts. */
export type LeaderboardWeeks = 1 | 2 | 4 | 8;

/** Ranked points over the last N weeks (every user appears, even at 0). */
export const getLeaderboard = (weeks: LeaderboardWeeks = 1) =>
  request<LeaderboardEntry[]>(`/leaderboard?weeks=${weeks}`);

// ---- debug clock (dev tool) -------------------------------------------------

export const getClock = () => request<ClockState>('/debug/clock');

/** Rollover outcome returned alongside the clock state after a spoof jump. */
export interface ClockRollover {
  initialised: boolean;
  awardedWeekStart: string | null;
  awarded: number;
}

/** Pass a yyyy-MM-dd date to spoof, or null to reset. Re-runs hydration + badge rollover server-side. */
export const setClock = (date: string | null) =>
  request<ClockState & { hydrated?: number; rollover?: ClockRollover }>('/debug/clock', {
    method: 'POST',
    body: JSON.stringify({ date }),
  });

export const resetClock = () => request<ClockState>('/debug/clock', { method: 'DELETE' });

// ---- debug hydration reset (dev tool) ---------------------------------------

/** Deletes every hydrated task instance; returns how many were removed. */
export const clearInstances = () =>
  request<{ cleared: number }>('/debug/clear-instances', { method: 'POST' });

/** Sets lastHydratedDate back to null on every definition; returns how many changed. */
export const resetWatermarks = () =>
  request<{ reset: number }>('/debug/reset-watermarks', { method: 'POST' });

// ---- debug gamification reset (dev tool) ------------------------------------

/** Badge rollover watermark + epoch (both yyyy-MM-dd Mondays). */
export interface BadgeState {
  lastAwardedWeekStart: string;
  badgesEpoch: string;
}

/**
 * Rewinds the badge watermark + epoch to the Monday of the current server
 * week — unsticks awards after a spoofed jump ran a rollover in the future.
 */
export const resetBadgeState = () => request<BadgeState>('/debug/reset-badge-state', { method: 'POST' });

/**
 * Wipes the points ledger so everyone's balance returns to zero; also nulls
 * the pointsAwarded snapshot on completed instances.
 */
export const clearPoints = () =>
  request<{ cleared: number; snapshotsCleared: number }>('/debug/clear-points', { method: 'POST' });

/** Wipes the permanent badge award ledger (the rollover watermark + epoch are untouched). */
export const clearBadgeAwards = () =>
  request<{ cleared: number }>('/debug/clear-badge-awards', { method: 'POST' });
