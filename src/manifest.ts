import * as fs from "node:fs/promises";
import * as path from "node:path";

type PathRecord = { path: string };
type PathsRecord = { paths: unknown[] };

export async function readPathManifest(source: string, invocationCwd: string): Promise<string[]> {
  const content = source === "-"
    ? await readStdin()
    : await fs.readFile(path.resolve(invocationCwd, source), "utf8");

  return parsePathManifest(content);
}

async function readStdin(): Promise<string> {
  process.stdin.setEncoding("utf8");
  let content = "";
  for await (const chunk of process.stdin) {
    content += chunk;
  }
  return content;
}

export function parsePathManifest(content: string): string[] {
  const normalized = content.replace(/^\uFEFF/, "");
  const trimmed = normalized.trim();

  if (trimmed.length === 0) return [];

  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      return pathsFromJsonValue(JSON.parse(trimmed), "JSON manifest");
    } catch (error) {
      if (trimmed.startsWith("[")) throw manifestError(error);
      // Multiple JSON objects are valid JSONL even though the whole input is
      // not one valid JSON document. Fall through to line-by-line parsing.
    }
  }

  const paths: string[] = [];
  for (const [index, rawLine] of normalized.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (line.length === 0) continue;

    if (line.startsWith("{") || line.startsWith("[") || line.startsWith("\"")) {
      try {
        paths.push(...pathsFromJsonValue(JSON.parse(line), `line ${index + 1}`));
      } catch (error) {
        throw manifestError(error, index + 1);
      }
    } else {
      paths.push(validatePath(line, `line ${index + 1}`));
    }
  }

  return paths;
}

function pathsFromJsonValue(value: unknown, location: string): string[] {
  if (typeof value === "string") {
    return [validatePath(value, location)];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => pathFromJsonEntry(entry, `${location}[${index}]`));
  }

  if (isPathsRecord(value)) {
    return value.paths.flatMap((entry, index) => pathFromJsonEntry(entry, `${location}.paths[${index}]`));
  }

  return pathFromJsonEntry(value, location);
}

function pathFromJsonEntry(value: unknown, location: string): string[] {
  if (typeof value === "string") {
    return [validatePath(value, location)];
  }

  if (isPathRecord(value)) {
    return [validatePath(value.path, `${location}.path`)];
  }

  throw new Error(`${location} must be a path string or an object with a string \"path\" field`);
}

function validatePath(value: string, location: string): string {
  if (value.length === 0) {
    throw new Error(`${location} contains an empty path`);
  }
  if (value.includes("\0")) {
    throw new Error(`${location} contains a NUL byte`);
  }
  return value;
}

function isPathRecord(value: unknown): value is PathRecord {
  return typeof value === "object" && value !== null && "path" in value &&
    typeof (value as Record<string, unknown>).path === "string";
}

function isPathsRecord(value: unknown): value is PathsRecord {
  return typeof value === "object" && value !== null && "paths" in value &&
    Array.isArray((value as Record<string, unknown>).paths);
}

function manifestError(error: unknown, line?: number): Error {
  const prefix = line === undefined ? "Invalid path manifest" : `Invalid path manifest at line ${line}`;
  const message = error instanceof Error ? error.message : String(error);
  return new Error(`${prefix}: ${message}`);
}
