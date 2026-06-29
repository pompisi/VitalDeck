# VitalDeck — code walkthrough (interview defense guide)

This is the document I'd read the night before talking about VitalDeck. It
explains what the project does, traces a single record all the way through the
pipeline, walks every backend module, and — most importantly — lays out *why*
each non-obvious decision was made, so I can defend it under questioning rather
than just describe it.

It's written for me (the owner), in my own voice, and it's honest about what's
mine, what's borrowed, and what's still synthetic.

---

## 1. The one-paragraph pitch

VitalDeck is a personal, local-only dashboard for my own Oura Ring data that
needs **no Oura subscription, no cloud account, no API keys, and no rooted
phone**. Instead of paying Oura for access to data my own ring already
generated, it reads the Bluetooth traffic the phone *already exchanged* with the
ring — which Android can be told to record into its HCI snoop log — decodes it
with the community `open_ring` driver, and turns it into a local SQLite store, a
custom explainable readiness score, and a small Expo app. The non-trivial part
isn't any single piece; it's the **systems integration**: stitching together a
phone capture toggle, `adb bugreport`, a reverse-engineered BLE protocol, the
AOSP btsnooz container format, a normalization/dedup layer, a derived-projection
data model, a personal-baseline metric, a FastAPI surface, and a mobile client —
and getting the data-engineering invariants (idempotency, event-time ordering,
cross-midnight night attribution) right so the numbers are trustworthy and
rebuildable. It's a batch pipeline by design: capture → decode → ingest on a
cadence, landing a few minutes behind real time, which is exactly the latency a
sleep/recovery tool needs.

---

## 2. End-to-end data flow (one record's journey)

Follow a single `hrv` reading from the ring to a number on the phone. Real
function names, in order:

1. **Ring → capture phone (BLE).** I open the official Oura app and let it sync.
   That sync is what makes the phone pull the ring's buffered readings over
   Bluetooth. With **Developer Options → Bluetooth HCI snoop log = Full**, the
   phone writes every BLE packet (including our HRV sample) into a rolling log.
   Nothing here is mine to write — Android does it; I just turned the toggle on.

2. **Phone → Pi (`adb bugreport`).** `ingest/pull_snoop.py::pull_bugreport()`
   shells out to `adb bugreport <out_dir>` over Tailscale and discovers the zip
   adb wrote by diffing the directory listing (`before`/`after` glob sets), since
   adb names the file itself.

3. **Extract the btsnoop bytes.** `pull_snoop.py::extract_btsnoop()` opens the
   zip and looks for any member whose name contains `btsnoop`. If a real
   `btsnoop_hci.log` is present it picks the freshest one via `_snoop_rank()`
   (live log beats `.last`/numbered rotations). If the device only embedded a
   compressed **btsnooz** blob in `bugreport-*.txt`, it falls through to
   `decode_btsnooz()`, which base64-decodes the blob, reads the 1-byte AOSP
   version header, and inflates the body (raw-deflate for v2, zlib stream for v1,
   with a fallback that tries both). Either way it writes
   `captures/btsnoop_hci.log`.

4. **Replay-decode via open_ring.** `ingest/decode.py::decode_capture()` shells
   out to `python -m driver.cli replay <capture>` with `cwd=vendor/open_ring`.
   open_ring is the reverse-engineered BLE protocol parser; it reads the raw
   btsnoop and prints one decoded record per line as JSONL on stdout. My code
   streams that stdout lazily and drains stderr on a background thread so a
   chatty replay can't deadlock the pipe; a nonzero exit raises `DecodeError`
   with the captured stderr.

