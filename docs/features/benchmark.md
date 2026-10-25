# Independent accuracy benchmark (#34)

This is **synthetic fixture data**, not a measured ForgeCheck production accuracy claim. The scanner is not implemented in this module. Supply independent expected findings and previously saved `ScanResult` JSON outputs. No network calls.

Run with Node 22+:

```sh
node tools/benchmark/cli.mjs --manifest tools/benchmark/fixtures/manifest.json --reports tools/benchmark/fixtures --json
node tools/benchmark/cli.mjs --manifest tools/benchmark/fixtures/manifest.json --reports tools/benchmark/fixtures --min-precision 0.8 --min-recall 0.8
node --test tests/benchmark.test.mjs
```

Manifest version 1 contains `cases[]`: unique `id`, `operation`, `versions` (version map), `expectedFindingIds` (rule IDs), `intentionalNegative` (must have zero expected), and `reportFile` (safe path relative to `--reports`). A `complete` report's `findings[].ruleId` are the observed IDs; multiple occurrences of one rule in a case count **once**, not separate locations. This benchmarks rule presence per case, not line-level matching. Review-required findings count as observed; if an observation is marked `not-evaluated` the whole case is excluded from scoring.

True positive = expected and observed; false positive = observed but not expected; false negative = expected but absent. Precision = TP/(TP+FP), recall = TP/(TP+FN), and undefined denominators are represented by `null`, never 100%. A missing report is excluded; `unavailable` and `not-evaluated` results are tracked separately. Negative cases with no findings count toward `trueNegativeCases` but do not artificially increase precision or recall. Invalid manifests or results fail closed.

CLI emits deterministic summaries or JSON. Optional `--min-precision` / `--min-recall` thresholds in [0,1] exit 1 when missed or undefined; invalid inputs exit 2. Report reads are capped at 2 MiB and cannot escape the report directory, including through symlinks. Add real application evidence only when genuinely available, with independent expectations documented ahead of observing results. No scan execution or proof of high recall is implied.
