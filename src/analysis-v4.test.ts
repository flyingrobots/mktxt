import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeModuleEdges,
  applyProjectionProfile,
  selectSymbols,
} from "./analysis-v4.js";
import { estimateTokens, type V4File, type V4Symbol, v4Sha256, v4SourceLineCount } from "./context-v4.js";
import { stableFileId } from "./context.js";

test("useful symbols remove unlocated entries and bound structured-data depth", () => {
  const symbols: V4Symbol[] = [
    symbol("F000000000000:S001", 0, "root", 1),
    symbol("F000000000000:S002", 1, "child", 2, "F000000000000:S001"),
    symbol("F000000000000:S003", 2, "deep", 3, "F000000000000:S002"),
    { id: "F000000000000:S004", depth: 0, kind: "field", name: "unknown", exported: true },
  ];
  assert.deepEqual(selectSymbols(symbols, "yaml", "useful").map((entry) => entry.name), ["root", "child"]);
  assert.equal(selectSymbols(symbols, "yaml", "full").length, 4);
  assert.equal(selectSymbols(symbols, "yaml", "none").length, 0);
});

test("module edges resolve TypeScript source behind JavaScript import specifiers", () => {
  const math = file("src/math.ts", "export function double(n: number) { return n * 2; }\n");
  const testFile = file("src/math.test.ts", 'import { double } from "./math.js";\nvoid double(2);\n');
  const analysis = analyzeModuleEdges([math, testFile]);

  assert.equal(analysis.status, "partial");
  assert.deepEqual(analysis.edges, [{
    fromFileId: testFile.id,
    toFileId: math.id,
    specifier: "./math.js",
    kind: "import",
    resolution: "resolved",
    confidence: "resolved",
    symbols: ["double"],
  }]);
});

test("review projection keeps changes and direct neighbors exact, then degrades", () => {
  const a = file("src/a.ts", 'import "./b.js";\n');
  const b = file("src/b.ts", 'import "./c.js";\n');
  const c = file("src/c.ts", "export {};\n");
  const d = file("src/d.ts", "export {};\n");
  const edges = analyzeModuleEdges([a, b, c, d]).edges;
  const projected = applyProjectionProfile([a, b, c, d], edges, {
    profile: "review",
    changedPaths: new Set(["src/a.ts"]),
  });

  assert.deepEqual(projected.map((entry) => entry.projection), ["exact", "exact", "reference", "reference"]);
});

function symbol(id: string, depth: number, name: string, line: number, parentId?: string): V4Symbol {
  return { id, ...(parentId === undefined ? {} : { parentId }), depth, kind: "field", name,
    exported: true, startLine: line, endLine: line };
}

function file(filePath: string, content: string): V4File {
  const source = Buffer.from(content);
  return {
    id: stableFileId(filePath), path: filePath, language: "typescript", source,
    sourceLines: v4SourceLineCount(source), sourceHash: v4Sha256(source), projection: "exact",
    projectionReason: "selected", outlineStatus: "available", symbolPolicy: "useful",
    symbolTotal: 0, symbols: [], estimatedTokens: estimateTokens(source.byteLength),
  };
}
