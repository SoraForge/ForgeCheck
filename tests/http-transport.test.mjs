import test from 'node:test';
import assert from 'node:assert/strict';
import { createHttpTransport, TransportError } from '../src/modules/http-transport/index.mjs';

const ORIGIN='https://rpc.example.test';
const resp=(body='ok',status=200,headers={})=>new Response(body,{status,headers});
const client=(fetchImpl,other={})=>createHttpTransport({
  enabled:true,allowedOrigins:[ORIGIN],fetchImpl,
  baseDelayMs:10,maxDelayMs:1000,random:()=>0,
  ...other,
});
const fails=(promise,code)=>assert.rejects(promise,err=>err instanceof TransportError&&err.code===code);

test('network disabled by default even when origin is present',async()=>{
  let called=false;
  const c=createHttpTransport({allowedOrigins:[ORIGIN],fetchImpl:async()=>{called=true;}});
  await fails(c.request(ORIGIN),'NETWORK_DISABLED');
  assert.equal(called,false);
});
test('exact origin allowlist, TLS and credentialed URLs enforced',async()=>{
  const c=client(async()=>resp());
  await fails(c.request('https://evil.example.test'),'DISALLOWED_ORIGIN');
  await fails(c.request('http://rpc.example.test'),'TLS_REQUIRED');
  await fails(c.request('https://rpc.example.test:8545'),'DISALLOWED_ORIGIN');
  await fails(c.request('https://user:pass@rpc.example.test'),'INVALID_URL');
});
test('localhost, private-name and IP-literal URLs denied even if allowlisted',async()=>{
  for(const origin of ['https://localhost','https://127.0.0.1','https://[::1]','https://foo.internal']) {
    const c=client(async()=>resp(),{allowedOrigins:[new URL(origin).origin]});
    await fails(c.request(origin),'PRIVATE_HOST');
  }
});
test('successful bounded GET omits browser credentials and uses manual redirects',async()=>{
  const calls=[];
  const c=client(async(url,init)=>{calls.push({url,redirect:init.redirect,credentials:init.credentials});return resp('yes');});
  const data=await c.request(ORIGIN+'/health');
  assert.equal(data.status,200);
  assert.equal(new TextDecoder().decode(data.body),'yes');
  assert.deepEqual(calls,[{url:ORIGIN+'/health',redirect:'manual',credentials:'omit'}]);
});
test('bounded retry with 429 Retry-After followed by 503',async()=>{
  let n=0;const delays=[];
  const c=client(async()=>{
    n++;
    return n===1?resp('',429,{'Retry-After':'90'}):n===2?resp('',503):resp('ready');
  },{sleep:async ms=>delays.push(ms)});
  const res=await c.request(ORIGIN+'/api');
  assert.equal(new TextDecoder().decode(res.body),'ready');
  assert.equal(n,3);
  assert.deepEqual(delays,[1000,10]);
});
test('does not retry 400, non-idempotent POST or past attempt limit',async()=>{
  for(const [method,status,attempts] of [['GET',400,1],['POST',503,1],['GET',503,2]]) {
    let calls=0;
    const c=client(async()=>{calls++;return resp('failed',status);},{maxAttempts:attempts,sleep:async()=>{}});
    await fails(c.request(ORIGIN+'/api',{method}),'HTTP_ERROR');
    assert.equal(calls,attempts);
  }
});
test('redirect revalidates every target and accepts approved relative path',async()=>{
  const c=client(async url=>url.endsWith('/first')?resp('',302,{Location:'/second'}):resp('success'));
  const result=await c.request(ORIGIN+'/first');
  assert.equal(new TextDecoder().decode(result.body),'success');
  await fails(client(async()=>resp('',302,{Location:'https://evil.example.test'})).request(ORIGIN),'DISALLOWED_ORIGIN');
  await fails(client(async()=>resp('',302,{Location:'https://localhost'})).request(ORIGIN),'PRIVATE_HOST');
});
test('redirect cap prevents loops and POST never follows redirects',async()=>{
  const c=client(async()=>resp('',302,{Location:'/again'}),{maxRedirects:1});
  await fails(c.request(ORIGIN+'/again'),'REDIRECT_LIMIT');
  await fails(c.request(ORIGIN+'/again',{method:'POST'}),'REDIRECT_NOT_ALLOWED');
});
test('Content-Length and streamed response are bounded',async()=>{
  const first=client(async()=>resp('big',200,{'Content-Length':'99'}),{maxResponseBytes:3});
  await fails(first.request(ORIGIN),'RESPONSE_TOO_LARGE');
  const second=client(async()=>resp('many bytes',200),{maxResponseBytes:4});
  await fails(second.request(ORIGIN),'RESPONSE_TOO_LARGE');
});
test('caller cancellation wins and is not converted to a timeout',async()=>{
  const own=new AbortController();
  const fake=async(_url,init)=>new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(new Error('private info')),{once:true}));
  const pending=client(fake,{timeoutMs:10000}).request(ORIGIN,{signal:own.signal});
  own.abort();
  await fails(pending,'ABORTED');
});
test('timeout aborts an in-flight request',async()=>{
  const fake=async(_url,init)=>new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(new Error('sensitive')),{once:true}));
  await fails(client(fake,{timeoutMs:5}).request(ORIGIN),'TIMEOUT');
});
test('never exposes raw secrets from fetch errors',async()=>{
  const c=client(async()=>{throw new Error('Bearer extremely-secret');});
  await assert.rejects(c.request(ORIGIN,{headers:{Authorization:'Bearer secret'}}),err=>
    err.code==='NETWORK_FAILURE' && !JSON.stringify(err).includes('secret') && !err.message.includes('secret'));
});
test('invalid option bounds fail closed',()=>{
  assert.throws(()=>createHttpTransport({maxAttempts:100}),/maxAttempts/);
  assert.throws(()=>createHttpTransport({maxResponseBytes:0}),/maxResponseBytes/);
});
