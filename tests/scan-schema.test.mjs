import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  ALLOWED_CONFIDENCES,
  ALLOWED_SEVERITIES,
  SCHEMA_DRAFT,
  SCHEMA_VERSION,
  loadScanResultSchema,
  validateScanResult,
  validateScanResultJson
} from "../tools/scan-schema/index.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES_DIR = path.join(ROOT, "tools/scan-schema/fixtures");
const CLI_PATH = path.join(ROOT, "tools/scan-schema/cli.mjs");

test("JSON Schema Draft 2020-12 metadata and TypeScript contracts agree", () => {
  const schema = loadScanResultSchema();
  assert.equal(schema.$schema, SCHEMA_DRAFT);
  assert.equal(schema["x-schema-version"], SCHEMA_VERSION);
  assert.equal(Array.isArray(schema.oneOf), true);
  assert.equal(schema.oneOf.length, 2);

  // Verify agreement with src/contracts.ts
  const contractsSource = fs.readFileSync(path.join(ROOT, "src/contracts.ts"), "utf8");
  for (const confidence of ALLOWED_CONFIDENCES) {
    assert.equal(
      contractsSource.includes(`"${confidence}"`),
      true,
      `src/contracts.ts missing FindingConfidence "${confidence}"`
    );
  }
  assert.deepEqual(schema.$defs.FindingConfidence.enum, [...ALLOWED_CONFIDENCES]);

  for (const severity of ALLOWED_SEVERITIES) {
    assert.equal(
      contractsSource.includes(`"${severity}"`),
      true,
      `src/contracts.ts missing severity "${severity}"`
    );
  }
  assert.deepEqual(schema.$defs.FindingSeverity.enum, [...ALLOWED_SEVERITIES]);

  const expectedFindingKeys = [
    "ruleId",
    "message",
    "confidence",
    "file",
    "line",
    "column",
    "severity",
    "evidenceUrls",
    "remediation"
  ];
  assert.deepEqual(
    Object.keys(schema.$defs.ScanFinding.properties).sort(),
    [...expectedFindingKeys].sort()
  );
  for (const field of expectedFindingKeys) {
    assert.equal(
      new RegExp(`\\b${field}\\??:`).test(contractsSource),
      true,
      `src/contracts.ts missing ScanFinding property "${field}"`
    );
  }
});

test("accepts valid complete and unavailable ScanResult payloads and fixtures", () => {
  const validCompleteRaw = fs.readFileSync(
    path.join(FIXTURES_DIR, "valid-complete.v1.json"),
    "utf8"
  );
  const completeOutcome = validateScanResultJson(validCompleteRaw);
  assert.equal(completeOutcome.valid, true);
  assert.equal(completeOutcome.errors.length, 0);
  assert.equal(completeOutcome.value.status, "complete");
  assert.equal(completeOutcome.value.findings.length, 2);

  const validUnavailableRaw = fs.readFileSync(
    path.join(FIXTURES_DIR, "valid-unavailable.v1.json"),
    "utf8"
  );
  const unavailableOutcome = validateScanResultJson(validUnavailableRaw);
  assert.equal(unavailableOutcome.valid, true);
  assert.equal(unavailableOutcome.value.status, "unavailable");

  const emptyComplete = validateScanResult({
    status: "complete",
    findings: [],
    filesScanned: 0,
    rulesEvaluated: 12
  });
  assert.equal(emptyComplete.valid, true);
});

