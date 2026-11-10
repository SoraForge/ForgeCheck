# ForgeCheck offline Docker CLI (Issue #37)

This standalone deployment feature packages the **existing ForgeCheck CLI**
into a non-root Node.js 22 container. It does not replace the CLI or change
application, scanner, package, workflow, or rule-module code.

## Build (repository root as context)

~~~sh
docker build --file deploy/docker/Dockerfile --tag forgecheck:local .
~~~

The image uses a multi-stage build: Node 22.16.0 on Debian Bookworm Slim,
a clean `npm ci` build from the checked-in lockfile, an isolated
`node --test deploy/docker/contract.test.mjs` contract check, and separate
`npm ci --omit=dev` runtime dependencies. The final layer contains compiled
JavaScript, runtime `.mjs` support modules, production dependencies, package
metadata, and the license. The Dockerfile-specific ignore allowlist excludes
root-level secrets, Git metadata, node_modules and unrelated project files
from the build context.

The Node patch version and npm dependency versions are pinned, but Docker tags
are **not immutable digests**. For byte-for-byte reproducibility, resolve and
verify an appropriate official Node image SHA-256 digest, then explicitly
provide `--build-arg NODE_IMAGE=node:22.16.0-bookworm-slim@sha256:YOUR_VERIFIED_DIGEST`.
CI, base registry access and npm package downloads are needed **during build**,
not at runtime. Review and periodically update the pinned base image for
security fixes; the static tag is not a claim of perpetual patch freshness.

## Run without network access

The image entrypoint invokes the existing compiled CLI directly. The following
commands neither mount the Docker socket nor give the container privileges.

~~~sh
docker run --rm --pull=never --network none --read-only \
  --cap-drop ALL --security-opt no-new-privileges \
  forgecheck:local --help

docker run --rm --pull=never --network none --read-only \
  --cap-drop ALL --security-opt no-new-privileges \
  forgecheck:local --version

docker run --rm --pull=never --network none --read-only \
  --cap-drop ALL --security-opt no-new-privileges \
  --mount "type=bind,source=$(pwd)/deploy/docker/fixtures/supported,target=/workspace,readonly" \
  forgecheck:local scan /workspace --json
~~~

Replace the mount source with an **existing, trusted, absolute directory**
containing your local Stellar project. Use the full path from the Docker
daemon's host if it differs from your terminal's host. The destination is
`/workspace`; the scanner receives `scan /workspace` and reads source
files without executing project scripts. The bind mount is **read-only**,
and `--read-only` separately protects the image's root filesystem.
Only explicitly mount directories you intend the scanner to read.

Docker's `--mount` syntax deliberately rejects nonexistent host paths
instead of creating a directory. With `--pull=never` and `--network none`,
an image already built and present locally requires neither registry nor
runtime network access.

## Honest scan exit codes

- **0:** CLI help/version, or a completed scan without confirmed failures.
  The included supported Stellar fixture is an example of a completed scan.
  Its completion is **not** a security guarantee.
- **2:** Invalid command, non-directory input or missing directory inside the
  container (including `scan /workspace` without mounting a project).
- **3:** Incomplete/unsupported analysis. The included non-Stellar TypeScript
  fixture is intentionally unavailable and must exit 3.
- **1:** Unexpected internal error; **4:** confirmed compatibility failure.
- **125:** Docker itself refused to start the container (for example a missing
  host bind source); this is **not** a ForgeCheck scan result.

The Issue #37 description predates the limited scan engine currently present
on `main`. The image therefore preserves actual CLI behavior: it **does not**
force all successful analyses to exit 3. The scanner has limited supported
coverage and must still fail closed for incomplete results.

## Verification

Run all existing checks plus the isolated Docker feature tests:

~~~sh
npm ci
npm run build
npm test
npm run check:repo
node --test deploy/docker/contract.test.mjs
sh deploy/docker/smoke.sh
~~~

The smoke script builds the image, then tests help, version, supported and
unsupported read-only project mounts, missing paths (CLI exit 2), nonexistent
host bind source (Docker exit 125), non-root execution, read-only filesystem
enforcement, and network-disabled runtime. Image build also executes the
contract test suite. Runtime containers use restricted Linux capabilities,
a PID limit and an explicit memory cap in smoke tests.

**Limits:** Docker must be installed and its daemon reachable for the smoke
script. Docker Desktop host-path sharing must be configured if needed.
Containerization does not prove every SDK or protocol behavior compatible,
does not make untrusted source content safe to publish, and is not a
substitute for independent security review. The scanner makes no Stellar
network calls, does not require signing keys or cloud credentials, and
never runs the target project's scripts.
