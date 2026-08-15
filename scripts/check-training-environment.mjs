import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [installer, releaseWorkflow, releaseVerifier, manifestSchema, jobSchema, compose, webDockerfile] = await Promise.all([
  read("scripts/install-runner.sh"),
  read(".github/workflows/training-environment-release.yml"),
  read("scripts/verify-training-environment-release.sh"),
  read("contracts/training-environment.schema.json"),
  read("contracts/training-job.schema.json"),
  read("compose.yaml"),
  read("apps/web/Dockerfile"),
]);

JSON.parse(manifestSchema);
JSON.parse(jobSchema);
assert.match(installer, /api\/training-environment\/manifest/);
assert.match(installer, /api\/training-environment\/assets/);
assert.match(installer, /docker load -i/);
assert.match(installer, /EXPECTED_IMAGE_ID/);
assert.match(installer, /已验证现有训练环境，正在原位复用/);
assert.match(installer, /ACTUAL_IMAGE_ID.*EXPECTED_IMAGE_ID/s);
assert.match(installer, /&& run_cpu_runtime_self_test/);
assert.match(installer, /GITOPS_LLMWEB_INSTALL_FAILURE_CODE/);
assert.match(installer, /runtime_image_identity_mismatch/);
assert.match(installer, /run_cpu_runtime_self_test/);
assert.match(installer, /已经连接到另一个训练工作区/);
assert.match(installer, /runners\/upgrade-authorization/);
assert.match(releaseWorkflow, /Generate SBOM/);
assert.match(releaseWorkflow, /runs-on: ubuntu-24\.04/);
assert.match(releaseWorkflow, /llmweb-node-package-linux-amd64\.tar\.gz/);
assert.match(releaseWorkflow, /severity-cutoff: high/);
assert.match(releaseWorkflow, /only-fixed: true/);
assert.match(releaseWorkflow, /training-runtime-grype\.yaml/);
assert.match(releaseWorkflow, /output-format: table/);
assert.match(releaseWorkflow, /verify-cpu-release:\n\s+needs: cpu-release/);
assert.match(releaseWorkflow, /publish-cpu-release:\n\s+needs: verify-cpu-release/);
assert.match(releaseWorkflow, /verify-training-environment-release\.sh/);
assert.match(releaseVerifier, /docker load -i/);
assert.match(releaseVerifier, /ACTUAL_IMAGE_ID.*EXPECTED_IMAGE_ID/s);
assert.match(releaseVerifier, /docker run --rm.*import torch/s);
assert.match(compose, /https:\/\/llmweb\.szlk\.ai\/install-runner\.sh/);
assert.match(webDockerfile, /COPY scripts\/install-runner\.sh \/app\/scripts\/install-runner\.sh/);
assert.match(manifestSchema, /"installer"/);

const classifierSource = installer.match(/classify_runtime_self_test_failure\(\) \{[\s\S]*?^\}/m)?.[0];
const markerSource = installer.match(/emit_install_failure_marker\(\) \{[\s\S]*?^\}/m)?.[0];
const selfTestSource = installer.match(/run_cpu_runtime_self_test\(\) \{[\s\S]*?^\}/m)?.[0];
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
CURRENT_FAILURE_CODE=""
FAILURE_MARKER_EMITTED=0
cleanup_marker_fixture() {
  unlink "$INSTALL_FAILURE_CODE_FILE"
  rmdir "$STATE_ROOT"
}
trap cleanup_marker_fixture EXIT
${markerSource}
emit_install_failure_marker runtime_cpu_incompatible
test "$(cat "$INSTALL_FAILURE_CODE_FILE")" = runtime_cpu_incompatible
`], { encoding: "utf8" });
assert.equal(markerResult.status, 0, markerResult.stderr);
assert.match(markerResult.stderr, /^GITOPS_LLMWEB_INSTALL_FAILURE_CODE=runtime_cpu_incompatible$/m);

const selfTestResult = spawnSync("bash", ["-c", `
set -Eeuo pipefail
CPU_RUNTIME_IMAGE=llmweb/runtime-cpu:test
${classifierSource}
${selfTestSource}
docker() {
  printf 'Illegal instruction (core dumped)\n' >&2
  return 132
}
if run_cpu_runtime_self_test; then exit 9; fi
printf 'CLASSIFIED=%s\n' "$RUNTIME_SELF_TEST_FAILURE_CODE"
`, "self-test"], { encoding: "utf8" });
assert.equal(selfTestResult.status, 0, selfTestResult.stderr);
assert.match(selfTestResult.stdout, /^CLASSIFIED=runtime_cpu_incompatible$/m);
assert.match(selfTestResult.stderr, /Illegal instruction \(core dumped\)/);
