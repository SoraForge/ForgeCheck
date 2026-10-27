import {
  MAX_REPORT_FILE_BYTES,
  exportFilteredReport,
  filterAndGroupFindings,
  parseReportPayload,
  sanitizeEvidenceUrl
} from "./report-model.mjs";

const SAMPLE_REPORTS = {
  complete: {
    status: "complete",
    filesScanned: 18,
    rulesEvaluated: 9,
    findings: [
      {
        ruleId: "SOROBAN-RPC-001",
        message: "Deprecated getTransactionStatus method detected; migrate to getTransaction.",
        confidence: "confirmed-failure",
        file: "src/rpc/client.ts",
        line: 42,
        column: 9,
        severity: "high",
        remediation: "Update Soroban RPC client calls to use getTransaction and handle NOT_FOUND.",
        evidenceUrls: [
          "https://developers.stellar.org/docs/data/rpc/api-reference/methods/getTransaction"
        ]
      },
      {
        ruleId: "HORIZON-FEE-003",
        message: "Hardcoded base fee (100 stroops) may underbid during network surge pricing.",
        confidence: "review-required",
        file: "src/tx/builder.ts",
        line: 88,
        severity: "medium",
        remediation: "Query fee_stats or configure a dynamic maximum fee ceiling."
      },
      {
        ruleId: "SEP-0010-AUTH",
        message: "Client domain verification optional branch was not statically evaluated.",
        confidence: "not-evaluated",
        file: "src/auth/sep10.ts",
        line: 15,
        severity: "info"
      }
    ]
  },
  unavailable: {
    status: "unavailable",
    reason: "Offline repository snapshot did not include Cargo.lock or package.json manifests."
  }
};

const state = {
  report: null,
  sourceName: "",
  search: "",
  confidence: "all",
  severity: "all",
  groupBy: "none",
  selectedFinding: null
};

function createBadge(text, className) {
  const span = document.createElement("span");
  span.className = `badge ${className}`;
  span.textContent = text;
  return span;
}

function showValidationError(message) {
  const alertEl = document.getElementById("validation-alert");
  if (!alertEl) return;
  if (!message) {
    alertEl.hidden = true;
    alertEl.textContent = "";
    return;
  }
  alertEl.hidden = false;
  alertEl.textContent = message;
}

function renderDetailPane(finding) {
  const container = document.getElementById("finding-detail-content");
  if (!container) return;
  container.replaceChildren();

  if (!finding) {
    const empty = document.createElement("p");
    empty.className = "muted-placeholder";
    empty.textContent = "Select a finding from the list (Enter or click) to inspect full details.";
    container.appendChild(empty);
    return;
  }

  const header = document.createElement("div");
  header.className = "detail-badges";
  header.appendChild(createBadge(finding.confidence, `confidence-${finding.confidence}`));
  if (finding.severity) {
    header.appendChild(createBadge(finding.severity, `severity-${finding.severity}`));
  }

  const title = document.createElement("h3");
  title.className = "detail-title";
  title.textContent = finding.ruleId;

  const msg = document.createElement("p");
  msg.className = "detail-message";
  msg.textContent = finding.message;

  const meta = document.createElement("dl");
  meta.className = "detail-dl";

  const addMetaRow = (label, valueText, isCode = false) => {
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    if (isCode) {
      const code = document.createElement("code");
      code.textContent = valueText;
      dd.appendChild(code);
    } else {
      dd.textContent = valueText;
    }
    meta.append(dt, dd);
  };

  const loc = finding.file
    ? `${finding.file}${finding.line ? `:${finding.line}` : ""}${
        finding.column ? `:${finding.column}` : ""
      }`
    : "Project-wide (no file location)";
  addMetaRow("Source Location", loc, true);

  if (finding.remediation) {
    addMetaRow("Remediation", finding.remediation, false);
  }

  container.append(header, title, msg, meta);

  if (Array.isArray(finding.evidenceUrls) && finding.evidenceUrls.length > 0) {
    const urlsTitle = document.createElement("h4");
    urlsTitle.className = "evidence-heading";
    urlsTitle.textContent = "Reference Documentation";
    const ul = document.createElement("ul");
    ul.className = "evidence-list";
    for (const rawUrl of finding.evidenceUrls) {
      const safe = sanitizeEvidenceUrl(rawUrl);
      if (!safe) continue;
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = safe;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = safe;
      li.appendChild(a);
      ul.appendChild(li);
    }
    container.append(urlsTitle, ul);
  }
}