test("rejects malformed status, wrong confidence, bad line/column, missing ruleId, and extra properties", () => {
  // Malformed status
  const badStatus = validateScanResult({ status: "partial", findings: [] });
  assert.equal(badStatus.valid, false);
  assert.equal(badStatus.errors.some((e) => e.code === "INVALID_STATUS"), true);

  // Unavailable with findings or empty reason
  const badUnavailable = validateScanResult({
    status: "unavailable",
    reason: "   ",
    findings: []
  });
  assert.equal(badUnavailable.valid, false);
  assert.equal(badUnavailable.errors.some((e) => e.code === "INVALID_REASON"), true);
  assert.equal(badUnavailable.errors.some((e) => e.code === "ADDITIONAL_PROPERTY"), true);

  // Wrong confidence, missing ruleId, line <= 0, line without file
  const badFinding = validateScanResult({
    status: "complete",
    findings: [
      {
        ruleId: "",
        message: "Broken finding",
        confidence: "certain",
        line: 0,
        column: -3,
        severity: "blocker",
        unknownField: true
      }
    ]
  });
  assert.equal(badFinding.valid, false);
  const codes = new Set(badFinding.errors.map((e) => e.code));
  assert.equal(codes.has("INVALID_RULE_ID"), true);
  assert.equal(codes.has("INVALID_CONFIDENCE"), true);
  assert.equal(codes.has("DEPENDENT_REQUIRED_FILE"), true);
  assert.equal(codes.has("INVALID_LINE"), true);
  assert.equal(codes.has("DEPENDENT_REQUIRED_LINE"), true);
  assert.equal(codes.has("INVALID_COLUMN"), true);
  assert.equal(codes.has("INVALID_SEVERITY"), true);
  assert.equal(codes.has("ADDITIONAL_PROPERTY"), true);

  //Unsafe file paths
  for (const unsafePath of ["../secret.ts", "/etc/passwd", "C:\\Windows\\win.ini", "src//a.ts"]) {
    const res = validateScanResult({
      status: "complete",
      findings: [
        {
          ruleId: "RULE-1",
          message: "Path test",
          confidence: "review-required",
          file: unsafePath,
          line: 10
        }
      ]
    });
    assert.equal(res.valid, false, `Expected unsafe path "${unsafePath}" to be rejected`);
    assert.equal(res.errors.some((e) => e.code === "INVALID_FILE_PATH"), true);
  }
});

test("rejects maliciously large JSON payloads and excessive finding counts", () => {
  const oversizedJson = JSON.stringify({
    status: "unavailable",
    reason: "x".repeat(2048)
  });
  const byteRejected = validateScanResultJson(oversizedJson, { maxBytes: 256 });
  assert.equal(byteRejected.valid, false);
  assert.equal(byteRejected.errors[0].code, "INPUT_TOO_LARGE");

  const tooManyFindings = validateScanResult(
    {
      status: "complete",
      findings: Array.from({ length: 6 }, (_, i) => ({
        ruleId: `RULE-${i + 1}`,
        message: "Valid message",
        confidence: "not-evaluated"
      }))
    },
    { maxFindings: 5 }
  );
  assert.equal(tooManyFindings.valid, false);
  assert.equal(tooManyFindings.errors[0].code, "FINDINGS_LIMIT_EXCEEDED");
});

test("standalone CLI validates valid and invalid fixtures with distinct exit codes", () => {
  const okRun = spawnSync(
    process.execPath,
    [
      CLI_PATH,
      "--json",
      path.join(FIXTURES_DIR, "valid-complete.v1.json"),
      path.join(FIXTURES_DIR, "valid-unavailable.v1.json")
    ],
    { encoding: "utf8" }
  );
  assert.equal(okRun.status, 0, okRun.stderr);
  const okBody = JSON.parse(okRun.stdout);
  assert.equal(okBody.valid, true);
  assert.equal(okBody.results.length, 2);

  const badRun = spawnSync(
    process.execPath,
    [CLI_PATH, "--json", path.join(FIXTURES_DIR, "invalid-malformed.v1.json")],
    { encoding: "utf8" }
  );
  assert.equal(badRun.status, 1);
  const badBody = JSON.parse(badRun.stdout);
  assert.equal(badBody.valid, false);
  assert.equal(badBody.results[0].errors.length >= 3, true);

  const missingRun = spawnSync(process.execPath, [CLI_PATH, "non-existent-report.json"], {
    encoding: "utf8"
  });
  assert.equal(missingRun.status, 1);
});
