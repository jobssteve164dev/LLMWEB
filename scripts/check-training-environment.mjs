import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [installer, packageInstaller, archiveExporter, releaseBuilder, releaseWorkflow, releaseVerifier, manifestSchema, jobSchema, compose, webDockerfile, runtimeDockerfile, releaseGateway, assetGateway] = await Promise.all([
  read("scripts/install-runner.sh"),
  read("scripts/install-runner-package.sh"),
  read("scripts/export-classic-docker-archive.sh"),
  read("scripts/build-training-environment-release.sh"),
  read(".github/workflows/training-environment-release.yml"),
  read("scripts/verify-training-environment-release.sh"),
  read("contracts/training-environment.schema.json"),
  read("contracts/training-job.schema.json"),
  read("compose.yaml"),
  read("apps/web/Dockerfile"),
  read("runtime/Dockerfile.cpu"),
  read("apps/web/app/api/training-environment/release.ts"),
  read("apps/web/app/api/training-environment/assets/[asset]/route.ts"),
]);

JSON.parse(manifestSchema);
JSON.parse(jobSchema);
assert.match(installer, /api\/training-environment\/manifest/);
assert.match(installer, /api\/training-environment\/assets/);
assert.match(installer, /GITOPS_LLMWEB_INSTALL_FAILURE_CODE/);
assert.match(installer, /openssl pkeyutl -verify/);
assert.match(installer, /package_asset\.sig/);
assert.match(installer, /install-runner-package\.sh/);
assert.doesNotMatch(installer, /image_id|EXPECTED_IMAGE_ID|ACTUAL_IMAGE_ID|variants\.linux-amd64-cpu|linux_host_runtime/);
assert.match(installer, /已经连接到另一个训练工作区/);
assert.match(installer, /runners\/upgrade-authorization/);
assert.match(releaseWorkflow, /runs-on: ubuntu-24\.04/);
assert.match(packageInstaller, /--code-file/);
assert.match(packageInstaller, /authorize-upgrade/);
assert.match(packageInstaller, /mktemp "\$INSTALL_ROOT\/bin\/\.llmweb-runner\.XXXXXX"/);
assert.doesNotMatch(packageInstaller, /"\$PACKAGE_ROOT\/bin\/llmweb-runner" authorize-upgrade/);
assert.match(packageInstaller, /package-manifest\.json/);
assert.match(packageInstaller, /docker load --input/);
assert.match(packageInstaller, /\.Os}}\/{{\.Architecture/);
assert.doesNotMatch(packageInstaller, /curl|wget|image_id|EXPECTED_IMAGE_ID|ACTUAL_IMAGE_ID/);
assert.match(archiveExporter, /docker-archive/);
assert.match(archiveExporter, /repositories/);
assert.match(archiveExporter, /layer\\\.tar/);
assert.match(releaseBuilder, /DOCKER_STATIC_SHA256="[0-9a-f]{64}"/);
assert.match(releaseBuilder, /NANOGPT_ARCHIVE_SHA256="[0-9a-f]{64}"/);
assert.match(releaseBuilder, /docker-static\.tgz" "\$DOCKER_STATIC_SHA256"/);
assert.match(releaseBuilder, /"\$NANOGPT_ARCHIVE" "\$NANOGPT_ARCHIVE_SHA256"/);
assert.match(releaseBuilder, /find "\$PACKAGE_ROOT" -xdev -depth -mindepth 1 -delete/);
assert.match(releaseBuilder, /trap cleanup_package_root EXIT/);
assert.match(releaseWorkflow, /contents: read/);
assert.match(releaseWorkflow, /pnpm check:training-environment/);
assert.doesNotMatch(releaseWorkflow, /^\s*contents:\s*write\s*$|action-gh-release|gh release create|^\s*run:\s*.*build-training-environment-release\.sh/m);
assert.match(releaseVerifier, /docker load --input/);
assert.doesNotMatch(releaseVerifier, /image_id|EXPECTED_IMAGE_ID|ACTUAL_IMAGE_ID/);
assert.match(releaseVerifier, /docker run --rm.*import torch/s);
assert.match(compose, /https:\/\/llmweb\.szlk\.ai\/install-runner\.sh/);
assert.match(webDockerfile, /COPY scripts\/install-runner\.sh \/app\/scripts\/install-runner\.sh/);
assert.match(runtimeDockerfile, /python:3\.13-slim-trixie@sha256:[0-9a-f]{64}/);
assert.match(manifestSchema, /"packages"/);
assert.doesNotMatch(manifestSchema, /"image_id"/);
assert.match(releaseGateway, /gitops-runner\.szlk\.ai\/model-training-releases/);
assert.doesNotMatch(releaseGateway, /jobssteve164dev\/LLMWEB|training-env-v|LLMWEB_TRAINING_ENVIRONMENT_VERSION/);
assert.match(assetGateway, /packageAsset.*\.sha256.*\.sig/s);

const classifierSource = packageInstaller.match(/classify_runtime_self_test_failure\(\) \{[\s\S]*?^\}/m)?.[0];
const markerSource = packageInstaller.match(/emit_failure\(\) \{[\s\S]*?^\}/m)?.[0];
const selfTestSource = packageInstaller.match(/run_cpu_runtime_self_test\(\) \{[\s\S]*?^\}/m)?.[0];
assert.ok(classifierSource, "runtime self-test failure classifier is missing");
assert.ok(markerSource, "structured installer failure marker is missing");
assert.ok(selfTestSource, "runtime self-test wrapper is missing");
const classifyRuntimeFailure = (output) => {
  const result = spawnSync("bash", ["-c", `${classifierSource}\nclassify_runtime_self_test_failure "$1"`, "classifier", output], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};

assert.equal(classifyRuntimeFailure("Illegal instruction (core dumped)"), "runtime_cpu_incompatible");
assert.equal(classifyRuntimeFailure("exec format error"), "runtime_architecture_incompatible");
assert.equal(classifyRuntimeFailure("ModuleNotFoundError: No module named torch"), "runtime_dependency_missing");
assert.equal(classifyRuntimeFailure("Cannot connect to the Docker daemon"), "docker_unavailable");
assert.equal(classifyRuntimeFailure("unexpected container exit"), "runtime_self_test_failed");

const markerResult = spawnSync("bash", ["-c", `
set -Eeuo pipefail
STATE_ROOT="$(mktemp -d /tmp/llmweb-failure-marker.XXXXXX)"
INSTALL_FAILURE_CODE_FILE="$STATE_ROOT/install-failure-code"
CURRENT_STAGE="runtime_self_test"
FAILURE_MARKER_EMITTED=0
cleanup_marker_fixture() {
  unlink "$INSTALL_FAILURE_CODE_FILE"
  unlink "$STATE_ROOT/install-stage"
  rmdir "$STATE_ROOT"
}
trap cleanup_marker_fixture EXIT
${markerSource}
emit_failure runtime_cpu_incompatible
test "$(cat "$INSTALL_FAILURE_CODE_FILE")" = runtime_cpu_incompatible
`], { encoding: "utf8" });
assert.equal(markerResult.status, 0, markerResult.stderr);
assert.match(markerResult.stderr, /^GITOPS_LLMWEB_INSTALL_FAILURE_CODE=runtime_cpu_incompatible$/m);

const selfTestResult = spawnSync("bash", ["-c", `
set -Eeuo pipefail
CPU_RUNTIME_IMAGE=llmweb/runtime-cpu:test
STATE_ROOT="$(mktemp -d /tmp/llmweb-runtime-self-test.XXXXXX)"
${classifierSource}
${selfTestSource}
docker() {
  printf 'Illegal instruction (core dumped)\n' >&2
  return 132
}
if run_cpu_runtime_self_test; then exit 9; fi
printf 'CLASSIFIED=%s\n' "$RUNTIME_SELF_TEST_FAILURE_CODE"
rmdir "$STATE_ROOT"
`, "self-test"], { encoding: "utf8" });
assert.equal(selfTestResult.status, 0, selfTestResult.stderr);
assert.match(selfTestResult.stdout, /^CLASSIFIED=runtime_cpu_incompatible$/m);
assert.match(selfTestResult.stderr, /Illegal instruction \(core dumped\)/);
