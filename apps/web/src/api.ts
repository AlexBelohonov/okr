import { accountSessionSchema, apiErrorSchema, readinessSchema } from '@okr/shared';

export class RequestError extends Error { constructor(public status: number, message: string) { super(message); } }
export async function accountRequest<T>(path: string, method = 'GET', payload?: unknown, csrf?: string): Promise<T> {
  return apiRequest<T>(`auth/${path}`, method, payload, csrf);
}
export async function apiRequest<T>(path: string, method = 'GET', payload?: unknown, csrf?: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/v1/${path}`, { method, signal, credentials: 'same-origin', headers: payload === undefined ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf || '' }, body: payload === undefined ? undefined : JSON.stringify(payload) });
  const body: unknown = await response.json();
  if (!response.ok) {
    const error = apiErrorSchema.safeParse(body);
    const detail = error.success ? error.data.error.details?.[0]?.message : undefined;
    throw new RequestError(response.status, detail || (error.success ? error.data.error.message : 'Request failed'));
  }
  return body as T;
}
export async function getAccount() { return accountSessionSchema.parse(await accountRequest('session')); }

export async function getReadiness(signal?: AbortSignal) {
  const response = await fetch('/api/v1/ready', { signal, credentials: 'same-origin' });
  const body: unknown = await response.json();
  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(body);
    throw new Error(parsed.success ? parsed.data.error.message : 'Service unavailable');
  }
  return readinessSchema.parse(body);
}
