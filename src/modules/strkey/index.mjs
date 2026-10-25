/**
 * Offline SEP-23 StrKey primitives: G (account), C (contract) and M (muxed account).
 * Never attempts to decode secret-seed variants. No network or Stellar SDK dependency.
 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const VERSIONS = Object.freeze({ account: 6 << 3, contract: 2 << 3, 'muxed-account': 12 << 3 });
const PAYLOAD_LENGTHS = Object.freeze({ account: 32, contract: 32, 'muxed-account': 40 });
const PREFIXES = Object.freeze({ G: 'account', C: 'contract', M: 'muxed-account' });

function err(code, message) { return { valid: false, kind: null, code, message }; }

export function crc16Xmodem(bytes) {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

export function encodeBase32(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('Expected Uint8Array');
  let bits = 0, buffer = 0, out = '';
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += ALPHABET[(buffer >>> bits) & 31];
    }
    buffer &= (1 << bits) - 1;
  }
  if (bits) out += ALPHABET[(buffer << (5 - bits)) & 31];
  return out;
}

export function decodeBase32(value) {
  if (typeof value !== 'string' || !value.length || !/^[A-Z2-7]+$/.test(value)) {
    throw new Error('Base32 must be nonempty uppercase RFC4648 without padding');
  }
  if ([1, 3, 6].includes(value.length % 8)) throw new Error('Invalid Base32 length');
  let bits = 0, buffer = 0;
  const bytes = [];
  for (const char of value) {
    const pos = ALPHABET.indexOf(char);
    if (pos < 0) throw new Error('Invalid Base32 alphabet');
    buffer = (buffer << 5) | pos;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >>> bits) & 255);
    }
    buffer &= (1 << bits) - 1;
  }
  const result = Uint8Array.from(bytes);
  if (encodeBase32(result) !== value) throw new Error('Non-canonical Base32 trailing bits');
  return result;
}

export function encodeStrKey(kind, payload) {
  const version = VERSIONS[kind];
  if (version === undefined) throw new RangeError('Unsupported StrKey variant');
  if (!(payload instanceof Uint8Array) || payload.length !== PAYLOAD_LENGTHS[kind]) {
    throw new RangeError('StrKey payload length does not match variant');
  }
  const framed = new Uint8Array(1 + payload.length + 2);
  framed[0] = version;
  framed.set(payload, 1);
  const checksum = crc16Xmodem(framed.subarray(0, -2));
  framed[framed.length - 2] = checksum & 255;
  framed[framed.length - 1] = checksum >>> 8;
  return encodeBase32(framed);
}

export function classifyStrKey(value) {
  if (typeof value !== 'string' || !value.length || value.length > 128) {
    return err('MALFORMED', 'StrKey must be a nonempty bounded string');
  }
  if (!/^[A-Z2-7]+$/.test(value)) return err('MALFORMED', 'StrKey must use uppercase unpadded Base32');
  const kind = PREFIXES[value[0]];
  if (!kind) return err('UNSUPPORTED_VARIANT', 'This variant is not supported for address classification (including W and secret seeds)');
  const expectedLength = Math.ceil((PAYLOAD_LENGTHS[kind] + 3) * 8 / 5);
  if (value.length !== expectedLength) return err('WRONG_LENGTH', 'Incorrect encoded length for '+kind);
  let bytes;
  try { bytes = decodeBase32(value); }
  catch (cause) { return err('MALFORMED', cause.message); }
  if (bytes.length !== 1 + PAYLOAD_LENGTHS[kind] + 2) return err('WRONG_LENGTH', 'Incorrect decoded length');
  if (bytes[0] !== VERSIONS[kind]) return err('INVALID_VERSION', 'Incorrect StrKey version byte');
  const check = crc16Xmodem(bytes.subarray(0, -2));
  if (bytes.at(-2) !== (check & 255) || bytes.at(-1) !== (check >>> 8)) {
    return err('BAD_CHECKSUM', 'CRC16-XModem checksum mismatch');
  }
  const payload = bytes.subarray(1, -2);
  return {
    valid: true, kind,
    ...(kind === 'muxed-account'
      ? { accountId: encodeStrKey('account', payload.subarray(0, 32)), muxedId: new DataView(payload.buffer, payload.byteOffset + 32, 8).getBigUint64(0, false).toString() }
      : {}),
  };
}
