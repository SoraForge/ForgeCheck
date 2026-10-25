# Explicit opt-in RPC transport (#28)

A standalone Node 22+ HTTP utility, not a Stellar compatibility scanner and not wired into ForgeCheck's existing CLI. **No request occurs by default**. Enable it explicitly, supplying an exact origin allowlist.

```js
import { createHttpTransport } from './src/modules/http-transport/index.mjs';
const rpc = createHttpTransport({
  enabled: true,
  allowedOrigins: ['https://rpc.example.org'],
  timeoutMs: 5000,
  maxAttempts: 3,
  maxResponseBytes: 1048576,
});
const { status, body } = await rpc.request('https://rpc.example.org/health');
```

HTTPS is required by default; URLs containing credentials are rejected. Requests may only use exact allowed origins (including protocol and port); redirects are processed manually and checked through the same origin and private-host policy. IP literals and localhost/local/internal names are blocked by default, even if allowlisted; `allowPrivateHosts:true` is an explicit override for trusted local development. **Important limitation:** DNS rebinding/resolution to private IPs is *not* checked; run on a restricted egress network for untrusted destinations. Domain allowlisting is not a firewall.

Only GET and HEAD retry, and only for 429, 502 and 503. Retries have a bounded maximum and use capped Retry-After or exponential jittered backoff; POST requests are never automatically retried or redirected. Request timeouts and caller AbortSignal abort fetches. Responses are streamed and size-limited before buffering. `fetchImpl`, `sleep` and `random` are injectable for deterministic, network-free tests. Errors expose only `TransportError.code` and optional HTTP status, never raw upstream error messages, URLs containing credentials or Authorization headers.

Run: `node --test tests/http-transport.test.mjs`. No live external requests or secrets required.