5. **Normalize.** Each JSONL line goes through `records.py::parse_jsonl()` (skips
   blank/garbage lines) then `records.py::normalize()`. For our HRV record this:
   coerces a usable integer **`t_event_ms`** (ring event time — see §4),
   requires a string `type`, drops `rt` "ring_time" misparses at/above `2**31`
   (the filter open_ring's PROTOCOL.md §9.3 tells consumers to apply), and
   substitutes the `NO_SESSION = -1` sentinel when `sess`/`ctr` are missing.
   Output shape: `{t_event_ms, type, sess, ctr, tag, rt, raw_t, data}` where
   `data = {"rmssd_ms": 52.3}`.

6. **Ingest into SQLite (idempotent).** `db/store.py::ingest_records()` runs
   `INSERT OR IGNORE INTO raw_records ...`. The unique index
   `ux_raw_dedup (t_event_ms, type, sess)` means re-ingesting an overlapping
   capture silently collapses duplicates. It counts `ingested` vs `deduped`
   honestly and validates NOT-NULL fields up front so malformed rows are counted
   as `errored` (loudly logged) instead of vanishing into the deduped bucket. The
   batch is recorded against a `sync_runs` row (`start_sync_run` /
   `finish_sync_run`) for provenance.

7. **Summarize (raw → projections).** `summarize.py::rebuild_all()` reads the
   whole firehose (`store.get_all_records`) and calls `summarize_records()`,
   which buckets records by local day, builds `sleep_sessions` from contiguous
   `sleep_stage` runs, and folds each night's asleep-derived metrics (resting HR,
   **hrv_rmssd**, SpO2, resp, temp) onto the **sleep session's end-date**
   summary. Our HRV sample lands as the night's mean `hrv_rmssd` on that day's
   `daily_summaries` row.

8. **Baselines + readiness.** `metrics/baselines.py::compute_baselines()` builds
   trailing 14/30-day personal means (skipping `None`s). `metrics/readiness.py::
   compute_readiness()` compares today's `hrv_rmssd` against the 14-day baseline
   (higher = better), produces a subscore in `[0,1]` plus a human note, weights
   it (HRV is 0.40 of the score), and rounds the composite to a 0–100
   `readiness_custom`. `store.upsert_metric()` saves the score **with its
   components and baselines** so it stays explainable.

9. **API → app.** `api/main.py` serves `GET /summary/today` (the latest day +
   its metric) and `GET /trends?metric=hrv_rmssd` (the series + baseline band).
   The Expo client (`app/lib/api.ts`) fetches via TanStack Query; `app/index.tsx`
   renders the readiness ring, a `ComponentRow` HRV bar, and the "data as of"
   line driven by `store.latest_event_ms()`. Tapping **Sync** issues
   `POST /sync`, which re-runs steps 6–8 and invalidates the cache.

The whole chain after `raw_records` is **derived and disposable**: wipe
summaries/sessions/metrics and `rebuild_all()` reconstructs them from the raw
envelopes. That's the architectural spine.

---

## 3. Module-by-module

### `config.py` — one place for paths + tunables
**Job:** env-overridable configuration so the Pi, my dev box, and the tests
differ only by environment, not code. **Key:** `DB_PATH`, `OPEN_RING_DIR`,
`ADB_TARGET`, `READINESS_WEIGHTS` (must sum to 1.0), `BASELINE_WINDOWS=(14,30)`,
`SLEEP_TARGET_MIN=450`, `LOCAL_UTC_OFFSET_HOURS`. **Subtlety:** it lives *inside*
the `vitaldeck` package and computes paths from `__file__`, so imports resolve no
matter the cwd; `ADB_TARGET` defaulting to `""` is the switch that flips
`POST /sync` into synthetic mode.

### `records.py` — normalize + dedup key
**Job:** the choke point every decoded record passes through, so the rest of the
backend can assume clean, analytics-ready records. **Key functions:**
`normalize()` (coerce/validate/filter one envelope), `parse_jsonl()` (stream
decoded lines, skip junk), `dedup_key()` (the `(t_event_ms, type, sess)` tuple),
`iter_normalized()`. **Subtlety:** it uses `t_event_ms` not receive-time, and it
substitutes `NO_SESSION = -1` for missing `sess` because SQL `NULL`s compare as
*distinct* — leaving them NULL would silently defeat the unique-index dedup.

### `db/schema.sql` — the local store
**Job:** define the SQLite tables. **Key:** `raw_records` (firehose) with
`ux_raw_dedup (t_event_ms, type, sess)` UNIQUE + `ix_raw_type_time`; `sync_runs`
(provenance); `daily_summaries` (one row/local day); `sleep_sessions` (UNIQUE on
`start_ms, end_ms`); `metrics` (the score + JSON components/baselines); `tags`.
**Subtlety:** `PRAGMA journal_mode = WAL` for concurrent reads; foreign keys are
*declared but not enforced* (no `PRAGMA foreign_keys = ON`) — a deliberate match
to how a single-writer personal tool actually behaves.

