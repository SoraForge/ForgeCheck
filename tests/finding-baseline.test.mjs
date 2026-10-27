import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  BaselinePolicyError,
  computeFindingFingerprint,
  evaluateFindingBaseline,
  normalizeFindingPath
} from "../src/modules/finding-baseline/index.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI_PATH = path.join(ROOT, "src/modules/finding-baseline/cli.mjs");

const makeFinding = (overrides = {}) => ({
  ruleId: "SOROBAN-RPC-002",
  message: "Verify Soroban RPC retention window assumptions.",
  confidence: "review-required",
  file: "src/rpc/ledger.ts",
  line: 24,
  column: 5,
  severity: "medium",
  ...overrides
});

test("Windows and POSIX paths normalize to identical fingerprints without mutating inputs", () => {
  const posixFinding = Object.freeze(makeFinding({ file: "src/rpc/ledger.ts" }));
  const winFinding = Object.freeze(makeFinding({ file: ".\\src\\rpc\\ledger.ts" }));

  const fpPosix = computeFindingFingerprint(posixFinding);
  const fpWin = computeFindingFingerprint(winFinding);
  assert.equal(fpPosix, fpWin);
  assert.match(fpPosix, /^[0-9a-f]{64}$/);
  assert.equal(normalizeFindingPath(".\\src\\rpc\\ledger.ts"), "src/rpc/ledger.ts");

  const scanResult = Object.freeze({
    status: "complete",
    findings: Object.freeze([winFinding])
  });
  const baseline = Object.freeze([
    Object.freeze({
      fingerprint: fpPosix,
      ruleId: "SOROBAN-RPC-002",
      file: "src\\rpc\\ledger.ts",
      rationale: "Reviewed: ledger retention window is bounded by archive fallback.",
      owner: "core-team",
      expiresAt: "2026-12-31T23:59:59Z"
    })
  ]);

  const outcome = evaluateFindingBaseline(scanResult, baseline, {
    now: "2026-06-15T12:00:00Z"
  });

  assert.equal(outcome.baselined.length, 1);
  assert.equal(outcome.active.length, 0);
  assert.equal(outcome.expired.length, 0);
  assert.equal(outcome.baselined[0].finding.file, "src/rpc/ledger.ts");
  assert.equal(winFinding.file, ".\\src\\rpc\\ledger.ts");
});

test("partitions active, baselined, expired, and unmatched entries deterministically with injected clock", () => {
  const fBaselined = makeFinding({ ruleId: "RULE-A", line: 10, message: "Keep baselined" });
  const fExpired = makeFinding({ ruleId: "RULE-B", line: 20, message: "Expired review" });
  const fActive = makeFinding({ ruleId: "RULE-C", line: 30, message: "Unmatched new finding" });
  const fStale = makeFinding({ ruleId: "RULE-STALE", line: 99, message: "Removed from codebase" });

  const entries = [
    {
      fingerprint: computeFindingFingerprint(fBaselined),
      rationale: "Reviewed and accepted until Q4 migration.",
      owner: "payments-squad",
      expiresAt: "2026-11-01T00:00:00Z"
    },
    {
      fingerprint: computeFindingFingerprint(fExpired),
      rationale: "Temporary waiver during testnet transition.",
      owner: "infra-squad",
      expiresAt: "2026-05-01T00:00:00Z"
    },
    {
      fingerprint: computeFindingFingerprint(fStale),
      rationale: "Legacy workaround no longer present.",
      owner: "sdk-squad",
      expiresAt: "2026-12-01T00:00:00Z"
    }
  ];

  const clock = () => "2026-06-01T00:00:00Z";
  const forward = evaluateFindingBaseline(
    { status: "complete", findings: [fActive, fExpired, fBaselined] },
    { entries },
    { clock }
  );
  const reversed = evaluateFindingBaseline(
    { status: "complete", findings: [fBaselined, fExpired, fActive] },
    { entries: [...entries].reverse() },
    { clock }
  );

  assert.deepEqual(forward, reversed);
  assert.equal(forward.evaluatedAt, "2026-06-01T00:00:00.000Z");
  assert.equal(forward.active.length, 1);
  assert.equal(forward.active[0].finding.ruleId, "RULE-C");
  assert.equal(forward.baselined.length, 1);
  assert.equal(forward.baselined[0].finding.ruleId, "RULE-A");
  assert.equal(forward.expired.length, 1);
  assert.equal(forward.expired[0].finding.ruleId, "RULE-B");
  assert.equal(forward.unmatchedBaselineEntries.length, 1);
  assert.equal(
    forward.unmatchedBaselineEntries[0].fingerprint,
    computeFindingFingerprint(fStale)
  );
});

