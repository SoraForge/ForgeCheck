import crypto from "node:crypto";

export const FINGERPRINT_HEX_PATTERN = /^[0-9a-f]{64}$/;
export const RULE_ID_SAFE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
export const UTC_ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|\+00:00)$/;

const ALLOWED_CONFIDENCES = new Set([
  "confirmed-failure",
  "review-required",
  "not-evaluated"
]);

export class BaselinePolicyError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "BaselinePolicyError";
    this.code = code;
  }
}

/**
 * Normalizes a relative project file path across Windows and POSIX separators,
 * rejecting path traversal, root prefixes, drive letters, and wildcards.
 */
export function normalizeFindingPath(file) {
  if (file === undefined || file === null) {
    return "";
  }
  if (typeof file !== "string" || file.trim().length === 0 || file.length > 1024) {
    throw new BaselinePolicyError(
      "INVALID_FINDING_PATH",
      "Finding file path must be a non-empty string up to 1024 characters."
    );
  }
  if (/[\u0000-\u001F\u007F*?[\]]/.test(file)) {
    throw new BaselinePolicyError(
      "WILDCARD_OR_CONTROL_PATH",
      `Wildcard or control characters are prohibited in finding path: "${file}".`
    );
  }
  const unified = file.replace(/\\/g, "/").replace(/^(?:\.\/)+/, "");
  if (
    unified.startsWith("/") ||
    /^[A-Za-z]:/.test(unified) ||
    /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(unified) ||
    unified.includes("//")
  ) {
    throw new BaselinePolicyError(
      "UNSAFE_FINDING_PATH",
      `Finding path must be relative to project root: "${file}".`
    );
  }
  const segments = unified.split("/");
  if (segments.some((s) => s === "" || s === "." || s === "..")) {
    throw new BaselinePolicyError(
      "PATH_TRAVERSAL_REJECTED",
      `Path traversal or empty segment is prohibited in finding path: "${file}".`
    );
  }
  return unified;
}

/**
 * Validates a ScanFinding and computes its canonical SHA-256 hex fingerprint.
 */
export function computeFindingFingerprint(finding) {
  if (!finding || typeof finding !== "object" || Array.isArray(finding)) {
    throw new BaselinePolicyError(
      "INVALID_FINDING",
      "Finding must be a non-null plain object."
    );
  }
  if (
    typeof finding.ruleId !== "string" ||
    !RULE_ID_SAFE_PATTERN.test(finding.ruleId)
  ) {
    throw new BaselinePolicyError(
      "INVALID_RULE_ID",
      `Invalid or wildcard ruleId "${String(finding.ruleId)}".`
    );
  }
  if (typeof finding.message !== "string" || finding.message.trim().length === 0) {
    throw new BaselinePolicyError(
      "INVALID_MESSAGE",
      "Finding message must be a non-empty string."
    );
  }
  if (!ALLOWED_CONFIDENCES.has(finding.confidence)) {
    throw new BaselinePolicyError(
      "INVALID_CONFIDENCE",
      `Invalid finding confidence "${String(finding.confidence)}".`
    );
  }

  const normalizedFile =
    finding.file !== undefined ? normalizeFindingPath(finding.file) : "";

  const line = finding.line ?? 0;
  if (
    finding.line !== undefined &&
    (!Number.isInteger(finding.line) || finding.line < 1 || finding.line > 1_000_000)
  ) {
    throw new BaselinePolicyError(
      "INVALID_LINE",
      "Finding line must be a positive integer."
    );
  }

  const column = finding.column ?? 0;
  if (
    finding.column !== undefined &&
    (!Number.isInteger(finding.column) || finding.column < 1 || finding.column > 100_000)
  ) {
    throw new BaselinePolicyError(
      "INVALID_COLUMN",
      "Finding column must be a positive integer."
    );
  }

  const canonicalPayload = JSON.stringify({
    ruleId: finding.ruleId,
    file: normalizedFile,
    line,
    column,
    message: finding.message.trim()
  });

  return crypto.createHash("sha256").update(canonicalPayload, "utf8").digest("hex");
}

function parseUtcTimestamp(input, label) {
  if (input instanceof Date) {
    const ms = input.getTime();
    if (Number.isNaN(ms)) {
      throw new BaselinePolicyError("INVALID_TIMESTAMP", `Invalid Date for ${label}.`);
    }
    return ms;
  }
  if (typeof input === "number") {
    if (!Number.isFinite(input)) {
      throw new BaselinePolicyError("INVALID_TIMESTAMP", `Invalid numeric timestamp for ${label}.`);
    }
    return input;
  }
  if (typeof input === "string") {
    if (!UTC_ISO_TIMESTAMP_PATTERN.test(input)) {
      throw new BaselinePolicyError(
        "NON_UTC_TIMESTAMP",
        `${label} must be an explicit UTC ISO-8601 timestamp ending in Z or +00:00 (received "${input}").`
      );
    }
    const ms = Date.parse(input);
    if (Number.isNaN(ms)) {
      throw new BaselinePolicyError(
        "INVALID_TIMESTAMP",
        `${label} could not be parsed as a valid calendar timestamp: "${input}".`
      );
    }
    return ms;
  }
  throw new BaselinePolicyError(
    "INVALID_TIMESTAMP",
    `${label} must be an ISO-8601 UTC string, Date, or epoch milliseconds.`
  );
}