function renderReportView() {
  const unavailableScreen = document.getElementById("unavailable-screen");
  const unavailableReason = document.getElementById("unavailable-reason");
  const completeScreen = document.getElementById("complete-screen");
  const emptyInitial = document.getElementById("empty-initial-screen");
  const exportBtn = document.getElementById("export-btn");
  const sourceLabel = document.getElementById("loaded-source-label");

  if (sourceLabel) {
    sourceLabel.textContent = state.sourceName
      ? `Loaded: ${state.sourceName}`
      : "No report loaded";
  }

  if (!state.report) {
    emptyInitial.hidden = false;
    unavailableScreen.hidden = true;
    completeScreen.hidden = true;
    exportBtn.disabled = true;
    return;
  }

  emptyInitial.hidden = true;
  exportBtn.disabled = false;

  if (state.report.status === "unavailable") {
    unavailableScreen.hidden = false;
    completeScreen.hidden = true;
    unavailableReason.textContent = state.report.reason;
    return;
  }

  unavailableScreen.hidden = true;
  completeScreen.hidden = false;

  const { filteredFindings, groups, countsByConfidence } = filterAndGroupFindings(
    state.report,
    state
  );

  document.getElementById("stat-total").textContent = String(state.report.findings.length);
  document.getElementById("stat-confirmed").textContent = String(
    countsByConfidence["confirmed-failure"]
  );
  document.getElementById("stat-review").textContent = String(
    countsByConfidence["review-required"]
  );
  document.getElementById("stat-not-eval").textContent = String(
    countsByConfidence["not-evaluated"]
  );
  document.getElementById("stat-matching").textContent = String(filteredFindings.length);

  const listContainer = document.getElementById("findings-groups-container");
  const noMatchesBanner = document.getElementById("no-matches-banner");
  listContainer.replaceChildren();

  if (filteredFindings.length === 0) {
    noMatchesBanner.hidden = false;
    noMatchesBanner.textContent =
      state.report.findings.length === 0
        ? "This complete ScanResult contains 0 findings."
        : "No findings match the active search or filter criteria.";
    state.selectedFinding = null;
    renderDetailPane(null);
    return;
  }

  noMatchesBanner.hidden = true;
  if (!state.selectedFinding || !filteredFindings.includes(state.selectedFinding)) {
    state.selectedFinding = filteredFindings[0];
  }

  for (const group of groups) {
    const section = document.createElement("section");
    section.className = "finding-group";

    if (state.groupBy !== "none") {
      const h3 = document.createElement("h3");
      h3.className = "group-heading";
      h3.textContent = `${group.label} (${group.findings.length})`;
      section.appendChild(h3);
    }

    const ul = document.createElement("ul");
    ul.className = "finding-list";
    ul.setAttribute("role", "listbox");
    ul.setAttribute("aria-label", group.label);

    for (const finding of group.findings) {
      const li = document.createElement("li");
      li.className =
        finding === state.selectedFinding ? "finding-row is-selected" : "finding-row";
      li.tabIndex = 0;
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", finding === state.selectedFinding ? "true" : "false");

      const topRow = document.createElement("div");
      topRow.className = "finding-row-top";

      const ruleSpan = document.createElement("span");
      ruleSpan.className = "finding-rule";
      ruleSpan.textContent = finding.ruleId;

      topRow.appendChild(ruleSpan);
      topRow.appendChild(createBadge(finding.confidence, `confidence-${finding.confidence}`));
      if (finding.severity) {
        topRow.appendChild(createBadge(finding.severity, `severity-${finding.severity}`));
      }

      const msgP = document.createElement("p");
      msgP.className = "finding-row-message";
      msgP.textContent = finding.message;

      const locSpan = document.createElement("span");
      locSpan.className = "finding-row-location";
      locSpan.textContent = finding.file
        ? `${finding.file}${finding.line ? `:${finding.line}` : ""}`
        : "Project-wide";

      li.append(topRow, msgP, locSpan);

      const selectRow = () => {
        state.selectedFinding = finding;
        renderReportView();
      };

      li.addEventListener("click", selectRow);
      li.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          selectRow();
        }
      });

      ul.appendChild(li);
    }

    section.appendChild(ul);
    listContainer.appendChild(section);
  }

  renderDetailPane(state.selectedFinding);
}

function loadRawReport(rawText, sourceName, byteSize) {
  const res = parseReportPayload(rawText, { byteSize });
  if (!res.ok) {
    showValidationError(res.error);
    return;
  }
  showValidationError("");
  state.report = res.report;
  state.sourceName = sourceName;
  state.selectedFinding = null;
  renderReportView();
}

function initViewer() {
  const fileInput = document.getElementById("report-file-input");
  const searchInput = document.getElementById("search-input");
  const confidenceSelect = document.getElementById("confidence-filter");
  const severitySelect = document.getElementById("severity-filter");
  const groupSelect = document.getElementById("group-by-select");
  const exportBtn = document.getElementById("export-btn");
  const sampleCompleteBtn = document.getElementById("load-sample-complete");
  const sampleUnavailableBtn = document.getElementById("load-sample-unavailable");

  fileInput?.addEventListener("change", async (ev) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_REPORT_FILE_BYTES) {
      showValidationError(
        `File "${file.name}" (${file.size} bytes) exceeds the 5 MiB safety limit.`
      );
      return;
    }
    const text = await file.text();
    loadRawReport(text, file.name, file.size);
  });

  searchInput?.addEventListener("input", (ev) => {
    state.search = ev.target.value;
    renderReportView();
  });

  confidenceSelect?.addEventListener("change", (ev) => {
    state.confidence = ev.target.value;
    renderReportView();
  });

  severitySelect?.addEventListener("change", (ev) => {
    state.severity = ev.target.value;
    renderReportView();
  });

  groupSelect?.addEventListener("change", (ev) => {
    state.groupBy = ev.target.value;
    renderReportView();
  });

  sampleCompleteBtn?.addEventListener("click", () => {
    loadRawReport(
      JSON.stringify(SAMPLE_REPORTS.complete),
      "sample-complete.json"
    );
  });

  sampleUnavailableBtn?.addEventListener("click", () => {
    loadRawReport(
      JSON.stringify(SAMPLE_REPORTS.unavailable),
      "sample-unavailable.json"
    );
  });

  exportBtn?.addEventListener("click", () => {
    if (!state.report) return;
    const json = exportFilteredReport(state.report, state);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "forgecheck-filtered-report.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });

  renderReportView();
}

if (typeof document !== "undefined") {
  initViewer();
}
