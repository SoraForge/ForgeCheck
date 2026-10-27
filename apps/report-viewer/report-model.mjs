export const MAX_REPORT_FILE_BYTES = 5 * 1024 * 1024;

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

/**
 * Escapes untrusted strings for safe inert HTML text rendering.
 */
export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Validates that an evidence URL uses http: or https: and contains no control characters.
 */
export function sanitizeEvidenceUrl(rawUrl) {
  if (typeof rawUrl !== "string" || rawUrl.length < 8 || rawUrl.length > 2048) {
    return null;
  }
  if (/[\u0000-\u001F\u007F\s]/.test(rawUrl)) {
    return null;
  }
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.href;
  } catch {
    return null;
  }
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parses and validates a local JSON report payload against the ForgeCheck ScanResult contract.
 */
export function parseReportPayload(rawText, options = {}) {
  const maxBytes = options.maxBytes ?? MAX_REPORT_FILE_BYTES;
  const declaredByteSize = options.byteSize;

  if (typeof declaredByteSize === "number" && declaredByteSize > maxBytes) {
    return {
      ok: false,
      code: "FILE_TOO_LARGE",
      error: `Report file size (${declaredByteSize} bytes) exceeds maximum limit (${maxBytes} bytes).`
    };
  }

  if (typeof rawText !== "string") {
    return {
      ok: false,
      code: "INVALID_INPUT",
      error: "Report content must be a UTF-8 JSON string."
    };
  }

  const encoder = new TextEncoder();
  const actualBytes = encoder.encode(rawText).byteLength;
  if (actualBytes > maxBytes) {
    return {
      ok: false,
      code: "FILE_TOO_LARGE",
      error: `Report payload (${actualBytes} bytes) exceeds maximum limit (${maxBytes} bytes).`
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch (err) {
    return {
      ok: false,
      code: "MALFORMED_JSON",
      error: `Malformed JSON report: ${err instanceof Error ? err.message : String(err)}`
    };
  }

  if (!isPlainObject(parsed)) {
    return {
      ok: false,
      code: "INVALID_ROOT",
      error: "Report root must be a JSON object."
    };
  }

  if (parsed.status === "unavailable") {
    if (typeof parsed.reason !== "string" || parsed.reason.trim().length === 0) {
      return {
        ok: false,
        code: "INVALID_UNAVAILABLE_REASON",
        error: 'Unavailable ScanResult requires a non-empty string "reason".'
      };
    }
    if ("findings" in parsed) {
      return {
        ok: false,
        code: "INVALID_UNAVAILABLE_SHAPE",
        error: 'Unavailable ScanResult must not contain a "findings" property.'
      };
    }
    return {
      ok: true,
      report: {
        status: "unavailable",
        reason: parsed.reason.trim()
      }
    };
  }

  if (parsed.status !== "complete") {
    return {
      ok: false,
      code: "INVALID_STATUS",
      error: 'ScanResult status must be "complete" or "unavailable".'
    };
  }

  if (!Array.isArray(parsed.findings)) {
    return {
      ok: false,
      code: "INVALID_FINDINGS",
      error: 'Complete ScanResult requires a "findings" array.'
    };
  }

  const validatedFindings = [];
  for (let i = 0; i < parsed.findings.length; i += 1) {
    const f = parsed.findings[i];
    if (!isPlainObject(f)) {
      return {
        ok: false,
        code: "INVALID_FINDING_ITEM",
        error: `Finding at index ${i} must be an object.`
      };
    }
    if (typeof f.ruleId !== "string" || f.ruleId.trim().length === 0) {
      return {
        ok: false,
        code: "INVALID_RULE_ID",
        error: `Finding at index ${i} is missing a non-empty "ruleId".`
      };
    }
    if (typeof f.message !== "string" || f.message.trim().length === 0) {
      return {
        ok: false,
        code: "INVALID_MESSAGE",
        error: `Finding at index ${i} is missing a non-empty "message".`
      };
    }
    if (!ALLOWED_CONFIDENCES.includes(f.confidence)) {
      return {
        ok: false,
        code: "INVALID_CONFIDENCE",
        error: `Finding at index ${i} has unsupported confidence "${String(f.confidence)}".`
      };
    }
    if (f.line !== undefined && (!Number.isInteger(f.line) || f.line < 1)) {
      return {
        ok: false,
        code: "INVALID_LINE",
        error: `Finding at index ${i} has invalid line number "${String(f.line)}".`
      };
    }
    if (f.column !== undefined && (!Number.isInteger(f.column) || f.column < 1)) {
      return {
        ok: false,
        code: "INVALID_COLUMN",
        error: `Finding at index ${i} has invalid column number "${String(f.column)}".`
      };
    }
    if (f.severity !== undefined && !ALLOWED_SEVERITIES.includes(f.severity)) {
      return {
        ok: false,
        code: "INVALID_SEVERITY",
        error: `Finding at index ${i} has invalid severity "${String(f.severity)}".`
      };
    }

    const safeUrls = Array.isArray(f.evidenceUrls)
      ? f.evidenceUrls.map(sanitizeEvidenceUrl).filter(Boolean)
      : undefined;

    validatedFindings.push({
      ruleId: f.ruleId.trim(),
      message: f.message,
      confidence: f.confidence,
      ...(typeof f.file === "string" && f.file.trim().length > 0
        ? { file: f.file.trim().replace(/\\/g, "/") }
        : {}),
      ...(f.line !== undefined ? { line: f.line } : {}),
      ...(f.column !== undefined ? { column: f.column } : {}),
      ...(f.severity !== undefined ? { severity: f.severity } : {}),
      ...(safeUrls && safeUrls.length > 0 ? { evidenceUrls: safeUrls } : {}),
      ...(typeof f.remediation === "string" && f.remediation.trim().length > 0
        ? { remediation: f.remediation }
        : {})
    });
  }

  return {
    ok: true,
    report: {
      status: "complete",
      findings: validatedFindings,
      ...(Number.isInteger(parsed.filesScanned) && parsed.filesScanned >= 0
        ? { filesScanned: parsed.filesScanned }
        : {}),
      ...(Number.isInteger(parsed.rulesEvaluated) && parsed.rulesEvaluated >= 0
        ? { rulesEvaluated: parsed.rulesEvaluated }
        : {})
    }
  };
}

/**
 * Filters and groups findings from a complete ScanResult according to search, confidence, severity, and groupBy.
 */
export function filterAndGroupFindings(report, filterState = {}) {
  if (!report || report.status !== "complete" || !Array.isArray(report.findings)) {
    return {
      filteredFindings: [],
      groups: [],
      countsByConfidence: {
        "confirmed-failure": 0,
        "review-required": 0,
        "not-evaluated": 0
      }
    };
  }

  const query = typeof filterState.search === "string" ? filterState.search.trim().toLowerCase() : "";
  const confidence = filterState.confidence ?? "all";
  const severity = filterState.severity ?? "all";
  const groupBy = filterState.groupBy ?? "none";

  const countsByConfidence = {
    "confirmed-failure": 0,
    "review-required": 0,
    "not-evaluated": 0
  };

  for (const f of report.findings) {
    if (f.confidence in countsByConfidence) {
      countsByConfidence[f.confidence] += 1;
    }
  }

  const filteredFindings = report.findings.filter((f) => {
    if (confidence !== "all" && f.confidence !== confidence) {
      return false;
    }
    if (severity !== "all" && (f.severity ?? "unspecified") !== severity) {
      return false;
    }
    if (query.length > 0) {
      const haystack = [
        f.ruleId,
        f.message,
        f.file ?? "",
        f.remediation ?? "",
        f.confidence,
        f.severity ?? ""
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(query)) {
        return false;
      }
    }
    return true;
  });

  if (groupBy === "none") {
    return {
      filteredFindings,
      groups:
        filteredFindings.length > 0
          ? [{ key: "all", label: "All Matching Findings", findings: filteredFindings }]
          : [],
      countsByConfidence
    };
  }

  const map = new Map();
  for (const f of filteredFindings) {
    const key =
      groupBy === "rule"
        ? f.ruleId
        : f.file && f.file.length > 0
          ? f.file
          : "(Project-wide / No file)";
    if (!map.has(key)) {
      map.set(key, []);
    }
    map.get(key).push(f);
  }

  const groups = Array.from(map.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, findings]) => ({
      key,
      label: key,
      findings
    }));

  return {
    filteredFindings,
    groups,
    countsByConfidence
  };
}

