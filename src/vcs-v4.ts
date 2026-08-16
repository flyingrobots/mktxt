import { spawnSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { type V4Change, type V4GitProvenance, v4Sha256 } from "./context-v4.js";

export interface GitDiffSelection {
  readonly provenance: Omit<V4GitProvenance, "changes"> & { readonly changes: readonly V4Change[] };
  readonly changedPaths: ReadonlySet<string>;
}

export async function readGitDiffSelection(root: string, baseRef: string): Promise<GitDiffSelection> {
  const repositoryRoot = gitText(root, ["rev-parse", "--show-toplevel"]);
  const normalizedRoot = await fs.realpath(repositoryRoot);
  const base = gitText(normalizedRoot, ["rev-parse", "--verify", `${baseRef}^{commit}`]);
  const head = gitText(normalizedRoot, ["rev-parse", "HEAD"]);
  const branchResult = gitRun(normalizedRoot, ["symbolic-ref", "--quiet", "--short", "HEAD"], true);
  const branch = branchResult.status === 0 ? branchResult.stdout.toString("utf8").trim() : `detached@${head.slice(0, 12)}`;
  const dirty = gitRun(normalizedRoot, ["status", "--porcelain=v1", "-z"]).stdout.byteLength > 0;
  const diff = gitRun(normalizedRoot, ["diff", "--name-status", "-z", "--find-renames", baseRef, "--"]);
  const changes = parseNameStatus(diff.stdout);
  const knownPaths = new Set(changes.map((change) => change.path));

  const untracked = splitNul(gitRun(normalizedRoot, ["ls-files", "--others", "--exclude-standard", "-z"]).stdout);
  for (const untrackedPath of untracked) {
    const normalized = normalize(untrackedPath);
    if (!knownPaths.has(normalized)) {
      changes.push({ status: "added", path: normalized });
      knownPaths.add(normalized);
    }
  }

  const withBaseHashes: V4Change[] = [];
  for (const change of changes) {
    const basePath = change.previousPath ?? change.path;
    const baseBytes = change.status === "added" ? undefined : gitShowOptional(normalizedRoot, base, basePath);
    withBaseHashes.push({
      ...change,
      ...(baseBytes === undefined ? {} : { baseSha256: v4Sha256(baseBytes) }),
    });
  }
  return {
    provenance: {
      branch,
      head,
      baseRef,
      base,
      dirty,
      source: "working-tree",
      changes: withBaseHashes,
    },
    changedPaths: new Set(withBaseHashes.filter((change) => change.status !== "deleted").map((change) => change.path)),
  };
}

export function attachChangeFileIds(
  provenance: GitDiffSelection["provenance"],
  fileIdsByPath: ReadonlyMap<string, string>,
): V4GitProvenance {
  return {
    ...provenance,
    changes: provenance.changes.map((change) => ({
      ...change,
      ...(fileIdsByPath.get(change.path) === undefined ? {} : { fileId: fileIdsByPath.get(change.path)! }),
    })),
  };
}

function parseNameStatus(buffer: Buffer): V4Change[] {
  const fields = splitNul(buffer);
  const changes: V4Change[] = [];
  for (let index = 0; index < fields.length;) {
    const code = fields[index++];
    const statusCode = code[0];
    if (statusCode === "R" || statusCode === "C") {
      const previousPath = fields[index++];
      const currentPath = fields[index++];
      if (previousPath === undefined || currentPath === undefined) throw new Error(`Malformed git ${code} record`);
      changes.push({
        status: statusCode === "R" ? "renamed" : "copied",
        previousPath: normalize(previousPath),
        path: normalize(currentPath),
        similarity: Number(code.slice(1)),
      });
      continue;
    }
    const filePath = fields[index++];
    if (filePath === undefined) throw new Error(`Malformed git ${code} record`);
    changes.push({ status: mapStatus(statusCode), path: normalize(filePath) });
  }
  return changes;
}

function mapStatus(code: string): V4Change["status"] {
  switch (code) {
    case "A": return "added";
    case "M": return "modified";
    case "D": return "deleted";
    case "T": return "type-changed";
    case "U": return "unmerged";
    default: throw new Error(`Unsupported git change status: ${code}`);
  }
}

function gitShowOptional(root: string, commit: string, filePath: string): Buffer | undefined {
  const result = gitRun(root, ["show", `${commit}:${filePath}`], true);
  if (result.status !== 0) return undefined;
  return result.stdout;
}

function gitText(root: string, args: readonly string[]): string {
  return gitRun(root, args).stdout.toString("utf8").trim();
}

function gitRun(root: string, args: readonly string[], allowFailure = false): { status: number; stdout: Buffer; stderr: Buffer } {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "buffer",
    maxBuffer: 128 * 1024 * 1024,
  });
  if (result.error !== undefined) throw result.error;
  const status = result.status ?? 1;
  const stdout = Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout ?? "");
  const stderr = Buffer.isBuffer(result.stderr) ? result.stderr : Buffer.from(result.stderr ?? "");
  if (!allowFailure && status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${stderr.toString("utf8").trim() || `exit ${status}`}`);
  }
  return { status, stdout, stderr };
}

function splitNul(buffer: Buffer): string[] {
  return buffer.toString("utf8").split("\0").filter((field) => field.length > 0);
}

function normalize(filePath: string): string {
  return filePath.split(path.sep).join("/");
}
