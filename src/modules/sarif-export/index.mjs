/** Standalone ForgeCheck ScanResult -> SARIF 2.1.0 converter. No network or CLI changes. */
const SCHEMA = 'https://json.schemastore.org/sarif-2.1.0.json';
const CONFIDENCE = new Set(['confirmed-failure', 'review-required', 'not-evaluated']);
const SEVERITY = new Set(['critical','high','medium','low','info']);
const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function checkText(value, label, max = 4000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new TypeError(label + ' must be a nonempty bounded string');
  }
}
function safeMessage(str) {
  return str.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '');
}
function safeRelativeUri(filepath) {
  checkText(filepath, 'file path', 2048);
  // This module uses only repository-relative POSIX paths: no drive, UNC, URL or traversal.
  if (filepath.startsWith('/') || filepath.includes('\\') || /:/.test(filepath) || filepath.includes('\0')) {
    throw new RangeError('File location must be a relative POSIX path');
  }
  const parts = filepath.split('/');
  if (parts.some(x => !x || x === '.' || x === '..')) throw new RangeError('Unsafe file path segment');
  return parts.map(encodeURIComponent).join('/');
}
function optionalPositiveInt(value, field) {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < 1)) {
    throw new RangeError(field + ' must be a positive integer');
  }
}
function optionalNonNegativeInt(value, field) {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
    throw new RangeError(field + ' must be a nonnegative integer');
  }
}
function ruleLevel(finding) {
  if (finding.confidence === 'not-evaluated') return 'note';
  if (finding.confidence === 'review-required') return 'warning';
  return finding.severity === 'critical' || finding.severity === 'high' ? 'error'
    : finding.severity === 'medium' || finding.severity === 'low' ? 'warning' : 'note';
}
function driver(rules) {
  return { name: 'ForgeCheck', informationUri: 'https://github.com/SoraForge/ForgeCheck',
    rules: rules.map(id => ({ id, shortDescription: { text: id } })) };
}
/**
 * @param {object} scan ScanResult as defined in src/contracts.ts
 * @returns {object} well-formed SARIF 2.1.0 log
 */
export function toSarif(scan) {
  if (!isObject(scan)) throw new TypeError('ScanResult must be an object');
  if (scan.status === 'unavailable') {
    checkText(scan.reason, 'unavailable reason');
    if (has(scan,'findings')) throw new TypeError('Unavailable scan cannot claim findings');
    const run = {
      tool: { driver: driver([]) },
      invocations: [{ executionSuccessful: false, toolExecutionNotifications:
        [{ level: 'error', message: { text: safeMessage(scan.reason) } }] }],
      results: null,
    };
    return { version: '2.1.0', $schema: SCHEMA, runs: [run] };
  }
  if (scan.status !== 'complete' || !Array.isArray(scan.findings) || scan.findings.length > 100000) {
    throw new TypeError('Complete ScanResult requires a bounded findings array');
  }
  optionalNonNegativeInt(scan.filesScanned, 'filesScanned');
  optionalNonNegativeInt(scan.rulesEvaluated, 'rulesEvaluated');
  const ruleIds = new Set();
  for (const f of scan.findings) {
    if (!isObject(f)) throw new TypeError('Finding must be an object');
    checkText(f.ruleId, 'ruleId', 512); checkText(f.message, 'message');
    if (!CONFIDENCE.has(f.confidence)) throw new TypeError('Unknown confidence');
    if (f.severity !== undefined && !SEVERITY.has(f.severity)) throw new TypeError('Unknown severity');
    if (f.file !== undefined) safeRelativeUri(f.file);
    optionalPositiveInt(f.line, 'line');
    optionalPositiveInt(f.column, 'column');
    if ((f.line !== undefined || f.column !== undefined) && f.file === undefined) {
      throw new TypeError('Source line or column requires file');
    }
    if (f.column !== undefined && f.line === undefined) throw new TypeError('Column requires line');
    ruleIds.add(f.ruleId);
  }
  const rules = [...ruleIds].sort();
  const ruleIndex = new Map(rules.map((id, index) => [id, index]));
  const results = scan.findings.map(f => {
    const output = {
      ruleId: f.ruleId, ruleIndex: ruleIndex.get(f.ruleId),
      level: ruleLevel(f),
      message: { text: safeMessage(f.message) },
      properties: { confidence: f.confidence, ...(f.severity ? { severity: f.severity } : {}) },
    };
    if (f.file) {
      const physicalLocation = { artifactLocation: { uri: safeRelativeUri(f.file), uriBaseId: '%SRCROOT%' } };
      if (f.line) physicalLocation.region = { startLine: f.line, ...(f.column ? { startColumn: f.column } : {}) };
      output.locations = [{ physicalLocation }];
    }
    return output;
  });
  const run = {
    tool: { driver: driver(rules) },
    originalUriBaseIds: { '%SRCROOT%': { uri: 'file:///' } },
    invocations: [{ executionSuccessful: true }],
    results,
    properties: {
      ...(scan.filesScanned === undefined ? {} : { filesScanned: scan.filesScanned }),
      ...(scan.rulesEvaluated === undefined ? {} : { rulesEvaluated: scan.rulesEvaluated }),
    },
  };
  return { version: '2.1.0', $schema: SCHEMA, runs: [run] };
}
