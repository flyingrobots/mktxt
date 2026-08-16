#!/usr/bin/env node
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

const [installRootArg, expectedVersion] = process.argv.slice(2);
if (!installRootArg || !expectedVersion) {
  console.error("Usage: verify-install.mjs <install-root> <expected-version>");
  process.exit(1);
}

const installRoot = await fs.realpath(installRootArg);
const installPrefix = `${installRoot}${path.sep}`;
await verifyLinksStayInside(installRoot);

const command = path.join(installRoot, "bin", "mktxt");
const result = spawnSync(command, ["--version"], { encoding: "utf8" });
if (result.status !== 0) {
  throw new Error(`Installed command failed verification:\n${result.stderr || result.stdout}`);
}
if (result.stdout.trim() !== `mktxt ${expectedVersion}`) {
  throw new Error(`Installed command reported unexpected version: ${result.stdout.trim()}`);
}

console.log(`Verified self-contained mktxt ${expectedVersion} payload`);

async function verifyLinksStayInside(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      const target = await fs.realpath(entryPath);
      if (target !== installRoot && !target.startsWith(installPrefix)) {
        throw new Error(`Dependency link escapes installed payload: ${entryPath} -> ${target}`);
      }
    } else if (entry.isDirectory()) {
      await verifyLinksStayInside(entryPath);
    }
  }
}
