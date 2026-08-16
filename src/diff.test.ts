import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { generateUnifiedDiff } from "./diff.js";

test("streams unified diffs larger than the spawnSync buffer limit", async (t) => {
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "mktxt-diff-"));
  t.after(() => fs.rm(fixture, { recursive: true, force: true }));
  const previous = path.join(fixture, "previous.txt");
  const output = path.join(fixture, "output.txt");
  const diff = path.join(fixture, "output.diff");
  const lineCount = 150_000;
  await fs.writeFile(previous, `${"old\n".repeat(lineCount)}`);
  await fs.writeFile(output, `${"new\n".repeat(lineCount)}`);

  await generateUnifiedDiff(previous, output, diff);

  const stat = await fs.stat(diff);
  assert.ok(stat.size > 1_048_576, `expected a >1 MiB diff, got ${stat.size} bytes`);
  const handle = await fs.open(diff, "r");
  try {
    const prefix = Buffer.alloc(128);
    const { bytesRead } = await handle.read(prefix, 0, prefix.length, 0);
    assert.match(prefix.subarray(0, bytesRead).toString("utf8"), /^--- .*previous\.txt/m);
  } finally {
    await handle.close();
  }
});

test("creates an empty diff when no previous aggregate exists", async (t) => {
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "mktxt-diff-"));
  t.after(() => fs.rm(fixture, { recursive: true, force: true }));
  const output = path.join(fixture, "output.txt");
  const diff = path.join(fixture, "output.diff");
  await fs.writeFile(output, "current\n");

  await generateUnifiedDiff(path.join(fixture, "missing.txt"), output, diff);

  assert.equal(await fs.readFile(diff, "utf8"), "");
});
