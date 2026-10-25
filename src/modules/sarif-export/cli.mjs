#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { toSarif } from './index.mjs';
const path = process.argv[2];
if (!path || process.argv.length !== 3) {
  console.error('Usage: node src/modules/sarif-export/cli.mjs path/to/scan-result.json');
  process.exitCode = 2;
} else {
  try {
    const scan = JSON.parse(readFileSync(path, 'utf8'));
    process.stdout.write(JSON.stringify(toSarif(scan), null, 2) + '\n');
  } catch (err) {
    console.error('SARIF conversion failed:', err.message);
    process.exitCode = 1;
  }
}
