import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const repositoryRoot = new URL("../", import.meta.url).pathname;
const verifier = join(repositoryRoot, "scripts/verify-training-environment-release.sh");
const fixtureRoot = await mkdtemp(join(tmpdir(), "llmweb-release-verifier-"));
const releaseRoot = join(fixtureRoot, "release");
const packageRoot = join(fixtureRoot, "package");
const fakeBin = join(fixtureRoot, "bin");

const installerAsset = "llmweb-node-package-linux-amd64.tar.gz";
const runnerAsset = "llmweb-runner-linux-amd64";
const hostRuntimeAsset = "docker-static-linux-amd64-27.5.1.tgz";
const runtimeAsset = "llmweb-runtime-cpu-9.9.9.tar.gz";
const expectedImageId = `sha256:${"a".repeat(64)}`;

const fixtureFiles = [
  join(releaseRoot, "manifest.json"),
  join(releaseRoot, installerAsset),
  join(releaseRoot, runnerAsset),
  join(releaseRoot, hostRuntimeAsset),
  join(releaseRoot, runtimeAsset),
  join(packageRoot, "install-runner.sh"),
  join(fakeBin, "docker"),
];

const digest = async (path) => createHash("sha256").update(await readFile(path)).digest("hex");
const runVerifier = (overrides = {}) => spawnSync("bash", [verifier, releaseRoot], {
  encoding: "utf8",
  env: {
    ...process.env,
    PATH: `${fakeBin}:${process.env.PATH}`,
    FAKE_DOCKER_IMAGE_ID: expectedImageId,
    FAKE_DOCKER_RUN_FAIL: "0",
    ...overrides,
  },
});

try {
  await Promise.all([
    mkdir(releaseRoot),
    mkdir(packageRoot),
    mkdir(fakeBin),
  ]);
  await writeFile(join(packageRoot, "install-runner.sh"), "#!/usr/bin/env bash\nexit 0\n");
  const packed = spawnSync("tar", ["-czf", join(releaseRoot, installerAsset), "-C", packageRoot, "install-runner.sh"], { encoding: "utf8" });
  assert.equal(packed.status, 0, packed.stderr);
  await Promise.all([
    writeFile(join(releaseRoot, runnerAsset), "runner-fixture\n"),
    writeFile(join(releaseRoot, hostRuntimeAsset), "host-runtime-fixture\n"),
    writeFile(join(releaseRoot, runtimeAsset), gzipSync("runtime-archive-fixture\n")),
    writeFile(join(fakeBin, "docker"), `#!/usr/bin/env bash
set -eu
case "\${1:-}" in
  info) exit 0 ;;
  load) test "\${2:-}" = -i; test -s "\${3:-}" ;;
  image) printf '%s\\n' "\${FAKE_DOCKER_IMAGE_ID}" ;;
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
  await chmod(join(fakeBin, "docker"), 0o755);

  const manifest = {
    version: "9.9.9",
    source_revision: "b".repeat(40),
    installer: { asset: installerAsset, sha256: await digest(join(releaseRoot, installerAsset)) },
    runner: { asset: runnerAsset, sha256: await digest(join(releaseRoot, runnerAsset)) },
    linux_host_runtime: { asset: hostRuntimeAsset, sha256: await digest(join(releaseRoot, hostRuntimeAsset)) },
    variants: {
      "linux-amd64-cpu": {
        artifact: { asset: runtimeAsset, sha256: await digest(join(releaseRoot, runtimeAsset)) },
        image: "llmweb/runtime-cpu:9.9.9",
        image_id: expectedImageId,
      },
    },
  };
  await writeFile(join(releaseRoot, "manifest.json"), `${JSON.stringify(manifest)}\n`);

  const success = runVerifier();
  assert.equal(success.status, 0, success.stderr);
  assert.match(success.stdout, /verified_training_environment_version=9\.9\.9/);
  assert.match(success.stdout, new RegExp(`verified_image_id=${expectedImageId}`));

  await writeFile(join(releaseRoot, runnerAsset), "tampered-runner\n");
  const tampered = runVerifier();
  assert.notEqual(tampered.status, 0);
  assert.match(`${tampered.stdout}\n${tampered.stderr}`, /FAILED|did NOT match/);
  await writeFile(join(releaseRoot, runnerAsset), "runner-fixture\n");

  const wrongImage = runVerifier({ FAKE_DOCKER_IMAGE_ID: `sha256:${"c".repeat(64)}` });
  assert.notEqual(wrongImage.status, 0);
  assert.match(wrongImage.stderr, /image identity does not match/);

  const failedRuntime = runVerifier({ FAKE_DOCKER_RUN_FAIL: "1" });
  assert.notEqual(failedRuntime.status, 0);
  assert.match(failedRuntime.stderr, /Illegal instruction/);
} finally {
  for (const file of fixtureFiles) {
    await unlink(file).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
  for (const directory of [releaseRoot, packageRoot, fakeBin, fixtureRoot]) {
    await rmdir(directory).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}
