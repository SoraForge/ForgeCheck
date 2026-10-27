# Reviewed Finding-Baseline and Expiry Policy (`#33`)

Lets engineering teams acknowledge persistent low-confidence (`review-required` / `not-evaluated`) compatibility findings with explicit ownership, review rationale, and UTC expiration timestamps without permanently hiding newly introduced risks or confirmed failures.

## Owned Paths

- `src/modules/finding-baseline/**`
- `tests/finding-baseline.test.mjs`
- `docs/features/finding-baseline.md`

## Usage

### Standalone CLI

```bash
# Print canonical SHA-256 fingerprints for findings in a complete report
node src/modules/finding-baseline/cli.mjs --print-fingerprints src/modules/finding-baseline/example-report.json

# Evaluate a ScanResult report against a baseline file at a deterministic UTC timestamp
node src/modules/finding-baseline/cli.mjs \
  src/modules/finding-baseline/example-report.json \
  src/modules/finding-baseline/example-baseline.json \
  --now 2026-06-01T00:00:00Z
```

Exit codes:
- `0`: All findings are covered by non-expired baseline entries (`activeCount === 0` and `expiredCount === 0`).
- `1`: One or more findings remain active or have expired baseline suppressions.
- `2`: Invalid input, policy violation (e.g., wildcard exemption, missing rationale, unapproved `confirmed-failure` suppression), or `unavailable` scan report.

### Programmatic API

```js
import {
  computeFindingFingerprint,
  evaluateFindingBaseline
} from "../../src/modules/finding-baseline/index.mjs";

const fingerprint = computeFindingFingerprint(finding);
const evaluation = evaluateFindingBaseline(scanResult, baselineEntries, {
  now: "2026-10-27T00:00:00Z"
});
```

## Policy Rules & Security Guarantees

1. **Deterministic Cross-Platform Fingerprints**:
   - File paths are normalized from Windows (`\`) to POSIX (`/`) before computing a 64-character lowercase SHA-256 hex digest over `{ ruleId, file, line, column, message }`.
   - Unsafe relative paths (`..`, leading `/`, Windows drive letters, control characters, or glob wildcards) fail closed.
2. **No Wildcard or Unreviewed Exemptions**:
   - Entries containing `*`, `?`, or `[` wildcards, malformed fingerprints, duplicate fingerprints, missing `owner`, or rationales shorter than 5 characters are rejected immediately.
3. **`confirmed-failure` Refusal by Default**:
   - `confirmed-failure` findings cannot be suppressed by standard baseline entries (`CONFIRMED_FAILURE_SUPPRESSION_REFUSED`).
   - Suppression requires an explicit two-key audited override: `options.allowConfirmedFailureOverride === true` **and** `entry.allowConfirmedFailure === true` with a non-empty `entry.auditReference`.
4. **UTC-Aware Expiry**:
   - `expiresAt` must be an explicit UTC ISO-8601 timestamp (`Z` or `+00:00`). Once `expiresAt <= now`, the finding moves from `baselined` to `expired` so CI surfaces it for re-review.
5. **Non-Mutating & Fail-Closed**:
   - Neither `scanResult` nor `baselineInput` is mutated.
   - `{ status: "unavailable" }` reports fail safely (`UNAVAILABLE_SCAN_RESULT`) instead of appearing as zero active findings.

## When Suppressions Should Be Removed or Re-Reviewed

- **Stale / Unmatched Entries**: When `unmatchedBaselineEntries` is non-empty after a code upgrade or refactor, remove the obsolete entry from the baseline file immediately so stale hashes do not accumulate.
- **Expired Entries**: When an entry moves into `expired`, re-verify whether the underlying Stellar SDK / Soroban RPC upgrade has resolved the issue; if further deferral is justified, record a fresh review rationale and a new bounded `expiresAt` date.
- **Protocol / SDK Upgrades**: Re-review all `review-required` baseline entries prior to any Stellar protocol upgrade or major SDK migration.