### `db/store.py` — storage layer
**Job:** schema bootstrap, idempotent ingest, and reads that hand back plain
JSON-serializable dicts (callers never touch `sqlite3.Row` or raw JSON strings).
**Key functions:** `connect()`/`init_db()` (idempotent, all `CREATE IF NOT
EXISTS`), `ingest_records()`, the `upsert_*` writers, the `get_*` readers,
`latest_event_ms()`, tag CRUD. **Subtlety:** `_row_to_dict()` re-parses any
`*_json` column back into an object and renames it (`data_json` → `data`), so the
JSON serialization is an internal storage detail invisible to the API.
`ingest_records` adds an `errored` count on top of the contract's
`{ingested, deduped, by_type}` because `INSERT OR IGNORE` returns rowcount 0 for
*both* a dedup and a constraint failure — without the up-front validation, real
data loss would masquerade as harmless dedup.

### `summarize.py` — raw → daily summaries + sleep sessions
**Job:** the projection layer; turn the firehose into per-day rollups and
per-night sessions. **Key functions:** `summarize_records()` (pure,
side-effect-free, unit-testable), `rebuild_all()` (the only store-touching
piece), plus helpers `_bucket_by_day`, `_build_sleep_sessions`,
`_nightly_metrics`, `_session_from_run`, `_percentile`. **Subtlety:** nightly
asleep-derived metrics are computed over the *sleep-session window* and attributed
to the session's **end date**, not bucketed by raw local day — that's what stops
a night that crosses midnight from being split across two days (see §4). Daytime
HR comes only from `asleep=False` samples; a day with nothing but leaked nightly
samples returns `None` so no phantom pre-midnight row appears.

### `metrics/baselines.py` — rolling personal baselines
**Job:** trailing 14/30-day means of `hrv_rmssd`, `resting_hr`, `temp_mean_c`,
**per the owner's own history** rather than a population norm. **Key:**
`compute_baselines()` → `{field: {"14": x, "30": y}, "n_days": n}`. **Subtlety:**
each window skips `None` values so a sensor gap doesn't poison the mean, and it
defensively sorts so a dateless/None row sorts to the *front* (oldest) and can
never displace a genuinely-dated day from the trailing window.

### `metrics/readiness.py` — the custom explainable score
**Job:** compute *our* 0–100 readiness from raw signals vs. baselines, never
fetched from a cloud. **Key:** `compute_readiness()` (four subscores → weighted
sum → `round(100 * Σ(weight·subscore))`), `_hrv_subscore`/`_rhr_subscore`/
`_temp_subscore`/`_sleep_subscore`, `_explain()`, `temp_flag()`. **Subtlety:**
every component carries its value, baseline, subscore, weight, and a human note,
and `_explain()` names the biggest drag — so the number is never a black box. A
missing baseline degrades gracefully to a neutral 0.5 subscore with a "no
baseline yet" note, so a fresh install still produces a score. Note the sign
flip: higher HRV is good, lower resting HR is good.

### `ingest/decode.py` — replay shim to open_ring
**Job:** a thin, defensive adapter that shells out to open_ring's replay CLI and
streams its JSONL through the normalizer. **Key:** `decode_capture()` (subprocess
+ stream), `decode_text()` (pure, subprocess-free path for tests), `DecodeError`.
**Subtlety:** stderr is drained on a daemon thread so a >64KB stderr can't
deadlock against stdout; the `finally` block handles `GeneratorExit` (a
`BaseException`, so it slips past `except Exception`) — meaning even a consumer
that abandons the generator early won't orphan the child process or swallow a
nonzero exit.

### `ingest/pull_snoop.py` — adb → btsnoop, no root
**Job:** pull the snoop log off the phone and extract raw btsnoop bytes, entirely
without root. **Key:** `pull_bugreport()`, `extract_btsnoop()`, `decode_btsnooz()`,
`pull_and_extract()`, `_snoop_rank()`, `PullError`. **Subtlety:** it handles both
device layouts (a real `btsnoop_hci.log` file *or* the embedded btsnooz blob),
and `decode_btsnooz()` correctly implements the AOSP container — base64 → 1
version byte → raw-deflate (v2) / zlib (v1) — including advancing past the rest
of the marker line so trailing text like `BTSNOOP_LOG_SUMMARY (4096 bytes):`
never gets glued onto the front of the base64.

