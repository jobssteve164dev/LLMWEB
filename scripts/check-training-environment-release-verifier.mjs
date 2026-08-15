import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repositoryRoot = new URL("../", import.meta.url).pathname;
const verifier = join(repositoryRoot, "scripts/verify-training-environment-release.sh");
const fixtureRoot = await mkdtemp(join(tmpdir(), "llmweb-release-verifier-"));
const releaseRoot = join(fixtureRoot, "release");
const packageRoot = join(fixtureRoot, "package");
const runtimeRoot = join(fixtureRoot, "runtime");
const fakeBin = join(fixtureRoot, "bin");
const packageAsset = "llmweb-model-training-linux-amd64-9.9.9.tar.gz";
const packagePath = join(releaseRoot, packageAsset);

const digest = async (path) => createHash("sha256").update(await readFile(path)).digest("hex");
const run = (command, args) => {
  const result = spawnSync(command, args, { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
};
const runVerifier = (overrides = {}) => spawnSync("bash", [verifier, releaseRoot], {
  encoding: "utf8",
  env: {
    ...process.env,
    PATH: `${fakeBin}:${process.env.PATH}`,
    FAKE_DOCKER_PLATFORM: "linux/amd64",
    FAKE_DOCKER_RUN_FAIL: "0",
    ...overrides,
  },
});

try {
  await Promise.all([
    mkdir(releaseRoot),
    mkdir(packageRoot),
    mkdir(runtimeRoot),
    mkdir(fakeBin),
  ]);
  await Promise.all([
    mkdir(join(packageRoot, "bin")),
    mkdir(join(packageRoot, "runtime")),
    mkdir(join(runtimeRoot, "layer")),
  ]);
  await Promise.all([
    writeFile(join(packageRoot, "install-runner-package.sh"), "#!/usr/bin/env bash\nexit 0\n"),
    writeFile(join(packageRoot, "bin/llmweb-runner"), "#!/usr/bin/env bash\nprintf '0.2.0\\n'\n"),
    writeFile(join(packageRoot, "runtime/docker-static.tgz"), "docker-static-fixture\n"),
    writeFile(join(runtimeRoot, "manifest.json"), `${JSON.stringify([{ Config: "config.json", RepoTags: ["llmweb/runtime-cpu:9.9.9"], Layers: ["layer/layer.tar"] }])}\n`),
    writeFile(join(runtimeRoot, "repositories"), "{}\n"),
    writeFile(join(runtimeRoot, "config.json"), "{}\n"),
    writeFile(join(runtimeRoot, "layer/layer.tar"), "layer-fixture\n"),
    writeFile(join(fakeBin, "docker"), `#!/usr/bin/env bash
set -eu
case "\${1:-}" in
  info) exit 0 ;;
  load) test "\${2:-}" = --input; test -s "\${3:-}" ;;
  image)
    test "\${2:-}" = inspect
    printf '%s\\n' "\${FAKE_DOCKER_PLATFORM}"
    ;;
  run)
    if [[ "\${FAKE_DOCKER_RUN_FAIL:-0}" = 1 ]]; then
      printf 'Illegal instruction (core dumped)\\n' >&2
      exit 132
    fi
    ;;
  *) exit 64 ;;
esac
`),
  ]);
  await Promise.all([
    chmod(join(packageRoot, "install-runner-package.sh"), 0o755),
    chmod(join(packageRoot, "bin/llmweb-runner"), 0o755),
    chmod(join(fakeBin, "docker"), 0o755),
  ]);
  run("tar", ["-czf", join(packageRoot, "runtime/image.tar.gz"), "-C", runtimeRoot, "manifest.json", "repositories", "config.json", "layer"]);

  const packageManifest = {
    schema_version: "1.0",
    version: "9.9.9",
    source_revision: "b".repeat(40),
    platform: "linux/amd64",
    image: "llmweb/runtime-cpu:9.9.9",
    minimum: { cpu_cores: 4, memory_mb: 7936, disk_free_mb: 20480 },
    files: {
      "install-runner-package.sh": await digest(join(packageRoot, "install-runner-package.sh")),
      "bin/llmweb-runner": await digest(join(packageRoot, "bin/llmweb-runner")),
      "runtime/docker-static.tgz": await digest(join(packageRoot, "runtime/docker-static.tgz")),
      "runtime/image.tar.gz": await digest(join(packageRoot, "runtime/image.tar.gz")),
    },
  };
  await writeFile(join(packageRoot, "package-manifest.json"), `${JSON.stringify(packageManifest)}\n`);
  run("tar", ["-czf", packagePath, "-C", packageRoot, "install-runner-package.sh", "package-manifest.json", "bin", "runtime"]);

  const releaseManifest = {
    schema_version: "2.0",
    version: "9.9.9",
    source_revision: "b".repeat(40),
    packages: {
      "linux-amd64-cpu": {
        status: "available",
        minimum: packageManifest.minimum,
        artifact: { asset: packageAsset, sha256: await digest(packagePath) },
        image: packageManifest.image,
      },
      "linux-amd64-cuda": { status: "unavailable", minimum: packageManifest.minimum, reason: "fixture" },
      "darwin-arm64-mps": { status: "unavailable", minimum: packageManifest.minimum, reason: "fixture" },
    },
  };
  await writeFile(join(releaseRoot, "manifest.json"), `${JSON.stringify(releaseManifest)}\n`);

  const success = runVerifier();
  assert.equal(success.status, 0, success.stderr);
  assert.match(success.stdout, /verified_training_environment_version=9\.9\.9/);
  assert.match(success.stdout, /verified_runtime_platform=linux\/amd64/);

  const originalPackage = await readFile(packagePath);
  await writeFile(packagePath, Buffer.concat([originalPackage, Buffer.from("tampered")]))
  const tampered = runVerifier();
  assert.notEqual(tampered.status, 0);
  assert.match(`${tampered.stdout}\n${tampered.stderr}`, /FAILED|did NOT match/);
  await writeFile(packagePath, originalPackage);

  const wrongPlatform = runVerifier({ FAKE_DOCKER_PLATFORM: "linux/arm64" });
  assert.notEqual(wrongPlatform.status, 0);
  assert.match(wrongPlatform.stderr, /platform does not match/);

  const failedRuntime = runVerifier({ FAKE_DOCKER_RUN_FAIL: "1" });
  assert.notEqual(failedRuntime.status, 0);
  assert.match(failedRuntime.stderr, /Illegal instruction/);
} finally {
  const files = [
    join(releaseRoot, "manifest.json"),
    packagePath,
    join(packageRoot, "install-runner-package.sh"),
    join(packageRoot, "package-manifest.json"),
    join(packageRoot, "bin/llmweb-runner"),
    join(packageRoot, "runtime/docker-static.tgz"),
    join(packageRoot, "runtime/image.tar.gz"),
    join(runtimeRoot, "manifest.json"),
    join(runtimeRoot, "repositories"),
    join(runtimeRoot, "config.json"),
    join(runtimeRoot, "layer/layer.tar"),
    join(fakeBin, "docker"),
  ];
  for (const path of files) {
    await unlink(path).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
  for (const path of [
    join(packageRoot, "bin"),
    join(packageRoot, "runtime"),
    join(runtimeRoot, "layer"),
    releaseRoot,
    packageRoot,
    runtimeRoot,
    fakeBin,
    fixtureRoot,
  ]) {
    await rmdir(path).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}
