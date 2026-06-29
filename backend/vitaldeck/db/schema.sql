-- vitaldeck local store.
-- raw_records is the source-of-truth firehose; every other table is a derived
-- projection we can always rebuild from it. foreign keys are declared but not
-- enforced (no PRAGMA foreign_keys = ON), matching how the app treats them.

PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS sync_runs (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at       TEXT NOT NULL,            -- iso8601
    finished_at      TEXT,
    source_capture   TEXT,                     -- path/name of the snoop capture
    status           TEXT NOT NULL DEFAULT 'running',  -- running|ok|error
    records_ingested INTEGER NOT NULL DEFAULT 0,
    records_deduped  INTEGER NOT NULL DEFAULT 0,
    notes            TEXT
);

CREATE TABLE IF NOT EXISTS raw_records (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    t_event_ms   INTEGER NOT NULL,             -- when the ring generated the event
    type         TEXT NOT NULL,
    sess         INTEGER NOT NULL DEFAULT -1,
    ctr          INTEGER NOT NULL DEFAULT -1,
    tag          TEXT,
    data_json    TEXT NOT NULL,                -- type-specific decoded fields
    sync_run_id  INTEGER,
    FOREIGN KEY (sync_run_id) REFERENCES sync_runs(id)
);
-- dedupe key: the same event seen across overlapping captures collapses to one
-- row, so re-running ingest on yesterday+today is safe (INSERT OR IGNORE).
CREATE UNIQUE INDEX IF NOT EXISTS ux_raw_dedup ON raw_records (t_event_ms, type, sess);
CREATE INDEX IF NOT EXISTS ix_raw_type_time ON raw_records (type, t_event_ms);

CREATE TABLE IF NOT EXISTS sleep_sessions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    date         TEXT NOT NULL,                -- the local morning the session ended
    start_ms     INTEGER NOT NULL,
    end_ms       INTEGER NOT NULL,
    total_min    REAL,
    efficiency   REAL,                         -- 0-100, asleep / time-in-bed
    latency_min  REAL,
    deep_min     REAL,
    rem_min      REAL,
    light_min    REAL,
    awake_min    REAL,
    stages_json  TEXT,                         -- ordered [{stage,duration_s}] hypnogram
    sync_run_id  INTEGER,
    UNIQUE (start_ms, end_ms)
);
CREATE INDEX IF NOT EXISTS ix_sleep_date ON sleep_sessions (date);

CREATE TABLE IF NOT EXISTS daily_summaries (
    date                 TEXT PRIMARY KEY,     -- local YYYY-MM-DD
    resting_hr           REAL,                 -- lowest sustained nightly hr (bpm)
    hr_min               REAL,
    hr_max               REAL,
    hr_avg_day           REAL,
    hrv_rmssd            REAL,                 -- mean nightly rmssd (ms)
    spo2_avg             REAL,                 -- nightly mean spo2 (%)
    resp_rate            REAL,                 -- nightly mean respiratory rate (rpm)
    temp_mean_c          REAL,                 -- nightly mean skin temp; deviation is derived in metrics
    sleep_min            REAL,
    sleep_efficiency     REAL,
    sleep_latency_min    REAL,
    stage_breakdown_json TEXT,                 -- {deep_min,rem_min,light_min,awake_min}
    steps                INTEGER,
    met_high_min         REAL,                 -- minutes at high MET (active)
    source_sync_run_id   INTEGER
);

CREATE TABLE IF NOT EXISTS metrics (
    date             TEXT PRIMARY KEY,
    readiness_custom REAL,                     -- 0-100 our composite
    components_json  TEXT,                     -- per-component subscores (explainable)
    baselines_json   TEXT                      -- the baselines used, snapshotted
);

CREATE TABLE IF NOT EXISTS tags (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    ts_ms      INTEGER NOT NULL,               -- when the tagged thing happened
    label      TEXT NOT NULL,                  -- "late caffeine","gym","alcohol",...
    note       TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_tags_ts ON tags (ts_ms);