### `api/main.py` (+ `models.py`) — the HTTP surface
**Job:** the read-mostly FastAPI surface the Expo app consumes; `app` object
named so `uvicorn vitaldeck.api.main:app` works. **Key endpoints:** `/health`,
`/summary/today`, `/summary/{date}`, `/trends`, `/sleep`, `/metrics`, `/tags`
CRUD, and the single write path `POST /sync` (→ `run_sync` → `_sync_synthetic`
or `_sync_live` → `_recompute`). **Subtlety:** a fresh connection is opened *per
request* (`_conn()` context manager) because SQLite objects can't cross FastAPI's
threadpool threads. `_recompute()` re-scores each recent day against
`compute_baselines(summaries[:i+1])` — the *causal* slice — so a day is never
scored against future data that didn't exist yet. `models.py` keeps the response
models deliberately loose (`dict[str, Any]`) since the store already owns the row
shapes.

### `scheduler.py` — optional nightly auto-sync
**Job:** a twice-daily (`SYNC_HOURS = (8, 20)`) APScheduler job that calls the
same `run_sync()` the endpoint uses. **Subtlety:** it deliberately **no-ops in
dev** (no `ADB_TARGET`) so a background thread never fabricates synthetic days
behind my back, and it guards against stacking duplicate jobs.

### `tools/synth.py` — deterministic synthetic data
**Job:** a faithful stand-in for open_ring's decoded output so the entire backend
runs without a ring. **Key:** `generate()`, `write_jsonl()`, plus
`_gen_sleep_window`/`_gen_daytime`. **Subtlety:** it's fully deterministic —
seeded `random.Random` and a *fixed* `DEFAULT_END_MS` constant (not
`time.time()`) so tests reproduce byte-for-byte — and it injects "bad nights"
(`BAD_NIGHT_OFFSETS = (1, 4, 9)`: suppressed HRV, elevated RHR, +0.5°C temp) so
readiness *visibly dips* and the scoring is observably working. It even mirrors
the same local-midnight math as the backend so a night meant as "one night" lands
in one local day's window.

### `tools/seed.py` — the end-to-end proof
**Job:** `python -m tools.seed --days 30` drives the full chain
(generate → ingest → rebuild → score) and prints the last 7 days' readiness so a
human can eyeball that the bad-night dips landed. **Subtlety:** it sets
`VITALDECK_DB` *before* importing the store-touching modules (config reads the
env at import time), and scores each day against the causal history slice — the
same correctness property the API's `_recompute` enforces.

---

## 4. The design decisions and WHY (the interview section)

This is the part I most need to own. Each one is a deliberate choice with a
defensible reason.

**Passive snoop-log decode is genuinely no-root AND no-keys.** The thing people
assume blocks this is BLE link-layer encryption + the ring's AES auth key. But
that key is only needed to *establish a live connection and actively talk to the
ring myself* (a "Tier-2" connection VitalDeck never makes). I'm not connecting to
the ring at all — I'm reading a log of traffic the **official Oura app already
exchanged and already decrypted at the link layer**, which Android writes to the
HCI snoop log when I flip a Developer Options toggle. No root, because the snoop
log is a first-party Android feature, not a protected file I'm prying out. No
key, because the application-layer payloads are already in the clear in that log;
open_ring's job is just parsing the *protocol structure*, not breaking crypto.

**Use `t_event_ms`, not receive-time.** Every record is keyed on when the *ring
generated* the event, not when the *phone received* it. The ring buffers readings
and dumps them in catch-up bursts during a sync, so receive-time is lumpy and
meaningless — a whole night of HRV can arrive in one 9 a.m. transfer. Event-time
is the only timestamp that puts samples on the real biological timeline, and it's
what makes day-bucketing and trends correct.

