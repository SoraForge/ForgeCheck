import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MAX_REPORT_FILE_BYTES,
  escapeHtml,
  exportFilteredReport,
  filterAndGroupFindings,
  parseReportPayload,
  renderFindingDetailHtml,
  sanitizeEvidenceUrl
} from "../apps/report-viewer/report-model.mjs";
import { createViewerServer } from "../apps/report-viewer/server.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VIEWER_DIR = path.join(ROOT, "apps/report-viewer");
const FIXTURES_DIR = path.join(VIEWER_DIR, "fixtures");

test("loads sample complete and unavailable reports and rejects malformed or oversize inputs", () => {
  const completeRaw = fs.readFileSync(path.join(FIXTURES_DIR, "sample-complete.json"), "utf8");
  const completeRes = parseReportPayload(completeRaw);
  assert.equal(completeRes.ok, true);
  assert.equal(completeRes.report.status, "complete");
  assert.equal(completeRes.report.findings.length, 3);

  const unavailableRaw = fs.readFileSync(
    path.join(FIXTURES_DIR, "sample-unavailable.json"),
    "utf8"
  );
  const unavailableRes = parseReportPayload(unavailableRaw);
  assert.equal(unavailableRes.ok, true);
  assert.equal(unavailableRes.report.status, "unavailable");
  assert.match(unavailableRes.report.reason, /Cargo\.lock/);

  // Malformed JSON
  const badJson = parseReportPayload("{not-valid-json");
  assert.equal(badJson.ok, false);
  assert.equal(badJson.code, "MALFORMED_JSON");

  // Oversize file rejected by byteSize or string byte length
  const oversize = parseReportPayload(completeRaw, {
    byteSize: MAX_REPORT_FILE_BYTES + 1
  });
  assert.equal(oversize.ok, false);
  assert.equal(oversize.code, "FILE_TOO_LARGE");

  const smallCap = parseReportPayload("x".repeat(512), { maxBytes: 128 });
  assert.equal(smallCap.ok, false);
  assert.equal(smallCap.code, "FILE_TOO_LARGE");

  // Invalid ScanResult variants
  for (const invalidPayload of [
    JSON.stringify({ status: "unknown" }),
    JSON.stringify({ status: "unavailable", reason: "  " }),
    JSON.stringify({ status: "unavailable", reason: "no scanner", findings: [] }),
    JSON.stringify({
      status: "complete",
      findings: [{ ruleId: "R1", message: "msg", confidence: "wrong" }]
    })
  ]) {
    const res = parseReportPayload(invalidPayload);
    assert.equal(res.ok, false);
  }
});

test("filters by search text, confidence, severity, groups by rule/file, and exports valid ScanResult JSON", () => {
  const completeRaw = fs.readFileSync(path.join(FIXTURES_DIR, "sample-complete.json"), "utf8");
  const { report } = parseReportPayload(completeRaw);

  // Filter by confidence
  const confirmedOnly = filterAndGroupFindings(report, {
    confidence: "confirmed-failure"
  });
  assert.equal(confirmedOnly.filteredFindings.length, 1);
  assert.equal(confirmedOnly.filteredFindings[0].ruleId, "SOROBAN-RPC-001");
  assert.deepEqual(confirmedOnly.countsByConfidence, {
    "confirmed-failure": 1,
    "review-required": 1,
    "not-evaluated": 1
  });

  // Search text across remediation and file path
  const searchFee = filterAndGroupFindings(report, { search: "fee_stats" });
  assert.equal(searchFee.filteredFindings.length, 1);
  assert.equal(searchFee.filteredFindings[0].ruleId, "HORIZON-FEE-003");

  // Group by ruleId and file
  const byRule = filterAndGroupFindings(report, { groupBy: "rule" });
  assert.deepEqual(
    byRule.groups.map((g) => g.key),
    ["HORIZON-FEE-003", "SEP-0010-AUTH", "SOROBAN-RPC-001"]
  );

  const byFile = filterAndGroupFindings(report, { groupBy: "file" });
  assert.deepEqual(
    byFile.groups.map((g) => g.key),
    ["src/auth/sep10.ts", "src/rpc/client.ts", "src/tx/builder.ts"]
  );

  // Export filtered subset and re-validate with parseReportPayload
  const exportedJson = exportFilteredReport(report, {
    confidence: "review-required"
  });
  const reparsed = parseReportPayload(exportedJson);
  assert.equal(reparsed.ok, true);
  assert.equal(reparsed.report.status, "complete");
  assert.equal(reparsed.report.findings.length, 1);
  assert.equal(reparsed.report.findings[0].ruleId, "HORIZON-FEE-003");
});

test("XSS fixture containing <script> and javascript: URI is sanitized and displayed inertly", () => {
  const xssRaw = fs.readFileSync(path.join(FIXTURES_DIR, "sample-xss.json"), "utf8");
  const parsed = parseReportPayload(xssRaw);
  assert.equal(parsed.ok, true);

  const finding = parsed.report.findings[0];
  // javascript:alert(1) must be stripped during parsing
  assert.deepEqual(finding.evidenceUrls, ["https://developers.stellar.org/docs"]);
  assert.equal(sanitizeEvidenceUrl("javascript:alert(1)"), null);
  assert.equal(sanitizeEvidenceUrl("data:text/html,<script>alert(1)</script>"), null);

  const html = renderFindingDetailHtml(finding);
  assert.equal(html.includes("<script>"), false);
  assert.equal(html.includes("<img"), false);
  assert.equal(html.includes("<svg"), false);
  assert.equal(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"), true);
  assert.equal(escapeHtml('<script>alert("xss")</script>'), "&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;");
});

test("viewer assets enforce offline CSP, contain no external scripts/network calls, and static server blocks traversal", async () => {
  const html = fs.readFileSync(path.join(VIEWER_DIR, "index.html"), "utf8");
  const appJs = fs.readFileSync(path.join(VIEWER_DIR, "app.mjs"), "utf8");

  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /connect-src 'none'/);
  assert.equal(/https?:\/\//i.test(html), false, "index.html must not load external URLs");
  assert.equal(/\bfetch\s*\(/.test(appJs), false, "app.mjs must not perform network fetch calls");

  const server = createViewerServer(VIEWER_DIR);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const indexRes = await fetch(`${baseUrl}/`);
    assert.equal(indexRes.status, 200);
    const indexText = await indexRes.text();
    assert.match(indexText, /ForgeCheck Report Viewer/);

    const traversalRes = await fetch(`${baseUrl}/../../package.json`);
    assert.equal([403, 404].includes(traversalRes.status), true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
