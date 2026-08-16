import assert from "node:assert/strict";
import test from "node:test";
import { parsePathManifest } from "./manifest.js";

test("parses newline-separated paths", () => {
  assert.deepEqual(
    parsePathManifest("src/index.ts\r\n\nREADME.md\n"),
    ["src/index.ts", "README.md"],
  );
});

test("parses JSON arrays and paths objects", () => {
  assert.deepEqual(
    parsePathManifest('["src/index.ts", {"path":"README.md"}]'),
    ["src/index.ts", "README.md"],
  );
  assert.deepEqual(
    parsePathManifest('{"paths":["src/index.ts", {"path":"README.md"}]}'),
    ["src/index.ts", "README.md"],
  );
});

test("parses JSONL strings and path objects", () => {
  assert.deepEqual(
    parsePathManifest('"src/index.ts"\n{"path":"README.md"}\n'),
    ["src/index.ts", "README.md"],
  );
});

test("reports the invalid JSONL line", () => {
  assert.throws(
    () => parsePathManifest('"src/index.ts"\n{"file":"README.md"}\n'),
    /Invalid path manifest at line 2/,
  );
});
