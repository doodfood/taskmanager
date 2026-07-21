import type { ClockState, Recurrence, TaskDefinition, TaskInstance, User } from './types';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

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
  /** null / undefined = "anyone" */
  assigneeId?: string | null;
  dueOffsetDays?: number;
}

export const createDefinition = (input: CreateDefinitionInput) =>
  request<TaskDefinition>('/task-definitions', { method: 'POST', body: JSON.stringify(input) });

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

// ---- debug clock (dev tool) -------------------------------------------------

export const getClock = () => request<ClockState>('/debug/clock');

/** Pass a yyyy-MM-dd date to spoof, or null to reset. Re-runs hydration server-side. */
export const setClock = (date: string | null) =>
  request<ClockState & { hydrated?: number }>('/debug/clock', { method: 'POST', body: JSON.stringify({ date }) });

export const resetClock = () => request<ClockState>('/debug/clock', { method: 'DELETE' });
