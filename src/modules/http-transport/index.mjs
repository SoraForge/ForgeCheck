import { isIP } from 'node:net';

/**
 * Offline-by-default, allowlisted HTTP client intended for optional RPC support.
 * It never reads environment secrets or performs scans.
 */
export class TransportError extends Error {
  constructor(code, status) {
    super(status === undefined ? 'Transport: ' + code : 'HTTP request failed (' + status + ')');
    this.name = 'TransportError';
    this.code = code;
    if (status !== undefined) this.status = status;
  }
}

const intIn = (x,lo,hi) => Number.isSafeInteger(x) && x>=lo && x<=hi;
function allowedOrigin(source) {
  let url;
  try { url = new URL(source); } catch { throw new TypeError('Invalid allowed origin'); }
  if (!['http:','https:'].includes(url.protocol) || !url.hostname ||
      url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
    throw new TypeError('Allowed origins must be scheme, host and optional port only');
  }
  return url.origin;
}
function privateHost(hostname) {
  const host=hostname.replace(/^\[|\]$/g,'').toLowerCase().replace(/\.$/,'');
  return host === 'localhost' || host.endsWith('.localhost') ||
    host.endsWith('.local') || host.endsWith('.internal') || isIP(host)!==0;
}
function authorize(input, policy) {
  let url;
  try { url = new URL(input); } catch { throw new TransportError('INVALID_URL'); }
  if (!['http:','https:'].includes(url.protocol) || !url.hostname || url.username || url.password) {
    throw new TransportError('INVALID_URL');
  }
  if (url.protocol === 'http:' && !policy.allowHttp) throw new TransportError('TLS_REQUIRED');
  if (privateHost(url.hostname) && !policy.allowPrivateHosts) throw new TransportError('PRIVATE_HOST');
  if (!policy.allowedOrigins.has(url.origin)) throw new TransportError('DISALLOWED_ORIGIN');
  url.hash='';
  return url;
}
const defaultSleep = (ms,signal) => new Promise((resolve,reject)=>{
  if (signal?.aborted) return reject(new TransportError('ABORTED'));
  const cleanup=()=>signal?.removeEventListener('abort',onAbort);
  const timer=setTimeout(()=>{cleanup();resolve();},ms);
  const onAbort=()=>{clearTimeout(timer);cleanup();reject(new TransportError('ABORTED'));};
  signal?.addEventListener('abort',onAbort,{once:true});
});
function delayFor(response, attempt, cfg) {
  const retryAfter=response.headers?.get?.('retry-after');
  if (retryAfter != null) {
    const seconds=Number(retryAfter);
    const calculated=Number.isFinite(seconds)&&seconds>=0 ? seconds*1000 : Date.parse(retryAfter)-Date.now();
    if (Number.isFinite(calculated)&&calculated>=0) return Math.min(cfg.maxDelayMs,calculated);
  }
  const random=cfg.random();
  const factor=Number.isFinite(random) ? .5+.5*Math.max(0,Math.min(1,random)) : .75;
  return Math.min(cfg.maxDelayMs, cfg.baseDelayMs*2**attempt*factor);
}
async function boundedBody(response, limit) {
  const declared=response.headers?.get?.('content-length');
  if (declared != null && /^\d+$/.test(declared) && Number(declared)>limit) {
    await response.body?.cancel?.().catch(()=>{});
    throw new TransportError('RESPONSE_TOO_LARGE');
  }
  if (!response.body?.getReader) {
    const bytes=new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength>limit) throw new TransportError('RESPONSE_TOO_LARGE');
    return bytes;
  }
  const reader=response.body.getReader();
  let total=0;
  const chunks=[];
  try {
    while (true) {
      const {done,value}=await reader.read();
      if (done) break;
      total+=value.byteLength;
      if (total>limit) throw new TransportError('RESPONSE_TOO_LARGE');
      chunks.push(value);
    }
  } catch(err) {
    await reader.cancel().catch(()=>{});
    throw err;
  } finally {
    reader.releaseLock();
  }
  const bytes=new Uint8Array(total);
  let offset=0;
  for (const chunk of chunks) {bytes.set(chunk,offset);offset+=chunk.byteLength;}
  return bytes;
}

/**
 * Explicitly opt-in to requests using exact origin allowlists. Inject fake fetch,
 * sleep and randomness for deterministic, offline tests.
 */
