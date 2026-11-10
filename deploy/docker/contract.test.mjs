import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const dockerDir = join(root, "deploy/docker");
const imageSource = readFileSync(join(dockerDir, "Dockerfile"), "utf8");
const ignoreSource = readFileSync(join(dockerDir, "Dockerfile.dockerignore"), "utf8");
const smoke = readFileSync(join(dockerDir, "smoke.sh"), "utf8");
const cli = resolve(root, "dist/cli.js");

function run(...args) {
  const child = spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: "utf8",
    timeout: 15000,
    env: { ...process.env, NODE_OPTIONS: "" }
  });
  assert.equal(child.error, undefined);
  assert.equal(child.signal, null);
  return child;
}

test("Docker image is multi-stage and separates runtime from build tooling", () => {
  assert.equal((imageSource.match(/^FROM /gm) ?? []).length, 3);
  assert.match(imageSource, /^ARG NODE_IMAGE=node:22\.\d+\.\d+-bookworm-slim$/m);
  assert.equal((imageSource.match(/RUN npm ci --/g) ?? []).length, 2);
  assert.match(imageSource, /npm ci --omit=dev --ignore-scripts/);
  assert.match(imageSource, /npm run build/);
  assert.match(imageSource, /COPY --from=builder \/app\/dist\//);
  assert.match(imageSource, /COPY --from=builder \/runtime\/src\/modules\//);
  assert.match(imageSource, /COPY --from=production-dependencies \/app\/node_modules\//);
  assert.match(imageSource, /^USER node:node$/m);
  assert.match(imageSource, /^ENTRYPOINT \["node", "\/opt\/forgecheck\/dist\/cli\.js"\]$/m);
  assert.doesNotMatch(imageSource, /^COPY \. /m);
  assert.doesNotMatch(imageSource, /\b(?:curl|wget|git clone|chmod 777)\b/i);
});

test("Docker-specific ignore file never ships host secrets or installed packages", () => {
  assert.match(ignoreSource, /^\*\*$/m);
  for (const source of ["package.json", "package-lock.json", "tsconfig.json", "src/**"]) {
    assert.ok(ignoreSource.split(/\r?\n/).includes("!" + source));
  }
  assert.doesNotMatch(ignoreSource, /^!node_modules(?:\/|$)/m);
  assert.doesNotMatch(ignoreSource, /^!\\.env/m);
  assert.doesNotMatch(ignoreSource, /^!\\.git/m);
});

test("standalone smoke script uses Docker without runtime network or privilege escalation", () => {
  assert.match(smoke, /docker build --file deploy\/docker\/Dockerfile --tag/);
  for (const flag of ["--network none", "--read-only", "--cap-drop ALL",
                      "--security-opt no-new-privileges", "readonly"]) {
    assert.ok(smoke.includes(flag), "missing security guard: " + flag);
  }
  assert.doesNotMatch(smoke, /\/var\/run\/docker\.sock|--privileged|--network host/);
  assert.match(smoke, /missing-host-bind-source 125/);
  assert.match(smoke, /unsupported-project-fails-closed 3/);
  assert.match(smoke, /supported-project-is-evaluated 0/);
});

test("compiled CLI help/version work without a Docker daemon", () => {
  assert.ok(existsSync(cli), "Build first: npm run build");
  const help = run("--help");
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /forgecheck scan <directory>/);
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const version = run("--version");
  assert.equal(version.status, 0, version.stderr);
  assert.equal(version.stdout.trim(), pkg.version);
});

test("supported read-only fixture completes without executing project scripts", () => {
  const dir = join(dockerDir, "fixtures/supported");
  const result = run("scan", dir, "--json");
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "complete");
  assert.equal(report.filesScanned, 1);
  assert.ok(report.rulesEvaluated > 0);
});

test("unsupported and missing directories preserve fail-closed exit codes", () => {
  const unsupported = run("scan", join(dockerDir, "fixtures/unsupported"), "--json");
  assert.equal(unsupported.status, 3);
  assert.equal(JSON.parse(unsupported.stdout).status, "unavailable");
  const missing = run("scan", join(dockerDir, "fixtures/nonexistent-37"));
  assert.equal(missing.status, 2);
  assert.equal(missing.stdout, "");
  assert.match(missing.stderr, /Directory does not exist/);
});
