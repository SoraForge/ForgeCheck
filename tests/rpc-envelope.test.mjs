import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateRpcResponse as response, validateRpcRequest as request } from '../src/modules/rpc-envelope/index.mjs';
const good = {jsonrpc:'2.0',id:1,result:{ledger:3}};
const error = {jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error',data:{detail:'x'}}};
function code(result, expected) { assert.equal(result.ok,false); assert.ok(result.diagnostics.some(x=>x.code===expected),JSON.stringify(result)); }
test('success, valid null result, null-id error and mixed response batches', () => {
  assert.equal(response(good).ok,true); assert.equal(response({...good,result:null}).ok,true);
  assert.equal(response(error).ok,true); assert.equal(response([good,error]).ok,true);
});
test('invalid version, missing id, both result/error and invalid error fields', () => {
  code(response({...good,jsonrpc:'1.0'}),'INVALID_VERSION');
  code(response({jsonrpc:'2.0',result:2}),'MISSING_ID');
  code(response({...good,error:{code:1,message:'oh'}}),'RESULT_ERROR_EXCLUSIVE');
  code(response({jsonrpc:'2.0',id:2,error:{code:'x',message:null}}),'INVALID_ERROR_CODE');
  code(response({jsonrpc:'2.0',id:2,error:[]}),'INVALID_ERROR');
});
test('rejects empty/oversized batches, duplicate IDs, and nested request fields in responses', () => {
  code(response([]),'EMPTY_BATCH');
  code(response([good,good]),'DUPLICATE_ID');
  code(response([good,error],{maxBatch:1}),'BATCH_TOO_LARGE');
  code(response({...good,method:'test'}),'REQUEST_FIELDS');
});
test('rejects invalid JSON, malformed UTF8 and oversized input', () => {
  code(response('{'),'INVALID_INPUT');
  code(response(Uint8Array.from([0xc3,0x28])),'INVALID_INPUT');
  code(response(JSON.stringify(good),{maxBytes:5}),'INVALID_INPUT');
  code(response({id:1, jsonrpc:'2.0',result:BigInt(5)}),'INVALID_INPUT');
});
test('request notifications are legal (including in a batch), but not response notifications', () => {
  const notification={jsonrpc:'2.0',method:'ledgerStats',params:[]};
  assert.deepEqual([request(notification).ok,request(notification).notifications],[true,1]);
  const mixed=request([notification,{...notification,id:2}]);
  assert.deepEqual([mixed.ok,mixed.notifications],[true,1]);
  code(response(notification),'MISSING_ID');
  code(request({...notification,params:null}),'INVALID_PARAMS');
});
test('ID zero and empty string are allowed; fractional and object ids are not', () => {
  assert.equal(response({...good,id:0}).ok,true);
  assert.equal(response({...good,id:''}).ok,true);
  code(response({...good,id:0.5}),'INVALID_ID');
  code(response({...good,id:{}}),'INVALID_ID');
});