**The `(t_event_ms, type, sess)` dedup key + `INSERT OR IGNORE` idempotency.**
Because the snoop log is a rolling buffer I must capture *often* and overlapping
(yesterday + today) to avoid gaps — which means I re-see the same events
constantly. A unique index on `(t_event_ms, type, sess)` plus `INSERT OR IGNORE`
makes ingest naturally idempotent: re-ingesting overlapping captures collapses to
one row each, so "capture often, worry later" is safe. `sess` is in the key (and
defaulted to `-1`, never NULL) so two genuinely different sessions that happen to
share an event-ms don't collide *and* so missing-session records still dedup
correctly (NULLs would compare distinct and defeat it).

**Batch, not live.** There's no streaming BLE connection and no real-time feed —
it's capture → decode → ingest on a cadence (manual Sync or the twice-daily
scheduler). This is the right tradeoff for the domain: a sleep/recovery tool
cares about last night, not this second, so a few minutes of lag costs nothing,
and in exchange I avoid maintaining a live connection (which *would* need the auth
key and a constant BLE link). The whole posture of the project flows from this.

**A custom readiness score from personal baselines, not a copy of Oura's.**
Oura's readiness is a black box I can't inspect or defend. Mine is an explainable
composite I built: four subscores (HRV up-is-good, resting HR down-is-good, temp
deviation penalized symmetrically, sleep = duration blended with efficiency),
each compared against *my own* trailing 14-day baseline, weighted by readable
numbers in `config.py`, and stored *with* its components so I can always answer
"why did it dip?" Comparing to personal baselines (not a population norm) is both
more meaningful for one user and avoids pretending I have population data I don't.

**Attribute a night's metrics to the sleep-session date.** If I naively bucketed
records by local day, a night that starts 11 p.m. Monday and ends 6 a.m. Tuesday
would split across two days — half the HRV on Monday, half on Tuesday, both
wrong. Instead `summarize.py` builds the sleep session first (contiguous
`sleep_stage` runs), then computes the nightly metrics over the *whole session
window* and attributes them to the session's **end date** (the morning you wake
up), matching how a person and how Oura think about "last night." A day that only
contains leaked nightly samples produces no summary row at all.

**Raw records as the single source of truth; everything else is a derived
projection.** `raw_records` is the firehose; `daily_summaries`, `sleep_sessions`,
and `metrics` are all rebuildable from it via `rebuild_all()`. This means I can
change the summarization or scoring logic and just recompute — I never lose
fidelity, and bugs in derived layers are recoverable. It's the same instinct
behind event-sourcing: keep the raw events, treat aggregates as cache.

**The real AOSP btsnooz format (1 version byte + raw/zlib deflate).** Not every
device drops a full `btsnoop_hci.log` into the bugreport; many only embed a
compressed **btsnooz** summary blob in the text. The actual AOSP layout is
base64 of `[1 version byte][deflated records]`, where **version 2 is a raw
deflate stream (no zlib wrapper) and version 1 is a full zlib stream**.
`decode_btsnooz()` reads the version byte and inflates accordingly (with a
both-ways fallback for robustness). Getting this exactly right is what lets the
no-root path work across Android versions/OEMs instead of only on devices that
happen to write the full file.

**GPLv3 hygiene via a subprocess boundary.** open_ring is GPLv3. I deliberately
**shell out to it** (`python -m driver.cli replay`) rather than `import` it, so
it runs as a separate process communicating over stdout/stdin (JSONL) — a clean
arms-length boundary instead of linking its GPL code into my own. It's also added
as a **git submodule on the Pi**, not vendored into my repo, so I'm not
redistributing their code at all and the upstream stays the canonical source.
That keeps my pipeline code cleanly separable and avoids the GPL "derivative
work" entanglement that importing would invite.

---

## 5. What's real vs. synthetic right now

Being straight about this matters more than overselling it.

**Fully working today, no hardware:** the entire backend on a **synthetic data
generator**. `tools/seed.py` + `tools/synth.py` fabricate a deterministic,
realistic month (circadian HR, nightly HRV/SpO2/resp/temp, sleep hypnograms, plus
injected bad nights) and run it through the real store, dedup, summarization,
baselines, readiness, FastAPI surface, and Expo app end to end. The data is
synthetic but **every line of pipeline code that processes it is the production
code** — synth emits the exact canonical record shapes open_ring's output maps
to, so swapping in real records changes the source, not the pipeline.