test("refuses confirmed-failure suppression by default and allows only explicit audited override", () => {
  const confirmed = makeFinding({
    ruleId: "HORIZON-CRITICAL-001",
    confidence: "confirmed-failure",
    message: "Removed Horizon endpoint used in production transaction submission."
  });
  const fp = computeFindingFingerprint(confirmed);

  // Refused by default
  assert.throws(
    () =>
      evaluateFindingBaseline(
        { status: "complete", findings: [confirmed] },
        [
          {
            fingerprint: fp,
            rationale: "Attempting to silence confirmed failure without audit.",
            owner: "dev-user"
          }
        ],
        { now: "2026-06-01T00:00:00Z" }
      ),
    (err) =>
      err instanceof BaselinePolicyError &&
      err.code === "CONFIRMED_FAILURE_SUPPRESSION_REFUSED"
  );

  // Allowed only when both option and entry audit fields are supplied
  const audited = evaluateFindingBaseline(
    { status: "complete", findings: [confirmed] },
    [
      {
        fingerprint: fp,
        rationale: "Mitigated by upstream proxy rewrite; tracked in security audit.",
        owner: "sec-lead",
        allowConfirmedFailure: true,
        auditReference: "SEC-AUDIT-2026-042",
        expiresAt: "2026-09-01T00:00:00Z"
      }
    ],
    {
      now: "2026-06-01T00:00:00Z",
      allowConfirmedFailureOverride: true
    }
  );
  assert.equal(audited.baselined.length, 1);
  assert.equal(audited.baselined[0].baseline.auditReference, "SEC-AUDIT-2026-042");
});

test("rejects missing rationale, missing owner, duplicate fingerprints, malformed hashes, wildcards, and unavailable scans", () => {
  const f = makeFinding();
  const fp = computeFindingFingerprint(f);
  const report = { status: "complete", findings: [f] };

  // Missing rationale
  assert.throws(
    () =>
      evaluateFindingBaseline(report, [
        { fingerprint: fp, rationale: "   ", owner: "team" }
      ]),
    (err) => err.code === "MISSING_RATIONALE"
  );

  // Missing owner
  assert.throws(
    () =>
      evaluateFindingBaseline(report, [
        { fingerprint: fp, rationale: "Valid rationale text", owner: "" }
      ]),
    (err) => err.code === "MISSING_OWNER"
  );

  // Malformed hash
  assert.throws(
    () =>
      evaluateFindingBaseline(report, [
        { fingerprint: "not-a-sha256-hash", rationale: "Valid rationale text", owner: "team" }
      ]),
    (err) => err.code === "MALFORMED_FINGERPRINT"
  );

  // Wildcard exemption
  assert.throws(
    () =>
      evaluateFindingBaseline(report, [
        {
          fingerprint: fp,
          ruleId: "SOROBAN-*",
          rationale: "Overbroad wildcard rule",
          owner: "team"
        }
      ]),
    (err) => err.code === "WILDCARD_EXEMPTION_REJECTED"
  );

  // Duplicate baseline entry
  assert.throws(
    () =>
      evaluateFindingBaseline(report, [
        { fingerprint: fp, rationale: "First entry rationale", owner: "team-a" },
        { fingerprint: fp, rationale: "Duplicate entry rationale", owner: "team-b" }
      ]),
    (err) => err.code === "DUPLICATE_BASELINE_ENTRY"
  );

  // Non-UTC expiresAt
  assert.throws(
    () =>
      evaluateFindingBaseline(report, [
        {
          fingerprint: fp,
          rationale: "Local timezone offset not allowed",
          owner: "team",
          expiresAt: "2026-12-01T00:00:00-05:00"
        }
      ]),
    (err) => err.code === "NON_UTC_TIMESTAMP"
  );

  // Unavailable scan result fails closed
  assert.throws(
    () =>
      evaluateFindingBaseline(
        { status: "unavailable", reason: "Scanner offline" },
        []
      ),
    (err) => err.code === "UNAVAILABLE_SCAN_RESULT"
  );
});

test("standalone CLI evaluates sample fixtures and enforces exit codes", () => {
  const sampleReport = path.join(
    ROOT,
    "src/modules/finding-baseline/example-report.json"
  );
  const sampleBaseline = path.join(
    ROOT,
    "src/modules/finding-baseline/example-baseline.json"
  );

  // Before expiry -> exit 0
  const okRun = spawnSync(
    process.execPath,
    [CLI_PATH, sampleReport, sampleBaseline, "--now", "2026-06-01T00:00:00Z"],
    { encoding: "utf8" }
  );
  assert.equal(okRun.status, 0, okRun.stderr);
  const okData = JSON.parse(okRun.stdout);
  assert.equal(okData.summary.baselinedCount, 1);
  assert.equal(okData.summary.activeCount, 0);

  // After expiry -> exit 1
  const expiredRun = spawnSync(
    process.execPath,
    [CLI_PATH, sampleReport, sampleBaseline, "--now", "2027-06-01T00:00:00Z"],
    { encoding: "utf8" }
  );
  assert.equal(expiredRun.status, 1);
  const expiredData = JSON.parse(expiredRun.stdout);
  assert.equal(expiredData.summary.expiredCount, 1);
});
