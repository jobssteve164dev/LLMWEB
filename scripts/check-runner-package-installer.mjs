import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repositoryRoot = new URL("../", import.meta.url).pathname;
const fixtureRoot = await mkdtemp(join(tmpdir(), "llmweb-package-installer-"));
const packageRoot = join(fixtureRoot, "package");
const runtimeRoot = join(fixtureRoot, "runtime");
const fakeBin = join(fixtureRoot, "fake-bin");
const installRoot = join(fixtureRoot, "installed");
const stateRoot = join(fixtureRoot, "state");
const systemdRuntime = join(fixtureRoot, "systemd-runtime");
const dataRoot = join(fixtureRoot, "data");
const outputRoot = join(fixtureRoot, "output");
const unitPath = join(fixtureRoot, "llmweb-runner.service");
const pairingPath = join(fixtureRoot, "pairing-code");
const runnerLog = join(fixtureRoot, "runner.log");
const installer = join(packageRoot, "install-runner-package.sh");

const digest = async (path) => createHash("sha256").update(await readFile(path)).digest("hex");
const run = (command, args) => {
  const result = spawnSync(command, args, { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
};
const runInstaller = () => spawnSync("bash", [installer, "--url", "https://llmweb.szlk.ai", "--code-file", pairingPath], {
  encoding: "utf8",
  env: {
    ...process.env,
    PATH: `${fakeBin}:${process.env.PATH}`,
    LLMWEB_INSTALL_ROOT: installRoot,
    LLMWEB_STATE_ROOT: stateRoot,
    LLMWEB_SYSTEMD_UNIT_PATH: unitPath,
    LLMWEB_SYSTEMD_RUNTIME_DIRECTORY: systemdRuntime,
    LLMWEB_DATA_ROOT: dataRoot,
    LLMWEB_OUTPUT_ROOT: outputRoot,
    FAKE_RUNNER_LOG: runnerLog,
  },
});

try {
  for (const path of [packageRoot, runtimeRoot, fakeBin, installRoot, stateRoot, systemdRuntime, dataRoot, outputRoot]) {
    await mkdir(path);
  }
  for (const path of [join(packageRoot, "bin"), join(packageRoot, "runtime"), join(runtimeRoot, "layer")]) {
    await mkdir(path);
  }
  await Promise.all([
    copyFile(join(repositoryRoot, "scripts/install-runner-package.sh"), installer),
    writeFile(join(packageRoot, "bin/llmweb-runner"), `#!/usr/bin/env bash
set -Eeuo pipefail
printf '%s\\n' "$*" >> "$FAKE_RUNNER_LOG"
[[ "$*" != *pair_once_secret* ]]
case "\${1:-}" in
  version) exit 0 ;;
  authorize-upgrade)
    while [[ $# -gt 0 ]]; do
      if [[ "$1" = --code-file ]]; then test "$(stat -c %a "$2")" = 600; grep -Fxq pair_once_secret "$2"; fi
      shift
    done
    ;;
  register)
    while [[ $# -gt 0 ]]; do
      if [[ "$1" = --state-dir ]]; then STATE_DIR="$2"; shift 2; continue; fi
      if [[ "$1" = --code-file ]]; then test "$(stat -c %a "$2")" = 600; grep -Fxq pair_once_secret "$2"; fi
      shift
    done
    printf '{"runner_id":"fixture","device_token":"secret","control_url":"https://llmweb.szlk.ai"}\\n' > "$STATE_DIR/state.json"
    ;;
  *) exit 64 ;;
esac
`),
    writeFile(join(packageRoot, "runtime/docker-static.tgz"), "unused-docker-static-fixture\n"),
    writeFile(join(runtimeRoot, "manifest.json"), `${JSON.stringify([{ Config: "config.json", RepoTags: ["llmweb/runtime-cpu:9.9.9"], Layers: ["layer/layer.tar"] }])}\n`),
    writeFile(join(runtimeRoot, "repositories"), "{}\n"),
    writeFile(join(runtimeRoot, "config.json"), "{}\n"),
    writeFile(join(runtimeRoot, "layer/layer.tar"), "layer-fixture\n"),
    writeFile(join(fakeBin, "docker"), `#!/usr/bin/env bash
set -Eeuo pipefail
case "\${1:-}" in
  info) exit 0 ;;
  load) test "\${2:-}" = --input; test -s "\${3:-}" ;;
  image) test "\${2:-}" = inspect; printf 'linux/amd64\\n' ;;
  run) exit 0 ;;
  *) exit 64 ;;
esac
`),
    writeFile(join(fakeBin, "systemctl"), "#!/usr/bin/env bash\nexit 0\n"),
    writeFile(join(fakeBin, "id"), "#!/usr/bin/env bash\nif [[ \"${1:-}\" = -u ]]; then printf '0\\n'; else exec /usr/bin/id \"$@\"; fi\n"),
    writeFile(join(fakeBin, "uname"), "#!/usr/bin/env bash\nif [[ \"${1:-}\" = -s ]]; then printf 'Linux\\n'; elif [[ \"${1:-}\" = -m ]]; then printf 'x86_64\\n'; else exec /usr/bin/uname \"$@\"; fi\n"),
    writeFile(pairingPath, "pair_once_secret\n", { mode: 0o600 }),
  ]);
  for (const path of [installer, join(fakeBin, "docker"), join(fakeBin, "systemctl"), join(fakeBin, "id"), join(fakeBin, "uname")]) {
    await chmod(path, 0o755);
  }
  await chmod(join(packageRoot, "bin/llmweb-runner"), 0o644);
  run("tar", ["-czf", join(packageRoot, "runtime/image.tar.gz"), "-C", runtimeRoot, "manifest.json", "repositories", "config.json", "layer"]);
  const packageManifest = {
    schema_version: "1.0",
    version: "9.9.9",
    source_revision: "b".repeat(40),
    platform: "linux/amd64",
    image: "llmweb/runtime-cpu:9.9.9",
    minimum: { cpu_cores: 1, memory_mb: 1, disk_free_mb: 1 },
    files: {
      "install-runner-package.sh": await digest(installer),
      "bin/llmweb-runner": await digest(join(packageRoot, "bin/llmweb-runner")),
      "runtime/docker-static.tgz": await digest(join(packageRoot, "runtime/docker-static.tgz")),
      "runtime/image.tar.gz": await digest(join(packageRoot, "runtime/image.tar.gz")),
    },
  };
  await writeFile(join(packageRoot, "package-manifest.json"), `${JSON.stringify(packageManifest)}\n`);

  const first = runInstaller();
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /GITOPS_LLMWEB_RUNNER_READY=true/);
  assert.match(await readFile(runnerLog, "utf8"), /^version\n[\s\S]*^register /m);
  assert.equal((await readFile(join(stateRoot, "install-stage"), "utf8")).trim(), "ready");
  assert.match(await readFile(unitPath, "utf8"), /ExecStart=.*llmweb-runner connect --state-dir/);

  const second = runInstaller();
  assert.equal(second.status, 0, second.stderr);
  const log = await readFile(runnerLog, "utf8");
  assert.match(log, /^authorize-upgrade .*--code-file /m);
  assert.doesNotMatch(log, /pair_once_secret/);
} finally {
  const files = [
    join(packageRoot, "install-runner-package.sh"), join(packageRoot, "package-manifest.json"),
    join(packageRoot, "bin/llmweb-runner"), join(packageRoot, "runtime/docker-static.tgz"),
    join(packageRoot, "runtime/image.tar.gz"), join(runtimeRoot, "manifest.json"),
    join(runtimeRoot, "repositories"), join(runtimeRoot, "config.json"), join(runtimeRoot, "layer/layer.tar"),
    join(fakeBin, "docker"), join(fakeBin, "systemctl"), join(fakeBin, "id"), join(fakeBin, "uname"), pairingPath, runnerLog, unitPath,
    join(installRoot, "bin/llmweb-runner"), join(installRoot, "package-manifest.json"),
    join(stateRoot, "state.json"), join(stateRoot, "install-failure-code"), join(stateRoot, "install-stage"),
  ];
  for (const path of files) await unlink(path).catch((error) => { if (error.code !== "ENOENT") throw error; });
  for (const path of [
    join(packageRoot, "bin"), join(packageRoot, "runtime"), join(runtimeRoot, "layer"),
    join(installRoot, "bin"), join(installRoot, "runtime"), packageRoot, runtimeRoot, fakeBin,
    installRoot, stateRoot, systemdRuntime, dataRoot, outputRoot, fixtureRoot,
  ]) await rmdir(path).catch((error) => { if (error.code !== "ENOENT") throw error; });
}