**The remaining real-world step is the hardware capture.** The capture path
(`pull_snoop.py` → `decode.py` against open_ring) is written, defensively
wrapped, and unit-tested on its pure portions (btsnooz decode, JSONL parsing),
but I haven't yet stood up the physical loop on my own Pi + dedicated Android
phone + ring. That's the honest gap: the integration code exists; the live
end-to-end capture against my actual ring is the next milestone.

**The validation plan is the free-month cross-check.** Before trusting the
decode, Phase 0 (`docs/PHASE0_RUNBOOK.md`) is to capture real data and diff my
decoded `heart_rate.bpm`, `hrv.rmssd_ms`, and `skin_temp.temp_c` against Oura's
**own official sources** — the Oura Cloud API and Health Connect — which only
work *while a membership is active*. So the plan is to validate during the free
trial, get a clean HR/HRV/temp match as the green light, and document the diffs.
**Sleep staging is explicitly the least-trusted part** (the on-ring hypnogram
decode is RE-uncertain), so I expect drift there and may compute my own stages
from HR/HRV/motion rather than trusting the ring's.

---

## 6. Interview prep: questions I should be able to answer

**Q1. If BLE traffic is encrypted, how do you read it without the key?**
Link-layer encryption protects data *in flight* between two paired devices. By
the time the official Oura app has the readings, they're decrypted on the phone,
and Android's HCI snoop log records the host-controller traffic at a layer where
the application payloads are recoverable. The AES auth key only matters if *I*
wanted to open my own live connection to the ring (a "Tier-2" connection) — I
don't. I'm passively reading already-exchanged, already-decrypted traffic, so no
key and no root are needed.

**Q2. How do you know your decode is correct?**
Cross-validation against ground truth. During the Oura free trial I pull the same
days from Oura's official Cloud API and Health Connect and diff HR/HRV/temp
against my decoded values; a clean match is the green light. It's a known-answer
test against the authoritative source. I treat sleep staging as unverified and
expect it to need its own model.

**Q3. Did you reverse-engineer the Oura BLE protocol yourself?**
No — and I'm careful to frame this accurately. The protocol RE is the
**`open_ring` community project's** work; I shell out to its replay CLI as the
decoder. *My* work is the systems integration and data engineering around it: the
no-root capture path (`adb bugreport` → btsnoop/btsnooz extraction), the
normalization and idempotent dedup, the source-of-truth/projection data model,
the cross-midnight night attribution, the explainable readiness metric, the API,
and the app — plus the systems thinking that ties them together. I understand the
protocol decisions well enough to consume and validate the output, but I don't
claim the RE itself.

**Q4. What happens if Oura changes the protocol?**
Firmware/app updates can shift the BLE protocol. Symptoms are a `DecodeError`, a
sudden drop in one record type's count, or values diverging from the official API
during a validation run. The defenses: (a) the validation cross-check catches
drift instead of silently corrupting data; (b) the decoder is an isolated
submodule I can bump/patch upstream without touching my pipeline; (c) a thin
mapping layer renames any changed upstream `type`/field strings back to my
canonical names in `CONTRACTS.md`, so the rest of the backend is insulated.

**Q5. Why SQLite, and why store the raw firehose at all?**
SQLite because this is a single-user, local-first, single-writer tool on a Pi —
no server, no accounts, one file, transactional, and zero ops. I store the raw
records as the source of truth so every aggregate (summaries, sessions, metrics)
is a *derived projection* I can rebuild at will with `rebuild_all()`. That lets me
change scoring/summarization logic and recompute without data loss, and makes
bugs in derived layers fully recoverable — the event-sourcing instinct applied to
health data.

**Q6. How is your readiness score explainable?**
It's a transparent weighted sum, not a black box. Four subscores (HRV, resting
HR, temp, sleep), each in `[0,1]`, each carrying its value, the baseline it was
judged against, its weight, and a plain-English note. The score is
`round(100 · Σ(weight·subscore))`, the weights are readable in `config.py`, and I
persist the full component breakdown alongside every score. `_explain()` even
names the biggest drag. I can always answer "why is today a 62?"

