# ForgeCheck Local Browser Report Viewer (`#35`)

Self-contained, offline browser application for exploring local ForgeCheck `ScanResult` JSON compatibility reports without hosted infrastructure, external CDNs, or network requests.

## Owned Paths

- `apps/report-viewer/**`
- `tests/report-viewer.test.mjs`

## Running Locally

### 1. Built-in Local Static Server

```bash
node apps/report-viewer/server.mjs
# Open http://127.0.0.1:4173 in your browser
```

### 2. Automated Unit & Security Tests

```bash
node --test tests/report-viewer.test.mjs
```

## Features

- **Local File Import**: Uses the browser `File` API (`<input type="file">`) with a strict `5 MiB` (`5,242,880` bytes) size ceiling. Report files never leave the browser.
- **Complete & Unavailable Report States**:
  - `status: "complete"`: Displays summary cards (`Total`, `confirmed-failure`, `review-required`, `not-evaluated`, `Matching Filter`), filter bar, grouped finding list, and detail inspector.
  - `status: "unavailable"`: Displays a dedicated warning screen with the reported `reason` so unavailable scans are never mistaken for clean passes.
- **Filtering, Grouping & Export**:
  - Text search across `ruleId`, `message`, `file`, `remediation`, `confidence`, and `severity`.
  - Filter by `confidence` and `severity`, and group by `none`, `rule` (`ruleId`), or `file`.
  - Export currently filtered findings as a valid `ScanResult` JSON download.
- **XSS & Privacy Hardening**:
  - Enforces a strict `Content-Security-Policy` (`default-src 'self'; connect-src 'none'`).
  - All untrusted strings (`ruleId`, `message`, `file`, `remediation`) are rendered via `textContent` / `escapeHtml()`.
  - `evidenceUrls` are validated to allow only `http://` and `https://` links (`javascript:` and `data:` URIs are stripped).

## Browser Smoke Test Checklist (Major Screen Sizes)

1. **Desktop (`1280x800`)**:
   - Launch `node apps/report-viewer/server.mjs` and open `http://127.0.0.1:4173`.
   - Click **Load Complete Sample** or import `apps/report-viewer/fixtures/sample-complete.json`.
   - Verify the 5-card summary bar and side-by-side findings list + sticky detail panel render cleanly.
2. **Tablet (`768x1024`) & Mobile (`390x844`)**:
   - Resize viewport to `390x844`.
   - Verify `.filter-bar` and `.workspace-split` collapse to a single-column vertical stack with accessible touch targets and no horizontal overflow.
3. **Keyboard & XSS Smoke Verification**:
   - Import `apps/report-viewer/fixtures/sample-xss.json`.
   - Use `Tab` and `Enter`/`Space` to select the finding; verify `<script>` tags appear literally as inert text and `javascript:alert(1)` is excluded from the reference links.

## Honest Limitations

- Operates strictly on local `ScanResult` JSON files; it does not invoke the CLI scanner or connect to Stellar RPC/Horizon endpoints.
