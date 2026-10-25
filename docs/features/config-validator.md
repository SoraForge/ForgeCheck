# Local configuration validator (#29)

Standalone Node 22+ ES module, not yet connected to ForgeCheck CLI. A caller passes an object to `validateConfig()` or UTF-8 bytes/JSON text to `parseConfig()`. It returns `{ok, diagnostics, config?}`; the normalized `config` exists **only when valid**. The validator never executes code or makes network requests.

```js
import {parseConfig} from './src/modules/config-validator/index.mjs';
const checked = parseConfig('{"schemaVersion":1,"include":["src/**/*.ts"],"report":{"mode":"json","output":"reports/check.json"}}');
if (!checked.ok) throw new Error(JSON.stringify(checked.diagnostics));
console.log(checked.config);
```

Format v1:

```json
{
  "schemaVersion": 1,
  "include": ["**/*"],
  "exclude": ["**/node_modules/**"],
  "enabledRules": ["sdk.version"],
  "report": {"mode": "json", "output": "reports/forgecheck.json"},
  "limits": {"maxFiles": 10000, "maxFileBytes": 1048576}
}
```

All properties are optional for version 1; missing input to `validateConfig` produces safe defaults (no filesystem or network operation). An empty `enabledRules` is no rule filter, not a command to disable the scanner. `include`/`exclude` accept safe relative glob patterns with `*`, `?`, standalone `**` and simple character classes. No braces, extglobs, negation, traversal, Windows separators or absolute paths. `report.output` is only project-relative; the validator does **not** create it or check symlink traversal. Limits: maxFiles 1–100000 and maxFileBytes 1–104857600. Config parsing capped at 64 KiB, max 128 patterns per list and 256 rule IDs. Unknown keys cause errors with a near-spelling hint. `schemaVersion: 2` will be rejected until explicit versioned compatibility is implemented; additions should require schema review and migration tests.

`node --test tests/config-validator.test.mjs`
