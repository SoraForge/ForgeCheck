# ForgeCheck `ScanResult` JSON Schema & Validator (`#30`)

Formalizes the exported `ScanResult` contract (`src/contracts.ts`) using **JSON Schema Draft 2020-12** (`schemas/scan-result.schema.json`) and provides a zero-dependency standalone validation library and CLI in `tools/scan-schema/`.

## Owned Paths

- `schemas/scan-result.schema.json`
- `tools/scan-schema/**`
- `tests/scan-schema.test.mjs`

## Usage

### Standalone CLI

```bash
# Validate one or more report files (human-readable output)
node tools/scan-schema/cli.mjs tools/scan-schema/fixtures/valid-complete.v1.json

# Emit structured JSON validation output
node tools/scan-schema/cli.mjs --json tools/scan-schema/fixtures/valid-unavailable.v1.json

# Enforce a custom byte ceiling
node tools/scan-schema/cli.mjs --max-bytes 65536 report.json
```

Exit codes:
- `0`: All supplied report files conform to the `ScanResult` schema.
- `1`: One or more report files failed validation or could not be read.
- `2`: Invalid CLI arguments.

### Programmatic API

```js
import {
  loadScanResultSchema,
  validateScanResult,
  validateScanResultJson
} from "./index.mjs";

const schema = loadScanResultSchema();
const result = validateScanResult({
  status: "complete",
  findings: [
    {
      ruleId: "SOROBAN-001",
      message: "Check network passphrase binding",
      confidence: "review-required",
      file: "src/network.ts",
      line: 12
    }
  ]
});

if (!result.valid) {
  console.error(result.errors);
}
```

## Schema & Bounds Summary (`v1.0.0`)

- **Discriminated union (`oneOf`) on `status`**:
  - `status: "unavailable"`: requires non-empty `reason` (`1..2048` chars), forbids `findings` or extra fields (`additionalProperties: false`).
  - `status: "complete"`: requires `findings` array (`0..10,000` items), optional integer `filesScanned` (`0..10,000,000`) and `rulesEvaluated` (`0..100,000`), forbids `reason` or extra fields (`additionalProperties: false`).
- **`ScanFinding` constraints**:
  - `ruleId`: required `1..128` chars matching `^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`.
  - `message`: required `1..4096` chars without binary control characters.
  - `confidence`: required enum `"confirmed-failure" | "review-required" | "not-evaluated"`.
  - `file`: optional safe relative path (`1..1024` chars; rejects `/`, `\`, Windows drive prefixes, `..` traversal, and control characters).
  - `line`: optional positive integer (`1..1,000,000`), requires `file` (`dependentRequired`).
  - `column`: optional positive integer (`1..100,000`), requires both `file` and `line` (`dependentRequired`).
  - `severity`: optional enum `"critical" | "high" | "medium" | "low" | "info"`.
  - `evidenceUrls`: optional array (`<= 32` unique `http://` or `https://` URLs).
  - `remediation`: optional non-empty string (`1..4096` chars).
- **Input size ceiling**: `validateScanResultJson` and the CLI enforce a default `5 MiB` (`5,242,880` bytes) payload ceiling prior to parsing.

## Compatibility & Evolution Policy

1. **Patch / Minor (`1.x`)**: New optional fields added to `src/contracts.ts` may be added as optional properties in `schemas/scan-result.schema.json` along with bumping `x-schema-version` minor version (`1.1.0`). Existing required fields and enum members remain backward compatible.
2. **Major (`2.0.0`)**: Changing `status` discriminators, removing required fields, or narrowing existing enum values requires a major schema version bump and a new `$id` URI path (`/v2.0.0/`).

## Honest Limitations

- This module strictly validates report shapes and bounds offline; it does not run source scans, inspect repositories, or perform network requests.
- It is intentionally not wired into `src/cli.ts` or `src/application.ts` in accordance with the standalone module isolation rule.
