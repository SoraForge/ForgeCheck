# ScanResult to SARIF 2.1.0 exporter (#31)

This standalone module converts existing ForgeCheck `ScanResult` JSON without starting the scanner or requiring a GitHub token. Its result follows [OASIS SARIF 2.1.0](https://docs.oasis-open.org/sarif/sarif/v2.1.0/os/sarif-v2.1.0-os.html).

```bash
node src/modules/sarif-export/cli.mjs src/modules/sarif-export/example-complete.json > report.sarif
node --test tests/sarif-export.test.mjs
```

Or import `toSarif` from `src/modules/sarif-export/index.mjs`. Complete scans emit a single successful run, stable sorted rule metadata, result confidence/severity properties, relative percent-encoded source locations and rule-specific levels. Only safe relative POSIX paths are accepted; absolute, traversal and malformed paths raise an exception. JavaScript control sequences are sanitized; JSON serialization protects message strings. For location-less findings the `locations` field is absent.

**Important:** `{status:'unavailable',reason}` emits `executionSuccessful:false`, an error notification and `results:null`, never an empty successful scan. The analysis is not performed by this exporter; absent rule/scan evaluation metadata is not invented. No network traffic or upload takes place.

This feature is intentionally not wired into the existing ForgeCheck root CLI. Maintainers can review and integrate independently later.
