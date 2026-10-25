/** Offline JSON-RPC 2.0 envelope validation. No network requests or method simulation. */
import { TextDecoder } from 'node:util';

export const DEFAULT_MAX_BYTES = 1_048_576;
export const DEFAULT_MAX_BATCH = 256;
const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const idValid = (value) => value === null || typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value));
const loc = (path, key) => `${path}.${key}`;

function decode(input, maxBytes) {
  if (typeof input === 'string') {
    if (Buffer.byteLength(input, 'utf8') > maxBytes) throw new Error('Input exceeds maximum byte size');
    return JSON.parse(input);
  }
  if (input instanceof Uint8Array) {
    if (input.byteLength > maxBytes) throw new Error('Input exceeds maximum byte size');
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(input));
  }
  // In-memory objects are still bounded; non-JSON data is not accepted.
  let json;
  try { json = JSON.stringify(input); } catch { throw new Error('Input cannot be encoded as JSON'); }
  if (typeof json !== 'string') throw new Error('Input must be JSON data');
  if (Buffer.byteLength(json, 'utf8') > maxBytes) throw new Error('Input exceeds maximum byte size');
  return JSON.parse(json);
}

/**
 * @param {string|Uint8Array|unknown} input A JSON string, UTF-8 bytes, or JSON-compatible value.
 * @param {{kind?: 'request'|'response', maxBytes?: number, maxBatch?: number}} options
 * @returns {{ok: boolean, kind: string, count: number, notifications: number, diagnostics: {code:string,path:string,message:string}[]}}
 */
export function validateRpcEnvelope(input, options = {}) {
  const { kind = 'response', maxBytes = DEFAULT_MAX_BYTES, maxBatch = DEFAULT_MAX_BATCH } = options;
  if (!['request', 'response'].includes(kind)) throw new TypeError('kind must be request or response');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || !Number.isSafeInteger(maxBatch) || maxBatch < 1) throw new RangeError('Invalid limits');
  const diagnostics = [];
  const fail = (code, path, message) => diagnostics.push({ code, path, message });
  let value;
  try { value = decode(input, maxBytes); }
  catch (error) {
    fail('INVALID_INPUT', '$', error instanceof Error ? error.message : 'Invalid JSON input');
    return { ok: false, kind, count: 0, notifications: 0, diagnostics };
  }
  const batch = Array.isArray(value);
  const items = batch ? value : [value];
  if (batch && items.length === 0) fail('EMPTY_BATCH', '$', 'A batch must not be empty');
  if (items.length > maxBatch) {
    fail('BATCH_TOO_LARGE', '$', `Batch contains more than ${maxBatch} envelopes`);
    return { ok: false, kind, count: items.length, notifications: 0, diagnostics };
  }
  const ids = new Set();
  let notifications = 0;
  for (let i = 0; i < items.length; i++) {
    const p = batch ? `$[${i}]` : '$';
    const entry = items[i];
    if (!record(entry)) { fail('INVALID_ENVELOPE', p, 'Envelope must be a JSON object'); continue; }
    if (entry.jsonrpc !== '2.0') fail('INVALID_VERSION', loc(p, 'jsonrpc'), 'jsonrpc must be exactly "2.0"');
    const hasId = has(entry, 'id');
    if (hasId && !idValid(entry.id)) fail('INVALID_ID', loc(p, 'id'), 'id must be a string, integer number, or null');
    if (kind === 'response') {
      if (!hasId) fail('MISSING_ID', loc(p, 'id'), 'Responses require an id, including null for unknown IDs');
      const result = has(entry, 'result'), error = has(entry, 'error');
      if (result === error) fail('RESULT_ERROR_EXCLUSIVE', p, 'Response must have exactly one of result or error');
      if (error) {
        if (!record(entry.error)) fail('INVALID_ERROR', loc(p, 'error'), 'error must be an object');
        else {
          if (!Number.isSafeInteger(entry.error.code)) fail('INVALID_ERROR_CODE', loc(p, 'error.code'), 'error code must be an integer');
          if (typeof entry.error.message !== 'string') fail('INVALID_ERROR_MESSAGE', loc(p, 'error.message'), 'error message must be a string');
          for (const key of Object.keys(entry.error)) if (!['code', 'message', 'data'].includes(key)) fail('UNKNOWN_ERROR_KEY', loc(p, `error.${key}`), 'Unknown error field');
        }
      }
      if (has(entry, 'method') || has(entry, 'params')) fail('REQUEST_FIELDS', p, 'A response cannot contain method or params');
      for (const key of Object.keys(entry)) if (!['jsonrpc', 'id', 'result', 'error'].includes(key)) fail('UNKNOWN_FIELD', loc(p, key), 'Unknown response field');
    } else {
      if (typeof entry.method !== 'string' || entry.method.length === 0) fail('INVALID_METHOD', loc(p, 'method'), 'Request requires a non-empty method');
      if (has(entry, 'params') && !record(entry.params) && !Array.isArray(entry.params)) fail('INVALID_PARAMS', loc(p, 'params'), 'params must be an object or array');
      if (has(entry, 'result') || has(entry, 'error')) fail('RESPONSE_FIELDS', p, 'Requests cannot contain result or error');
      for (const key of Object.keys(entry)) if (!['jsonrpc', 'id', 'method', 'params'].includes(key)) fail('UNKNOWN_FIELD', loc(p, key), 'Unknown request field');
      if (!hasId) notifications++;
    }
    if (hasId && idValid(entry.id)) {
      const key = `${typeof entry.id}:${String(entry.id)}`;
      if (batch && ids.has(key)) fail('DUPLICATE_ID', loc(p, 'id'), 'Duplicate batch id');
      ids.add(key);
    }
  }
  return { ok: diagnostics.length === 0, kind, count: items.length, notifications, diagnostics };
}
export const validateRpcResponse = (input, options = {}) => validateRpcEnvelope(input, { ...options, kind: 'response' });
export const validateRpcRequest = (input, options = {}) => validateRpcEnvelope(input, { ...options, kind: 'request' });