export function createHttpTransport(options={}) {
  const cfg={
    enabled:false, allowedOrigins:[], allowHttp:false,allowPrivateHosts:false,
    timeoutMs:5000,maxAttempts:3,maxRedirects:3,maxResponseBytes:1048576,
    baseDelayMs:100,maxDelayMs:5000,random:Math.random,sleep:defaultSleep,
    fetchImpl:globalThis.fetch, ...options,
  };
  for (const [key,lo,hi] of [
    ['timeoutMs',1,120000],['maxAttempts',1,5],['maxRedirects',0,5],
    ['maxResponseBytes',1,8388608],['baseDelayMs',0,5000],['maxDelayMs',0,10000],
  ]) {
    if (!intIn(cfg[key],lo,hi)) throw new RangeError('Invalid '+key);
  }
  if (!Array.isArray(cfg.allowedOrigins) ||
      cfg.allowedOrigins.some(value=>typeof value !== 'string')) {
    throw new TypeError('allowedOrigins must be an array');
  }
  for (const key of ['fetchImpl','sleep','random']) {
    if (typeof cfg[key] !== 'function') throw new TypeError('Invalid '+key);
  }
  const policy={...cfg,allowedOrigins:new Set(cfg.allowedOrigins.map(allowedOrigin))};
  return {
    async request(input,init={}) {
      if (!policy.enabled) throw new TransportError('NETWORK_DISABLED');
      if (!init || typeof init!=='object') throw new TypeError('Request options must be an object');
      const method=String(init.method??'GET').toUpperCase();
      if (!/^[A-Z]+$/.test(method)) throw new TransportError('INVALID_METHOD');
      const canRetry=method==='GET'||method==='HEAD';
      const signal=init.signal;
      if (signal?.aborted) throw new TransportError('ABORTED');
      const initial=authorize(input,policy);
      let current=initial, redirects=0, attempts=0;
      while (true) {
        const controller=new AbortController();
        let expired=false, delayMs;
        const onAbort=()=>controller.abort(signal?.reason);
        if (signal?.aborted) throw new TransportError('ABORTED');
        signal?.addEventListener('abort',onAbort,{once:true});
        const timer=setTimeout(()=>{expired=true;controller.abort();},policy.timeoutMs);
        try {
          // Manual redirect handling is mandatory to prevent bypassing origin checks.
          const response=await policy.fetchImpl(current.href,{
            ...init, method,signal:controller.signal,redirect:'manual',credentials:'omit',
          });
          if (!response || typeof response.status!=='number') throw new TransportError('BAD_RESPONSE');
          if ([301,302,303,307,308].includes(response.status)) {
            if (!canRetry) throw new TransportError('REDIRECT_NOT_ALLOWED');
            if (redirects>=policy.maxRedirects) throw new TransportError('REDIRECT_LIMIT');
            const location=response.headers?.get?.('location');
            if (!location) throw new TransportError('REDIRECT_INVALID');
            let redirectUrl;
            try { redirectUrl=new URL(location,current).href; }
            catch { throw new TransportError('REDIRECT_INVALID'); }
            const next=authorize(redirectUrl,policy);
            await response.body?.cancel?.().catch(()=>{});
            current=next; redirects++;
            continue;
          }
          if (response.status>=200 && response.status<300) {
            return {status:response.status,url:current.href,body:await boundedBody(response,policy.maxResponseBytes)};
          }
          if (canRetry && [429,502,503].includes(response.status) && attempts<policy.maxAttempts-1) {
            delayMs=delayFor(response,attempts,policy);
            attempts++;
            await response.body?.cancel?.().catch(()=>{});
          } else {
            throw new TransportError('HTTP_ERROR',response.status);
          }
        } catch(err) {
          if (expired) throw new TransportError('TIMEOUT');
          if (signal?.aborted) throw new TransportError('ABORTED');
          if (err instanceof TransportError) throw err;
          // Do not reveal raw fetch error messages; they can contain credentials.
          throw new TransportError('NETWORK_FAILURE');
        } finally {
          clearTimeout(timer);
          signal?.removeEventListener('abort',onAbort);
        }
        await policy.sleep(delayMs,signal);
        if (signal?.aborted) throw new TransportError('ABORTED');
        current=initial;
        redirects=0;
      }
    },
  };
}
