import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { readGitDiffSelection } from "./vcs-v4.js";
import { v4Sha256 } from "./context-v4.js";

test("Git provenance distinguishes modifications, deletions, renames, and untracked additions", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mktxt-git-v4-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "mktxt@example.invalid"]);
  git(root, ["config", "user.name", "mktxt test"]);
  await fs.writeFile(path.join(root, "modified.ts"), "export const value = 1;\n");
  await fs.writeFile(path.join(root, "deleted.ts"), "delete me\n");
  await fs.writeFile(path.join(root, "before.ts"), "export const renamed = true;\n");
  git(root, ["add", "."]);
  git(root, ["commit", "-qm", "base"]);
  const base = git(root, ["rev-parse", "HEAD"]).trim();

  await fs.writeFile(path.join(root, "modified.ts"), "export const value = 2;\n");
  await fs.rm(path.join(root, "deleted.ts"));
  await fs.rename(path.join(root, "before.ts"), path.join(root, "after.ts"));
  await fs.writeFile(path.join(root, "untracked.ts"), "export const fresh = true;\n");
  git(root, ["add", "-A"]);

  const selection = await readGitDiffSelection(root, base);
  const byStatus = new Map(selection.provenance.changes.map((change) => [change.status, change]));
  assert.equal(selection.provenance.base, base);
  assert.equal(selection.provenance.dirty, true);
  assert.equal(byStatus.get("modified")?.path, "modified.ts");
  assert.equal(byStatus.get("deleted")?.path, "deleted.ts");
  assert.equal(byStatus.get("renamed")?.path, "after.ts");
  assert.equal(byStatus.get("renamed")?.previousPath, "before.ts");
  assert.equal(byStatus.get("added")?.path, "untracked.ts");
  assert.equal(byStatus.get("modified")?.baseSha256, v4Sha256("export const value = 1;\n"));
  assert.deepEqual([...selection.changedPaths].sort(), ["after.ts", "modified.ts", "untracked.ts"]);
});

function git(root: string, args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}
