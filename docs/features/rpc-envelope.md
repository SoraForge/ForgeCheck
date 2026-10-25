# Offline JSON-RPC 2.0 envelope validator (#27)

Independent Node 22+ ES module; no network calls and no dependence on ForgeCheck scanner features.

```js
import { validateRpcResponse, validateRpcRequest } from './src/modules/rpc-envelope/index.mjs';
const report = validateRpcResponse('{"jsonrpc":"2.0","id":1,"result":null}');
if (!report.ok) console.error(report.diagnostics);
```

Use `validateRpcRequest()` for request batches, including notifications (requests **without** IDs). Responses always require `id`; an error that cannot determine the original ID may legitimately use `null`. Responses must contain **exactly one** of `result` and `error`. Batch IDs must be unique, including `null`. Returns `{ok, kind, count, notifications, diagnostics}`; never performs remote requests.

Accepts JSON text, UTF-8 bytes (fatal decoding), or JSON-compatible in-memory objects. Defaults: at most 1 MiB UTF-8 and 256 batch entries; callers can lower these limits. Diagnostics report structural issues with paths and codes, not raw payloads. Strict unknown-field rejection is intentional. JSON-RPC discourages fractional numeric IDs; this implementation requires integers. This tool checks generic envelopes only—not method-specific Stellar RPC semantics or whether an RPC response matches a request. JSON parsing itself can accept duplicate object property names (the JS JSON parser uses the last value); duplicate **batch IDs** are explicitly rejected.

`node --test tests/rpc-envelope.test.mjs`
