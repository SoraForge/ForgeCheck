#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  computeFindingFingerprint,
  evaluateFindingBaseline
} from "./index.mjs";

function printUsage(stream) {
  stream.write(
    "Usage:\n" +
      "  node src/modules/finding-baseline/cli.mjs <report.json> <baseline.json> [--now <ISO-UTC>] [--allow-confirmed-failure-override]\n" +
      "  node src/modules/finding-baseline/cli.mjs --print-fingerprints <report.json>\n"
  );
}

export function runCli(argv = process.argv.slice(2), io = { stdout: process.stdout, stderr: process.stderr }) {
  let now;
  let allowConfirmedFailureOverride = false;
  let printFingerprints = false;
  const positional = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      printUsage(io.stdout);
      return 0;
    } else if (arg === "--print-fingerprints") {
      printFingerprints = true;
    } else if (arg === "--allow-confirmed-failure-override") {
      allowConfirmedFailureOverride = true;
    } else if (arg === "--now") {
      now = argv[i + 1];
      if (!now) {
        io.stderr.write("Error: --now requires an ISO-8601 UTC timestamp.\n");
        return 2;
      }
      i += 1;
    } else if (arg.startsWith("-")) {
      io.stderr.write(`Error: Unknown option "${arg}".\n`);
      return 2;
    } else {
      positional.push(arg);
    }
  }

  try {
    if (printFingerprints) {
      if (positional.length !== 1) {
        printUsage(io.stderr);
        return 2;
      }
      const report = JSON.parse(fs.readFileSync(path.resolve(positional[0]), "utf8"));
      if (report.status !== "complete" || !Array.isArray(report.findings)) {
        io.stderr.write("Error: Report must have status: \"complete\" to compute fingerprints.\n");
        return 2;
      }
      const items = report.findings.map((finding) => ({
        fingerprint: computeFindingFingerprint(finding),
        ruleId: finding.ruleId,
        confidence: finding.confidence,
        file: finding.file,
        line: finding.line,
        message: finding.message
      }));
      io.stdout.write(`${JSON.stringify(items, null, 2)}\n`);
      return 0;
    }

    if (positional.length !== 2) {
      printUsage(io.stderr);
      return 2;
    }

    const report = JSON.parse(fs.readFileSync(path.resolve(positional[0]), "utf8"));
    const baseline = JSON.parse(fs.readFileSync(path.resolve(positional[1]), "utf8"));
    const result = evaluateFindingBaseline(report, baseline, {
      ...(now !== undefined ? { now } : {}),
      allowConfirmedFailureOverride
    });

    io.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.active.length > 0 || result.expired.length > 0 ? 1 : 0;
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? err.code : "ERROR";
    io.stderr.write(`[${code}] ${err instanceof Error ? err.message : String(err)}\n`);
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = runCli();
}
