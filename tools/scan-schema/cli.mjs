#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_MAX_REPORT_BYTES, validateScanResultJson } from "./index.mjs";

function printUsage(stream) {
  stream.write(
    "Usage: node tools/scan-schema/cli.mjs [--json] [--max-bytes <bytes>] <report.json> [...more.json]\n"
  );
}

export function runCli(argv = process.argv.slice(2), io = { stdout: process.stdout, stderr: process.stderr }) {
  let jsonOutput = false;
  let maxBytes = DEFAULT_MAX_REPORT_BYTES;
  const files = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") {
      jsonOutput = true;
    } else if (arg === "--help" || arg === "-h") {
      printUsage(io.stdout);
      return 0;
    } else if (arg === "--max-bytes") {
      const next = argv[i + 1];
      const parsed = Number.parseInt(next ?? "", 10);
      if (!Number.isInteger(parsed) || parsed < 1) {
        io.stderr.write("Error: --max-bytes requires a positive integer.\n");
        return 2;
      }
      maxBytes = parsed;
      i += 1;
    } else if (arg.startsWith("-")) {
      io.stderr.write(`Error: Unknown flag "${arg}".\n`);
      printUsage(io.stderr);
      return 2;
    } else {
      files.push(arg);
    }
  }

  if (files.length === 0) {
    printUsage(io.stderr);
    return 2;
  }

  const results = [];
  let hasFailure = false;

  for (const file of files) {
    const resolved = path.resolve(file);
    let stat;
    try {
      stat = fs.statSync(resolved);
    } catch (err) {
      hasFailure = true;
      results.push({
        file,
        valid: false,
        errors: [
          {
            path: "$",
            code: "FILE_READ_ERROR",
            message: err instanceof Error ? err.message : String(err)
          }
        ]
      });
      continue;
    }

    if (stat.size > maxBytes) {
      hasFailure = true;
      results.push({
        file,
        valid: false,
        errors: [
          {
            path: "$",
            code: "INPUT_TOO_LARGE",
            message: `File size (${stat.size} bytes) exceeds maximum allowed (${maxBytes} bytes).`
          }
        ]
      });
      continue;
    }

    let raw;
    try {
      raw = fs.readFileSync(resolved);
    } catch (err) {
      hasFailure = true;
      results.push({
        file,
        valid: false,
        errors: [
          {
            path: "$",
            code: "FILE_READ_ERROR",
            message: err instanceof Error ? err.message : String(err)
          }
        ]
      });
      continue;
    }

    const outcome = validateScanResultJson(raw, { maxBytes });
    if (!outcome.valid) {
      hasFailure = true;
    }
    results.push({
      file,
      valid: outcome.valid,
      schemaVersion: outcome.schemaVersion,
      status: outcome.valid ? outcome.value.status : undefined,
      errors: outcome.errors
    });
  }

  if (jsonOutput) {
    io.stdout.write(`${JSON.stringify({ valid: !hasFailure, results }, null, 2)}\n`);
  } else {
    for (const item of results) {
      if (item.valid) {
        io.stdout.write(`VALID (${item.status}): ${item.file}\n`);
      } else {
        io.stderr.write(`INVALID: ${item.file}\n`);
        for (const err of item.errors) {
          io.stderr.write(`  [${err.code}] ${err.path}: ${err.message}\n`);
        }
      }
    }
  }

  return hasFailure ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = runCli();
}
