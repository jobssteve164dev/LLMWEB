import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [installer, releaseWorkflow, manifestSchema, jobSchema, compose, webDockerfile] = await Promise.all([
  read("scripts/install-runner.sh"),
  read(".github/workflows/training-environment-release.yml"),
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
assert.match(installer, /已经连接到另一个训练工作区/);
assert.match(releaseWorkflow, /Generate SBOM/);
assert.match(releaseWorkflow, /severity-cutoff: high/);
assert.match(compose, /https:\/\/llmweb\.szlk\.ai\/install-runner\.sh/);
assert.match(webDockerfile, /COPY scripts\/install-runner\.sh \/app\/scripts\/install-runner\.sh/);