/**
 * Validates a single baseline entry against ForgeCheck review and expiry rules.
 */
export function validateBaselineEntry(entry, index = 0) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new BaselinePolicyError(
      "INVALID_BASELINE_ENTRY",
      `Baseline entry at index ${index} must be a non-null object.`
    );
  }

  // Reject wildcard / overbroad exemption fields
  for (const key of ["ruleId", "file", "pattern", "glob"]) {
    if (typeof entry[key] === "string" && /[*?[\]]/.test(entry[key])) {
      throw new BaselinePolicyError(
        "WILDCARD_EXEMPTION_REJECTED",
        `Baseline entry at index ${index} uses prohibited wildcard pattern in "${key}".`
      );
    }
  }

  if (
    typeof entry.ruleId === "string" &&
    !RULE_ID_SAFE_PATTERN.test(entry.ruleId)
  ) {
    throw new BaselinePolicyError(
      "INVALID_BASELINE_RULE_ID",
      `Baseline entry at index ${index} has invalid ruleId "${entry.ruleId}".`
    );
  }

  if (
    typeof entry.fingerprint !== "string" ||
    !FINGERPRINT_HEX_PATTERN.test(entry.fingerprint)
  ) {
    throw new BaselinePolicyError(
      "MALFORMED_FINGERPRINT",
      `Baseline entry at index ${index} must have a 64-character lowercase hex SHA-256 fingerprint.`
    );
  }

  const rationale = entry.rationale ?? entry.reason;
  if (typeof rationale !== "string" || rationale.trim().length < 5) {
    throw new BaselinePolicyError(
      "MISSING_RATIONALE",
      `Baseline entry at index ${index} requires a meaningful non-empty review rationale.`
    );
  }

  if (typeof entry.owner !== "string" || entry.owner.trim().length === 0) {
    throw new BaselinePolicyError(
      "MISSING_OWNER",
      `Baseline entry at index ${index} requires a non-empty owner.`
    );
  }

  let expiresAtMs = null;
  let expiresAtIso = undefined;
  if (entry.expiresAt !== undefined && entry.expiresAt !== null) {
    expiresAtMs = parseUtcTimestamp(entry.expiresAt, `Baseline entry[${index}].expiresAt`);
    expiresAtIso = new Date(expiresAtMs).toISOString();
  }

  const normalizedFile =
    entry.file !== undefined ? normalizeFindingPath(entry.file) : undefined;

  return {
    fingerprint: entry.fingerprint,
    ruleId: entry.ruleId,
    file: normalizedFile,
    rationale: rationale.trim(),
    owner: entry.owner.trim(),
    expiresAt: expiresAtIso,
    expiresAtMs,
    allowConfirmedFailure: entry.allowConfirmedFailure === true,
    auditReference:
      typeof entry.auditReference === "string" ? entry.auditReference.trim() : undefined
  };
}

function normalizeCloneFinding(finding) {
  const clone = structuredClone(finding);
  if (clone.file !== undefined) {
    clone.file = normalizeFindingPath(clone.file);
  }
  return clone;
}

function compareFindingOrder(a, b) {
  return (
    a.finding.ruleId.localeCompare(b.finding.ruleId) ||
    (a.finding.file ?? "").localeCompare(b.finding.file ?? "") ||
    (a.finding.line ?? 0) - (b.finding.line ?? 0) ||
    (a.finding.column ?? 0) - (b.finding.column ?? 0) ||
    a.fingerprint.localeCompare(b.fingerprint)
  );
}

/**
 * Evaluates a complete ScanResult against a reviewed baseline without mutating inputs.
 */