/**
 * Exports a valid ScanResult JSON string containing only the currently filtered findings.
 */
export function exportFilteredReport(report, filterState = {}) {
  if (!report || typeof report !== "object") {
    throw new Error("Cannot export from an empty report state.");
  }
  if (report.status === "unavailable") {
    return JSON.stringify(
      {
        status: "unavailable",
        reason: report.reason
      },
      null,
      2
    );
  }
  const { filteredFindings } = filterAndGroupFindings(report, filterState);
  const exported = {
    status: "complete",
    findings: filteredFindings,
    ...(report.filesScanned !== undefined ? { filesScanned: report.filesScanned } : {}),
    ...(report.rulesEvaluated !== undefined ? { rulesEvaluated: report.rulesEvaluated } : {})
  };
  return JSON.stringify(exported, null, 2);
}

/**
 * Renders an inert HTML fragment for a finding detail view (used in unit tests and accessible preview).
 */
export function renderFindingDetailHtml(finding) {
  if (!finding) {
    return '<div class="empty-detail">Select a finding to inspect details.</div>';
  }
  const location = finding.file
    ? `${escapeHtml(finding.file)}${finding.line ? `:${Number(finding.line)}` : ""}${
        finding.column ? `:${Number(finding.column)}` : ""
      }`
    : "Project-level (no file location)";

  const evidenceItems = Array.isArray(finding.evidenceUrls)
    ? finding.evidenceUrls
        .map(sanitizeEvidenceUrl)
        .filter(Boolean)
        .map(
          (url) =>
            `<li><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(
              url
            )}</a></li>`
        )
        .join("")
    : "";

  return [
    `<article class="finding-detail-card" aria-label="Finding ${escapeHtml(finding.ruleId)}">`,
    `  <header class="detail-header">`,
    `    <span class="badge confidence-${escapeHtml(finding.confidence)}">${escapeHtml(
      finding.confidence
    )}</span>`,
    finding.severity
      ? `    <span class="badge severity-${escapeHtml(finding.severity)}">${escapeHtml(
          finding.severity
        )}</span>`
      : "",
    `    <h3 class="detail-rule-id">${escapeHtml(finding.ruleId)}</h3>`,
    `  </header>`,
    `  <p class="detail-message">${escapeHtml(finding.message)}</p>`,
    `  <dl class="detail-meta">`,
    `    <dt>Location</dt><dd><code>${location}</code></dd>`,
    finding.remediation
      ? `    <dt>Remediation</dt><dd>${escapeHtml(finding.remediation)}</dd>`
      : "",
    `  </dl>`,
    evidenceItems ? `  <ul class="evidence-list">${evidenceItems}</ul>` : "",
    `</article>`
  ]
    .filter(Boolean)
    .join("\n");
}
