# Crawler reference measurement protocol version 1

## Purpose and non-claims

This protocol makes correctness and performance evidence reproducible across
Crawler revisions. It defines collection and reporting; the presence of this
document is not a performance result. Never populate a result from estimates.
Store the raw observations used to calculate every reported percentile.

## Immutable subject identity

Each run records all of the following:

- fixture `id`, exact document SHA-256, fixture-format version, and document
  revision from `fixtures/reference-models/<id>/fixture.json`;
- fixture SPDX license, creator, source description, generator, and creation
  date copied from that fixture record;
- 40-character source revision, dirty-worktree flag, build profile, compiler,
  browser version, and benchmark-harness revision;
- package/application revision when it differs from the source revision.

A result with a changed fixture document hash is a different measurement
subject even when its display name is unchanged. Do not compare those results
without describing the model change.

## Device class

`device_class.id` is a stable local label such as `desktop-discrete-gpu-2026`,
not a marketing performance tier. A record also includes CPU model and logical
core count, installed memory, GPU model and driver, operating-system build,
browser and WebAssembly runtime versions, WebAssembly thread availability,
display resolution/scale, power profile, AC/battery state, and whether other
material workloads were present. Record unavailable values explicitly as
`"unknown"`; never silently omit them.

Two runs are the same device class only when the fields relevant to the metric
are materially equivalent. GPU/driver/display differences matter for frame
metrics; CPU/core/runtime differences matter for recompute and load metrics.

## Cold and warm states

Every result has exactly one `run_state.kind`:

- **cold**: new browser/application process; no document has been opened;
  worker/kernel has not initialized; no application-level geometry or render
  cache is retained. The OS file cache may be uncontrolled, so record its
  state and reboot/drop-cache preparation if used. One cold observation is
  collected per fresh process.
- **warm**: same build and fixture after one unmeasured complete load,
  recompute, and rendered frame. Perform five unmeasured warm-up iterations,
  then collect measured iterations without changing the document or device
  configuration.

Do not combine cold and warm observations. Record the exact preparation text,
warm-up count, measured sample count, and whether the OS cache was controlled.
The minimum is 10 independent cold-process samples and 50 warm samples. A
smaller exploratory run must be labeled `exploratory` and cannot establish or
pass a budget.

## Metrics and boundaries

Use monotonic high-resolution timing. Measure at these boundaries:

| Metric | Start | End | Unit |
| --- | --- | --- | --- |
| `input_feedback` | accepted pointer/key input | corresponding UI feedback committed | ms |
| `preview_latency` | preview command dispatched | matching preview render packet presented | ms |
| `recompute_latency` | committed edit command dispatched | accepted matching recompute result | ms |
| `frame_time` | animation frame callback | frame presentation submission completed | ms |
| `document_load` | package bytes available | accepted model and first complete frame | ms |
| `resident_memory` | post-state sampling instant | process-tree resident/working set sample | MiB |

For asynchronous work, correlate start/end with the same command and document
revision. Exclude no outliers. A cancelled, timed-out, crashed, or invalid run
is recorded as a failure alongside samples and is not converted into a large
synthetic latency.

## Percentiles

Retain raw numeric samples in execution order. Sort a copy ascending and use
the nearest-rank definition for `p50`, `p95`, and `p99`: for `N` observations,
the percentile at fraction `q` is sorted sample `ceil(q * N)`, indexed from 1.
Also report `min`, `max`, and sample count. Do not average percentiles across
runs or devices. Percentile values in a record must be reproducible from its
raw samples.

Report at least p50/p95/p99 for latency and frame-time metrics. Memory reports
p50/p95/p99 plus peak (`max`). Budget evaluation uses the percentile named by
the budget, never a substituted mean.

## Run order and reporting

1. Confirm fixture hashes with `crawler-reference-fixtures`.
2. Capture revision, build, device class, environment, and fixture provenance.
3. Collect cold samples in separately launched processes.
4. Perform the declared warm-up, then collect warm samples.
5. Preserve raw samples and failures; compute nearest-rank summaries.
6. Validate the record against `measurement-record-v1.schema.json`.
7. Compare only equivalent subject/device/run states and state any exception.

Measurement files, clocks, device facts, and results are evidence metadata;
they never enter a portable Crawler document or its semantic hash.