export function evaluateFindingBaseline(scanResult, baselineInput, options = {}) {
  if (!scanResult || typeof scanResult !== "object" || Array.isArray(scanResult)) {
    throw new BaselinePolicyError(
      "INVALID_SCAN_RESULT",
      "scanResult must be a valid ScanResult object."
    );
  }

  if (scanResult.status === "unavailable") {
    throw new BaselinePolicyError(
      "UNAVAILABLE_SCAN_RESULT",
      `Cannot apply finding baseline to an unavailable scan result: ${scanResult.reason || "no reason provided"}`
    );
  }

  if (scanResult.status !== "complete" || !Array.isArray(scanResult.findings)) {
    throw new BaselinePolicyError(
      "INVALID_SCAN_RESULT",
      'scanResult must have status: "complete" and a findings array.'
    );
  }

  const rawEntries = Array.isArray(baselineInput)
    ? baselineInput
    : baselineInput && typeof baselineInput === "object" && Array.isArray(baselineInput.entries)
      ? baselineInput.entries
      : null;

  if (!rawEntries) {
    throw new BaselinePolicyError(
      "INVALID_BASELINE",
      "Baseline must be an array of entries or an object with an entries array."
    );
  }

  const clockValue =
    typeof options.clock === "function"
      ? options.clock()
      : options.now !== undefined
        ? options.now
        : new Date();
  const nowMs = parseUtcTimestamp(clockValue, "options.now");
  const evaluatedAt = new Date(nowMs).toISOString();
  const allowConfirmedFailureOverride = options.allowConfirmedFailureOverride === true;

  // Validate and index baseline entries, rejecting duplicate fingerprints
  const baselineByFingerprint = new Map();
  rawEntries.forEach((raw, idx) => {
    const validated = validateBaselineEntry(raw, idx);
    if (baselineByFingerprint.has(validated.fingerprint)) {
      throw new BaselinePolicyError(
        "DUPLICATE_BASELINE_ENTRY",
        `Duplicate baseline entry for fingerprint "${validated.fingerprint}".`
      );
    }
    baselineByFingerprint.set(validated.fingerprint, validated);
  });

  const active = [];
  const baselined = [];
  const expired = [];
  const matchedFingerprints = new Set();

  for (const rawFinding of scanResult.findings) {
    const fingerprint = computeFindingFingerprint(rawFinding);
    const finding = normalizeCloneFinding(rawFinding);
    const entry = baselineByFingerprint.get(fingerprint);

    if (!entry) {
      active.push({ finding, fingerprint });
      continue;
    }

    // Optional cross-check if entry specifies ruleId or file
    if (entry.ruleId !== undefined && entry.ruleId !== finding.ruleId) {
      throw new BaselinePolicyError(
        "BASELINE_RULE_MISMATCH",
        `Baseline entry for fingerprint "${fingerprint}" expected ruleId "${entry.ruleId}" but matched "${finding.ruleId}".`
      );
    }
    if (entry.file !== undefined && entry.file !== (finding.file ?? "")) {
      throw new BaselinePolicyError(
        "BASELINE_FILE_MISMATCH",
        `Baseline entry for fingerprint "${fingerprint}" expected file "${entry.file}" but matched "${finding.file ?? ""}".`
      );
    }

    // Never suppress confirmed-failure by default
    if (finding.confidence === "confirmed-failure") {
      if (
        !allowConfirmedFailureOverride ||
        !entry.allowConfirmedFailure ||
        !entry.auditReference
      ) {
        throw new BaselinePolicyError(
          "CONFIRMED_FAILURE_SUPPRESSION_REFUSED",
          `Refusing to suppress confirmed-failure finding (${finding.ruleId}) without explicit audited override.`
        );
      }
    }

    matchedFingerprints.add(fingerprint);

    const publicEntry = {
      fingerprint: entry.fingerprint,
      rationale: entry.rationale,
      owner: entry.owner,
      ...(entry.ruleId !== undefined ? { ruleId: entry.ruleId } : {}),
      ...(entry.file !== undefined ? { file: entry.file } : {}),
      ...(entry.expiresAt !== undefined ? { expiresAt: entry.expiresAt } : {}),
      ...(entry.allowConfirmedFailure ? { allowConfirmedFailure: true } : {}),
      ...(entry.auditReference ? { auditReference: entry.auditReference } : {})
    };

    if (entry.expiresAtMs !== null && entry.expiresAtMs <= nowMs) {
      expired.push({
        finding,
        fingerprint,
        baseline: publicEntry
      });
    } else {
      baselined.push({
        finding,
        fingerprint,
        baseline: publicEntry
      });
    }
  }

  active.sort(compareFindingOrder);
  baselined.sort(compareFindingOrder);
  expired.sort(compareFindingOrder);

  const unmatchedBaselineEntries = [];
  for (const [fp, entry] of baselineByFingerprint.entries()) {
    if (!matchedFingerprints.has(fp)) {
      unmatchedBaselineEntries.push({
        fingerprint: entry.fingerprint,
        rationale: entry.rationale,
        owner: entry.owner,
        ...(entry.ruleId !== undefined ? { ruleId: entry.ruleId } : {}),
        ...(entry.file !== undefined ? { file: entry.file } : {}),
        ...(entry.expiresAt !== undefined ? { expiresAt: entry.expiresAt } : {})
      });
    }
  }
  unmatchedBaselineEntries.sort((a, b) => a.fingerprint.localeCompare(b.fingerprint));

  return {
    evaluatedAt,
    active,
    baselined,
    expired,
    unmatchedBaselineEntries,
    summary: {
      totalFindings: scanResult.findings.length,
      activeCount: active.length,
      baselinedCount: baselined.length,
      expiredCount: expired.length,
      unmatchedBaselineCount: unmatchedBaselineEntries.length
    }
  };
}
