import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyStrKey, encodeStrKey, decodeBase32, encodeBase32, crc16Xmodem } from '../src/modules/strkey/index.mjs';

const G = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ';
const M = 'MA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUAAAAAAAAAAAACJUQ';

test('SEP-23 published G and M fixtures decode with valid checksums', () => {
  assert.deepEqual(classifyStrKey(G), {valid:true,kind:'account'});
  assert.deepEqual(classifyStrKey(M), {valid:true,kind:'muxed-account',accountId:G,muxedId:'0'});
});
test('G/M re-encode exactly and canonical C roundtrips', () => {
  for (const v of [G, M]) {
    const data = decodeBase32(v);
    const kind = v.startsWith('G') ? 'account' : 'muxed-account';
    assert.equal(encodeStrKey(kind, data.subarray(1, -2)), v);
  }
  const contract = encodeStrKey('contract', new Uint8Array(32).fill(4));
  assert.equal(contract[0], 'C');
  assert.deepEqual(classifyStrKey(contract), {valid:true,kind:'contract'});
});
test('CRC16-XModem known check vector', () => {
  assert.equal(crc16Xmodem(new TextEncoder().encode('123456789')), 0x31c3);
});
test('changed character fails checksum even if prefix and length look good', () => {
  const corrupt = G.slice(0, -2) + (G.at(-2)==='A'?'B':'A') + G.at(-1);
  assert.equal(classifyStrKey(corrupt).code, 'BAD_CHECKSUM');
});
test('rejects lower-case, padding and invalid base32 characters', () => {
  for (const value of [G.toLowerCase(),G+'=',G.slice(0,-1)+'0','']) {
    assert.equal(classifyStrKey(value).valid, false);
  }
});
test('rejects truncated input and incorrect payloads', () => {
  assert.equal(classifyStrKey(G.slice(0,-1)).code,'WRONG_LENGTH');
  assert.throws(()=>encodeStrKey('account',new Uint8Array(31)),/length/);
});
test('rejects noncanonical trailing Base32 bits in muxed keys', () => {
  const last = M.at(-1);
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const twin = alphabet[alphabet.indexOf(last)^1];
  assert.equal(classifyStrKey(M.slice(0,-1)+twin).valid,false);
  assert.notEqual(last,twin);
  assert.equal(encodeBase32(decodeBase32(G)),G);
});
test('unsupported W, secret seeds, other public signer prefixes are not treated as addresses',()=>{
  for (const prefix of ['W','S','T','P','X','L','B']) {
    assert.equal(classifyStrKey(prefix+G.slice(1)).code,'UNSUPPORTED_VARIANT');
  }
});
