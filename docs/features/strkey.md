# Offline Stellar StrKey address classification (#25)

The standalone Node 22+ module `src/modules/strkey/index.mjs` supports **G account**, **C contract** and **M muxed account** addresses. It verifies strict RFC4648 uppercase unpadded Base32 including unused trailing bits, exact version/length and CRC16-XModem (low checksum byte first).

```js
import { classifyStrKey } from './src/modules/strkey/index.mjs';
const result = classifyStrKey('GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ');
if (!result.valid) console.error(result.code, result.message);
```

Results are `{valid:true,kind:'account'|'contract'|'muxed-account'}` (M also reports the underlying G-address and decimal unsigned muxed ID), or `{valid:false,kind:null,code,message}`. Supported encodings can be generated using `encodeStrKey(kind, Uint8Array)`. W (muxed contract) deliberately returns `UNSUPPORTED_VARIANT` pending separately verified SEP-23 vectors; secret-seed and other signing-related prefixes are likewise not decoded or displayed. No keys are signed and no network calls occur. A syntactically valid address is **not** necessarily an eligible recipient for a specific operation.

Reference: [Stellar SEP-23](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0023.md). Run: `node --test tests/strkey.test.mjs`.
