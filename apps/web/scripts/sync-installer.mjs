import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, "../../../scripts/install-runner.sh");
const targetDirectory = resolve(here, "../public");
await mkdir(targetDirectory, { recursive: true });
await copyFile(source, resolve(targetDirectory, "install-runner.sh"));
