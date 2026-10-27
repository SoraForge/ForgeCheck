import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SCHEMA_VERSION = "1.0.0";
export const SCHEMA_DRAFT = "https://json-schema.org/draft/2020-12/schema";
export const DEFAULT_MAX_REPORT_BYTES = 5 * 1024 * 1024;
export const DEFAULT_MAX_FINDINGS = 10_000;
export const MAX_LINE_NUMBER = 1_000_000;
export const MAX_COLUMN_NUMBER = 100_000;
export const MAX_FILES_SCANNED = 10_000_000;
export const MAX_RULES_EVALUATED = 100_000;

export const ALLOWED_CONFIDENCES = Object.freeze([
  "confirmed-failure",
  "review-required",
  "not-evaluated"
]);

export const ALLOWED_SEVERITIES = Object.freeze([
  "critical",
  "high",
  "medium",
  "low",
  "info"
]);

const RULE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const DISALLOWED_CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const ALL_CONTROL_CHARS = /[\u0000-\u001F\u007F]/;

const SCHEMA_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../schemas/scan-result.schema.json"
);

let cachedSchema = null;

/**
 * Loads and returns a defensive deep copy of `schemas/scan-result.schema.json`.
 */
export function loadScanResultSchema() {
  if (!cachedSchema) {
    cachedSchema = JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf8"));
  }
  return structuredClone(cachedSchema);
}

function isPlainObject(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isSafeRelativeFilePath(file) {
  if (typeof file !== "string" || file.length < 1 || file.length > 1024) {
    return false;
  }
  if (ALL_CONTROL_CHARS.test(file)) {
    return false;
  }
  if (file.startsWith("/") || file.startsWith("\\") || /^[A-Za-z]:/.test(file)) {
    return false;
  }
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(file)) {
    return false;
  }
  if (file.includes("//") || file.includes("\\\\")) {
    return false;
  }
  const segments = file.split(/[\\/]/);
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return false;
  }
  return true;
}