**Q7. Why event-time instead of when the data arrived?**
The ring buffers and dumps readings in catch-up bursts during a sync, so
receive-time clusters meaninglessly (a whole night arriving at 9 a.m.).
`t_event_ms` is when the ring actually generated the event, which is the only
timeline on which day-bucketing, baselines, and trends are biologically correct.

**Q8. How is ingest idempotent, and why does that matter?**
The snoop log is a rolling buffer, so I capture frequently and overlapping to
avoid gaps, which means I constantly re-see the same events. A UNIQUE index on
`(t_event_ms, type, sess)` plus `INSERT OR IGNORE` collapses repeats to one row
each. I also validate NOT-NULL fields up front and count true failures as
`errored` rather than letting `INSERT OR IGNORE`'s rowcount-0 hide real data loss
inside the dedup count.

**Q9. How do you handle a night that crosses midnight?**
I build the sleep session first from contiguous `sleep_stage` runs, then compute
the nightly metrics over the whole session window and attribute them to the
session's **end date** — the morning you wake up. Naive per-day bucketing would
split the night and corrupt both days' HRV/HR/temp; session-window attribution
keeps a night coherent.

**Q10. Why batch instead of real-time?**
A recovery/sleep dashboard cares about "last night," not "this instant," so
batch's few-minutes lag is free. Live would require maintaining an active BLE
connection (which *would* need the auth key) and constant power/uptime for no real
benefit. Batch also makes the whole thing a clean, restartable pipeline.

**Q11. What's the licensing story with open_ring?**
open_ring is GPLv3, so I keep it at arm's length: I run it as a **separate
process** via `subprocess` (JSONL over stdout) rather than importing it, and I
pull it in as a **git submodule on the Pi** rather than vendoring/redistributing
it. That subprocess boundary keeps my own code cleanly separable from GPL code
and avoids the derivative-work question that linking would raise.

**Q12. Why a dedicated capture phone?**
The HCI snoop log records *every* Bluetooth device the phone talks to, not just
the ring. A dedicated phone keeps the capture small, keeps unrelated devices'
traffic out of my logs, and is better for privacy.

**Q13. What are the biggest risks / what would you do next?**
The decode breaking on an Oura update (mitigated by the validation cross-check and
the isolated submodule); sleep-staging accuracy (likely needs my own model);
and the fact that the live hardware loop isn't stood up yet. Next steps: run the
physical Phase 0 capture, complete the free-month validation, and add the thin
upstream→canonical mapping layer once I've confirmed open_ring's exact field
names against real captures.

**Q14. How does the backend stay robust to bad data?**
Defensive coding at every I/O boundary: every call that hits SQLite, the
filesystem, a subprocess, or the network is wrapped in `try/except` with a
non-crashing fallback (per the project's coding rules). Malformed JSONL lines are
skipped, not fatal; one bad record never sinks a day's summary; `rebuild_all`
keeps going past a single bad upsert; the API returns typed error states rather
than 500s on a failed pull; and the app client turns any network failure into a
rendered error state.

**Q15. What did you actually build vs. integrate, in one sentence?**
I built the no-root capture-and-decode integration, the idempotent
event-time-keyed data pipeline, the rebuildable source-of-truth data model, the
explainable personal-baseline readiness metric, the FastAPI service, and the Expo
client — integrating a third party's protocol decoder (open_ring) as one isolated
stage. The systems thinking and the data-engineering correctness are mine; the
protocol reverse-engineering is theirs.

---

## 7. Honest scope of AI assistance

VitalDeck was built with AI-assisted development (Claude Code) under my direction.
I owned the architecture and the decisions: the no-root/no-keys threat model, the
batch-not-live posture, the source-of-truth/projection data model, the
event-time + dedup-key invariants, the cross-midnight attribution rule, the
explainable-readiness design, and the hardware reverse-engineering and validation
plan (`CONTRACTS.md`, `docs/ARCHITECTURE.md`, and `docs/PHASE0_RUNBOOK.md` are the
specs I wrote against). The AI accelerated the implementation of those decisions —
writing modules to a contract I defined, with me reviewing, correcting, and
integrating. This is a normal, modern engineering workflow; what I'm defending in
an interview is the systems design, the correctness reasoning, and the
integration — and I understand every decision in this document well enough to
explain and stand behind it.
