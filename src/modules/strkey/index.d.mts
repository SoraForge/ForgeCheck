export type StrKeyKind = 'account' | 'contract' | 'muxed-account';
export type StrKeyResult =
  | { valid: true; kind: StrKeyKind; accountId?: string; muxedId?: string }
  | { valid: false; kind: null; code: 'MALFORMED' | 'UNSUPPORTED_VARIANT' | 'WRONG_LENGTH' | 'INVALID_VERSION' | 'BAD_CHECKSUM'; message: string };
export function classifyStrKey(value: unknown): StrKeyResult;
export function encodeStrKey(kind: StrKeyKind, payload: Uint8Array): string;
export function encodeBase32(bytes: Uint8Array): string;
export function decodeBase32(value: string): Uint8Array;
export function crc16Xmodem(bytes: Uint8Array): number;