function isValidHttpUrl(value) {
  if (typeof value !== "string" || value.length < 8 || value.length > 2048) {
    return false;
  }
  if (ALL_CONTROL_CHARS.test(value) || /\s/.test(value)) {
    return false;
  }
  try {
    const parsed = new URL(value);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

function validateFinding(finding, index, errors) {
  const basePath = `$.findings[${index}]`;
  if (!isPlainObject(finding)) {
    errors.push({
      path: basePath,
      code: "INVALID_TYPE",
      message: "Each finding must be a plain JSON object."
    });
    return;
  }

  const allowedKeys = new Set([
    "ruleId",
    "message",
    "confidence",
    "file",
    "line",
    "column",
    "severity",
    "evidenceUrls",
    "remediation"
  ]);

  for (const key of Object.keys(finding)) {
    if (!allowedKeys.has(key)) {
      errors.push({
        path: `${basePath}.${key}`,
        code: "ADDITIONAL_PROPERTY",
        message: `Unexpected property "${key}" on ScanFinding.`
      });
    }
  }

  // ruleId
  if (typeof finding.ruleId !== "string" || finding.ruleId.trim().length === 0) {
    errors.push({
      path: `${basePath}.ruleId`,
      code: "INVALID_RULE_ID",
      message: "ruleId is required and must be a non-empty string."
    });
  } else if (!RULE_ID_PATTERN.test(finding.ruleId)) {
    errors.push({
      path: `${basePath}.ruleId`,
      code: "INVALID_RULE_ID_FORMAT",
      message:
        "ruleId must be 1..128 characters matching ^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$."
    });
  }

  // message
  if (
    typeof finding.message !== "string" ||
    finding.message.trim().length === 0 ||
    finding.message.length > 4096 ||
    DISALLOWED_CONTROL_CHARS.test(finding.message)
  ) {
    errors.push({
      path: `${basePath}.message`,
      code: "INVALID_MESSAGE",
      message:
        "message is required, must be 1..4096 characters, and must not contain binary control characters."
    });
  }

  // confidence
  if (
    typeof finding.confidence !== "string" ||
    !ALLOWED_CONFIDENCES.includes(finding.confidence)
  ) {
    errors.push({
      path: `${basePath}.confidence`,
      code: "INVALID_CONFIDENCE",
      message: `confidence must be one of: ${ALLOWED_CONFIDENCES.join(", ")}.`
    });
  }

  // file
  const hasFile = finding.file !== undefined;
  if (hasFile && !isSafeRelativeFilePath(finding.file)) {
    errors.push({
      path: `${basePath}.file`,
      code: "INVALID_FILE_PATH",
      message:
        "file must be a safe relative path (1..1024 chars) without traversal (..), root prefixes, or control characters."
    });
  }

  // line
  const hasLine = finding.line !== undefined;
  if (hasLine) {
    if (!hasFile) {
      errors.push({
        path: `${basePath}.line`,
        code: "DEPENDENT_REQUIRED_FILE",
        message: "line requires file to be present on the finding."
      });
    }
    if (
      typeof finding.line !== "number" ||
      !Number.isInteger(finding.line) ||
      finding.line < 1 ||
      finding.line > MAX_LINE_NUMBER
    ) {
      errors.push({
        path: `${basePath}.line`,
        code: "INVALID_LINE",
        message: `line must be an integer between 1 and ${MAX_LINE_NUMBER}.`
      });
    }
  }

  // column
  const hasColumn = finding.column !== undefined;
  if (hasColumn) {
    if (!hasFile || !hasLine) {
      errors.push({
        path: `${basePath}.column`,
        code: "DEPENDENT_REQUIRED_LINE",
        message: "column requires both file and line to be present on the finding."
      });
    }
    if (
      typeof finding.column !== "number" ||
      !Number.isInteger(finding.column) ||
      finding.column < 1 ||
      finding.column > MAX_COLUMN_NUMBER
    ) {
      errors.push({
        path: `${basePath}.column`,
        code: "INVALID_COLUMN",
        message: `column must be an integer between 1 and ${MAX_COLUMN_NUMBER}.`
      });
    }
  }

  // severity
  if (
    finding.severity !== undefined &&
    (typeof finding.severity !== "string" || !ALLOWED_SEVERITIES.includes(finding.severity))
  ) {
    errors.push({
      path: `${basePath}.severity`,
      code: "INVALID_SEVERITY",
      message: `severity must be one of: ${ALLOWED_SEVERITIES.join(", ")}.`
    });
  }

  // evidenceUrls
  if (finding.evidenceUrls !== undefined) {
    if (!Array.isArray(finding.evidenceUrls) || finding.evidenceUrls.length > 32) {
      errors.push({
        path: `${basePath}.evidenceUrls`,
        code: "INVALID_EVIDENCE_URLS",
        message: "evidenceUrls must be an array of at most 32 unique HTTP(S) URLs."
      });
    } else {
      const seen = new Set();
      finding.evidenceUrls.forEach((url, urlIdx) => {
        if (!isValidHttpUrl(url)) {
          errors.push({
            path: `${basePath}.evidenceUrls[${urlIdx}]`,
            code: "INVALID_EVIDENCE_URL",
            message: "Each evidenceUrl must be a valid http:// or https:// URI (8..2048 chars)."
          });
        } else if (seen.has(url)) {
          errors.push({
            path: `${basePath}.evidenceUrls[${urlIdx}]`,
            code: "DUPLICATE_EVIDENCE_URL",
            message: `Duplicate evidenceUrl "${url}" is not allowed.`
          });
        } else {
          seen.add(url);
        }
      });
    }
  }

  // remediation
  if (finding.remediation !== undefined) {
    if (
      typeof finding.remediation !== "string" ||
      finding.remediation.trim().length === 0 ||
      finding.remediation.length > 4096 ||
      DISALLOWED_CONTROL_CHARS.test(finding.remediation)
    ) {
      errors.push({
        path: `${basePath}.remediation`,
        code: "INVALID_REMEDIATION",
        message:
          "remediation must be a non-empty string (1..4096 chars) without binary control characters."
      });
    }
  }
}

/**
 * Validates an in-memory ScanResult object against `schemas/scan-result.schema.json`.
 */
export function validateScanResult(input, options = {}) {
  const maxFindings = options.maxFindings ?? DEFAULT_MAX_FINDINGS;
  const errors = [];

  if (!isPlainObject(input)) {
    return {
      valid: false,
      schemaVersion: SCHEMA_VERSION,
      errors: [
        {
          path: "$",
          code: "INVALID_ROOT_TYPE",
          message: "ScanResult must be a non-null plain JSON object."
        }
      ]
    };
  }

  if (input.status === "unavailable") {
    const allowed = new Set(["status", "reason"]);
    for (const key of Object.keys(input)) {
      if (!allowed.has(key)) {
        errors.push({
          path: `$.${key}`,
          code: "ADDITIONAL_PROPERTY",
          message: `Unexpected property "${key}" on UnavailableScanResult.`
        });
      }
    }

    if (
      typeof input.reason !== "string" ||
      input.reason.trim().length === 0 ||
      input.reason.length > 2048 ||
      DISALLOWED_CONTROL_CHARS.test(input.reason)
    ) {
      errors.push({
        path: "$.reason",
        code: "INVALID_REASON",
        message:
          "UnavailableScanResult.reason is required and must be a non-empty string (1..2048 chars)."
      });
    }
  } else if (input.status === "complete") {
    const allowed = new Set(["status", "findings", "filesScanned", "rulesEvaluated"]);
    for (const key of Object.keys(input)) {
      if (!allowed.has(key)) {
        errors.push({
          path: `$.${key}`,
          code: "ADDITIONAL_PROPERTY",
          message: `Unexpected property "${key}" on CompleteScanResult.`
        });
      }
    }

    if (!Array.isArray(input.findings)) {
      errors.push({
        path: "$.findings",
        code: "INVALID_FINDINGS_ARRAY",
        message: "CompleteScanResult.findings is required and must be an array."
      });
    } else if (input.findings.length > maxFindings) {
      errors.push({
        path: "$.findings",
        code: "FINDINGS_LIMIT_EXCEEDED",
        message: `findings array length (${input.findings.length}) exceeds maximum allowed (${maxFindings}).`
      });
    } else {
      input.findings.forEach((finding, idx) => validateFinding(finding, idx, errors));
    }

    if (input.filesScanned !== undefined) {
      if (
        typeof input.filesScanned !== "number" ||
        !Number.isInteger(input.filesScanned) ||
        input.filesScanned < 0 ||
        input.filesScanned > MAX_FILES_SCANNED
      ) {
        errors.push({
          path: "$.filesScanned",
          code: "INVALID_FILES_SCANNED",
          message: `filesScanned must be an integer between 0 and ${MAX_FILES_SCANNED}.`
        });
      }
    }

    if (input.rulesEvaluated !== undefined) {
      if (
        typeof input.rulesEvaluated !== "number" ||
        !Number.isInteger(input.rulesEvaluated) ||
        input.rulesEvaluated < 0 ||
        input.rulesEvaluated > MAX_RULES_EVALUATED
      ) {
        errors.push({
          path: "$.rulesEvaluated",
          code: "INVALID_RULES_EVALUATED",
          message: `rulesEvaluated must be an integer between 0 and ${MAX_RULES_EVALUATED}.`
        });
      }
    }
  } else {
    errors.push({
      path: "$.status",
      code: "INVALID_STATUS",
      message: 'ScanResult.status must be either "complete" or "unavailable".'
    });
  }

  if (errors.length > 0) {
    return {
      valid: false,
      schemaVersion: SCHEMA_VERSION,
      errors
    };
  }

  return {
    valid: true,
    schemaVersion: SCHEMA_VERSION,
    errors: [],
    value: structuredClone(input)
  };
}

/**
 * Safely parses and validates a raw JSON string or Buffer against ScanResult schema bounds.
 */
export function validateScanResultJson(rawJson, options = {}) {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_REPORT_BYTES;

  if (typeof rawJson !== "string" && !Buffer.isBuffer(rawJson)) {
    return {
      valid: false,
      schemaVersion: SCHEMA_VERSION,
      errors: [
        {
          path: "$",
          code: "INVALID_INPUT_BUFFER",
          message: "Input must be a UTF-8 JSON string or Buffer."
        }
      ]
    };
  }

  const byteLength = Buffer.isBuffer(rawJson)
    ? rawJson.byteLength
    : Buffer.byteLength(rawJson, "utf8");

  if (byteLength > maxBytes) {
    return {
      valid: false,
      schemaVersion: SCHEMA_VERSION,
      errors: [
        {
          path: "$",
          code: "INPUT_TOO_LARGE",
          message: `JSON payload size (${byteLength} bytes) exceeds maximum allowed (${maxBytes} bytes).`
        }
      ]
    };
  }

  let parsed;
  try {
    const text = Buffer.isBuffer(rawJson) ? rawJson.toString("utf8") : rawJson;
    parsed = JSON.parse(text);
  } catch (err) {
    return {
      valid: false,
      schemaVersion: SCHEMA_VERSION,
      errors: [
        {
          path: "$",
          code: "INVALID_JSON",
          message: `Failed to parse JSON: ${err instanceof Error ? err.message : String(err)}`
        }
      ]
    };
  }

  return validateScanResult(parsed, options);
}
