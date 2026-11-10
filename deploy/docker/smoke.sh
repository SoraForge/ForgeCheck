#!/bin/sh
# Docker integration smoke checks for ForgeCheck Issue #37.
# Execute from a clean checkout; only Docker (with a running daemon) is required.
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$root"
image=${FORGECHECK_IMAGE:-forgecheck:issue-37-smoke}
fixture_supported="$root/deploy/docker/fixtures/supported"
fixture_unsupported="$root/deploy/docker/fixtures/unsupported"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker CLI is required to execute the container smoke suite" >&2
  exit 127
fi
docker info >/dev/null
docker build --file deploy/docker/Dockerfile --tag "$image" .

scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' 0
trap 'exit 1' 1 2 3 15

# Every runtime case is offline, has a read-only root, no Linux capabilities,
# and does not expose host Docker or host writeable paths.
run() {
  docker run --rm --network none --read-only \
    --cap-drop ALL --security-opt no-new-privileges \
    --pids-limit 64 --memory 512m "$@"
}
expect_exit() {
  label=$1
  expected=$2
  shift 2
  actual=0
  run "$@" >"$scratch/stdout" 2>"$scratch/stderr" || actual=$?
  if [ "$actual" -ne "$expected" ]; then
    echo "FAIL: $label expected exit $expected, got $actual" >&2
    cat "$scratch/stdout" "$scratch/stderr" >&2
    exit 1
  fi
  echo "PASS: $label (exit $actual)"
}
assert_stdout() {
  if ! grep -Eq "$1" "$scratch/stdout"; then
    echo "FAIL: output does not match: $1" >&2
    cat "$scratch/stdout" >&2
    exit 1
  fi
}

expect_exit help 0 "$image" --help
assert_stdout 'forgecheck scan <directory>'

expect_exit version 0 "$image" --version
assert_stdout '^[0-9]+\.[0-9]+\.[0-9]+$'

expect_exit missing-in-container-directory 2 "$image" scan /workspace
test ! -s "$scratch/stdout"
grep -qi 'Directory does not exist' "$scratch/stderr"

expect_exit missing-mounted-subdirectory 2 \
  --mount "type=bind,source=$fixture_unsupported,target=/workspace,readonly" \
  "$image" scan /workspace/does-not-exist

expect_exit unsupported-project-fails-closed 3 \
  --mount "type=bind,source=$fixture_unsupported,target=/workspace,readonly" \
  "$image" scan /workspace --json
assert_stdout '"status": "unavailable"'

# Main now includes limited real analysis. A supported Stellar fixture must
# preserve the CLI's successful-completion status instead of forcibly exiting 3.
expect_exit supported-project-is-evaluated 0 \
  --mount "type=bind,source=$fixture_supported,target=/workspace,readonly" \
  "$image" scan /workspace --json
assert_stdout '"status": "complete"'
assert_stdout '"filesScanned": 1'
assert_stdout '"rulesEvaluated":'

expect_exit nonroot-and-readonly-boundaries 0 \
  --mount "type=bind,source=$fixture_unsupported,target=/workspace,readonly" \
  --entrypoint node "$image" -e '
const fs = require("node:fs");
if (typeof process.getuid !== "function" || process.getuid() === 0) process.exit(31);
for (const p of ["/opt/forgecheck/forbidden-write", "/workspace/forbidden-write"]) {
  try {
    fs.writeFileSync(p, "forbidden", { flag: "wx" });
    process.exit(32);
  } catch (error) {
    if (!["EACCES", "EROFS", "EPERM"].includes(error.code)) process.exit(33);
  }
}
'

# --mount (unlike -v) rejects nonexistent host bind sources. This is a
# Docker daemon failure (125), not a misleading ForgeCheck scan result.
expect_exit missing-host-bind-source 125 \
  --mount "type=bind,source=$scratch/absent-host-path,target=/workspace,readonly" \
  "$image" scan /workspace

echo "PASS: ForgeCheck Docker smoke suite (all runtime containers offline)"
