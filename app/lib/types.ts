// mirroring every JSON shape the API returns (CONTRACTS §6). keeping these in
// sync with the backend is the whole point of having a typed client.

// a daily_summary row as the API hands it back (stage_breakdown parsed to object)
export interface DailySummary {
  date: string;
  resting_hr: number | null;
  hr_min: number | null;
  hr_max: number | null;
  hr_avg_day: number | null;
  hrv_rmssd: number | null;
  spo2_avg: number | null;
  resp_rate: number | null;
  temp_mean_c: number | null;
  sleep_min: number | null;
  sleep_efficiency: number | null;
  sleep_latency_min: number | null;
  // the API parses the stored stage_breakdown_json column and exposes it as
  // `stage_breakdown` (object). the *_json alias is kept only for safety.
  stage_breakdown?: StageBreakdown | string | null;
  stage_breakdown_json?: StageBreakdown | string | null;
  steps: number | null;
  met_high_min: number | null;
}

export interface StageBreakdown {
  deep_min?: number;
  rem_min?: number;
  light_min?: number;
  awake_min?: number;
}

// one readiness component as computed in metrics/readiness.py
export interface ReadinessComponent {
  value: number | null;
  baseline: number | null;
  subscore: number; // 0-1
  weight: number;
  note: string;
}

export interface ReadinessComponents {
  hrv: ReadinessComponent;
  resting_hr: ReadinessComponent;
  temp: ReadinessComponent;
  sleep: ReadinessComponent;
}

// the metrics row; components/baselines parsed back to objects by the API
export interface Metric {
  date?: string;
  readiness_custom: number | null;
  components: ReadinessComponents;
  baselines?: Record<string, unknown>;
}

export interface HealthResponse {
  status: string;
  db: boolean;
  data_as_of: number | null;
}

export interface SummaryResponse {
  date: string;
  summary: DailySummary;
  metric: Metric | null;
  data_as_of: number | null;
}

export type TrendMetric =
  | 'hrv_rmssd'
  | 'resting_hr'
  | 'temp_mean_c'
  | 'sleep_min'
  | 'spo2_avg'
  | 'readiness_custom';

export interface TrendPoint {
  date: string;
  value: number | null;
}

export interface TrendsResponse {
  metric: TrendMetric;
  points: TrendPoint[];
  baseline_14: number | null;
  baseline_30: number | null;
}

export interface SleepStage {
  stage: 'deep' | 'light' | 'rem' | 'awake';
  duration_s: number;
}

export interface SleepSession {
  id?: number;
  date: string;
  start_ms: number;
  end_ms: number;
  total_min: number | null;
  efficiency: number | null;
  latency_min: number | null;
  deep_min: number | null;
  rem_min: number | null;
  light_min: number | null;
  awake_min: number | null;
  // API exposes the parsed stages_json column as `stages` (the hypnogram timeline)
  stages?: SleepStage[] | string | null;
  stages_json?: SleepStage[] | string | null;
}

export interface SleepResponse {
  sessions: SleepSession[];
}

export interface MetricsPoint {
  date: string;
  readiness_custom: number | null;
  components: ReadinessComponents;
}

export interface MetricsResponse {
  points: MetricsPoint[];
}

export interface Tag {
  id: number;
  ts_ms: number;
  label: string;
  note: string | null;
  created_at: string;
}

export interface TagsResponse {
  tags: Tag[];
}

export interface NewTag {
  ts_ms: number;
  label: string;
  note?: string;
}

export interface SyncResponse {
  ok: boolean;
  ingested: number;
  deduped: number;
  data_as_of: number | null;
  mode: 'live' | 'synthetic' | 'oura';
}

// live-ish current heart rate (the only intraday metric the Oura cloud exposes).
// bpm is null when the ring hasn't synced recently or no token is set.
export interface LiveResponse {
  ok: boolean;
  bpm: number | null;
  ts_ms: number | null;
  source: string | null;
  day_min: number | null;
  day_max: number | null;
  day_avg: number | null;
  count?: number | null;
  error?: string | null;
}

// every api call returns this envelope so screens can branch on ok vs error
// without a try/catch at every call site
export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };
