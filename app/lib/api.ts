// typed client for the VitalDeck FastAPI backend (CONTRACTS §6). every call is
// wrapped so a dropped connection on the Pi never throws into a screen — it
// comes back as { ok:false, error } and the UI renders an error state instead.
import type {
  ApiResult,
  HealthResponse,
  MetricsResponse,
  NewTag,
  SleepResponse,
  SummaryResponse,
  SyncResponse,
  Tag,
  TagsResponse,
  TrendMetric,
  TrendsResponse,
} from './types';
import { getApiBaseUrl } from './settings';

// base url is resolved at call time from the runtime settings cache (in-app value
// > EXPO_PUBLIC_API_URL > the Pi's Tailscale url baked in as the default). that
// way the standalone build always reaches the Pi no matter how it was bundled
// (EXPO_PUBLIC_* doesn't reliably propagate into eas update), and the in-app
// settings field (TODO 4) can repoint it without a rebuild.

// shared fetch wrapper — does the json parse, http-status check, and turns any
// thrown network error into a typed result
async function request<T>(
  path: string,
  init?: RequestInit,
): Promise<ApiResult<T>> {
  const url = `${getApiBaseUrl()}${path}`;
  try {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      ...init,
    });
    if (!res.ok) {
      // pulling whatever body text the server gave us for a useful message
      let detail = '';
      try {
        detail = await res.text();
      } catch {
        // ignore — the status line alone is enough
      }
      return {
        ok: false,
        error: `HTTP ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`,
      };
    }
    try {
      const data = (await res.json()) as T;
      return { ok: true, data };
    } catch (e) {
      return { ok: false, error: `bad json from ${path}` };
    }
  } catch (e) {
    // network down / Pi asleep / wrong url — the common field failure
    const msg = e instanceof Error ? e.message : 'network error';
    return { ok: false, error: msg };
  }
}

// throwing variant for use inside react-query queryFns (query treats a thrown
// error as the error state, which is exactly what we want there)
async function unwrap<T>(p: Promise<ApiResult<T>>): Promise<T> {
  const r = await p;
  if (r.ok) return r.data;
  throw new Error(r.error);
}

// --- reads -----------------------------------------------------------------

export const getHealth = () => request<HealthResponse>('/health');

export const getToday = () => unwrap(request<SummaryResponse>('/summary/today'));

export const getSummary = (date: string) =>
  unwrap(request<SummaryResponse>(`/summary/${encodeURIComponent(date)}`));

export const getTrends = (metric: TrendMetric, days = 30) =>
  unwrap(
    request<TrendsResponse>(
      `/trends?metric=${encodeURIComponent(metric)}&days=${days}`,
    ),
  );

export const getSleep = (days = 30) =>
  unwrap(request<SleepResponse>(`/sleep?days=${days}`));

export const getMetrics = (days = 30) =>
  unwrap(request<MetricsResponse>(`/metrics?days=${days}`));

export const getTags = (days?: number) =>
  unwrap(
    request<TagsResponse>(
      days != null ? `/tags?days=${days}` : '/tags',
    ),
  );

// --- writes ----------------------------------------------------------------

export const postSync = () =>
  unwrap(request<SyncResponse>('/sync', { method: 'POST' }));

export const createTag = (tag: NewTag) =>
  unwrap(
    request<Tag>('/tags', {
      method: 'POST',
      body: JSON.stringify(tag),
    }),
  );

export const deleteTag = (id: number) =>
  unwrap(request<{ deleted: boolean }>(`/tags/${id}`, { method: 'DELETE' }));
