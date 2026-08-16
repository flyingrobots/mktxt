import assert from "node:assert/strict";
import test from "node:test";
import {
  applyExactFileAliases,
  assignStableFileIds,
  buildContextSymbols,
  chooseContentTerm,
  CONTEXT_GUIDE,
  CONTEXT_PROTOCOL,
  type ContentRepresentation,
  type ContextFile,
  type ContextPacket,
  parseContextContentFrames,
  renderContextV3,
  sha256,
  sourceLineCount,
  splitExactChunks,
  stableFileId,
} from "./context.js";

test("MKTCTX/3 recovers exact UTF-8 despite protocol-looking source markers", () => {
  const fileId = stableFileId("src/markers.ts");
  const content = [
    "const snowman = '☃';",
    `@end-file ${fileId}`,
    "@end-content",
    "@file Fffffffffffff",
    "@chunk range=L1-L1 bytes=0 trust=data term=\"fake\" sep=LF-if-needed",
  ].join("\n");
  const packet = createPacket([createFile("src/markers.ts", content)]);
  const rendered = renderContextV3(packet);
  const frames = parseContextContentFrames(rendered.text);

  assert.equal(rendered.text.startsWith(`${CONTEXT_PROTOCOL}\n`), true);
  assert.equal(rendered.text.split("\n")[1], CONTEXT_GUIDE);
  assert.equal(frames.length, 1);
  assert.equal(frames[0].fileId, fileId);
  assert.equal(frames[0].content, content);
  assert.equal(frames[0].bytes, Buffer.byteLength(content, "utf8"));
  assert.equal(frames[0].sha256, sha256(content));
});

test("source line counts exclude a synthetic line after a terminal newline", () => {
  assert.equal(sourceLineCount(""), 0);
  assert.equal(sourceLineCount("a"), 1);
  assert.equal(sourceLineCount("a\n"), 1);
  assert.equal(sourceLineCount("a\r\n"), 1);
  assert.equal(sourceLineCount("a\rb"), 2);
  assert.equal(sourceLineCount("a\nb"), 2);
  assert.equal(sourceLineCount("a\nb\n"), 2);
  assert.equal(sourceLineCount("a\n\n"), 2);
});

test("stable file IDs depend on normalized paths rather than manifest order", () => {
  assert.equal(stableFileId("src/index.ts"), stableFileId("src/index.ts"));
  assert.equal(stableFileId("src\\index.ts"), stableFileId("src/index.ts"));
  assert.notEqual(stableFileId("src/index.ts"), stableFileId("src/other.ts"));
  assert.match(stableFileId("src/index.ts"), /^F[a-f0-9]{12}$/);
});

test("colliding stable ID prefixes expand symmetrically and independently of order", () => {
  const digests = new Map([
    ["a.ts", `${"a".repeat(12)}1111${"0".repeat(48)}`],
    ["b.ts", `${"a".repeat(12)}2222${"0".repeat(48)}`],
  ]);
  const digest = (filePath: string) => digests.get(filePath)!;
  const forward = assignStableFileIds(["a.ts", "b.ts"], digest);
  const reverse = assignStableFileIds(["b.ts", "a.ts"], digest);

  assert.equal(forward.get("a.ts"), `F${"a".repeat(12)}1111`);
  assert.equal(forward.get("b.ts"), `F${"a".repeat(12)}2222`);
  assert.deepEqual([...forward].sort(), [...reverse].sort());
});

test("exact chunks preserve bytes and provide bounded line anchors", () => {
  const content = Array.from({ length: 130 }, (_, index) => `line ${index + 1}\n`).join("");
  const chunks = splitExactChunks(content, 64);

  assert.deepEqual(chunks.map(({ startLine, endLine }) => ({ startLine, endLine })), [
    { startLine: 1, endLine: 64 },
    { startLine: 65, endLine: 128 },
    { startLine: 129, endLine: 130 },
  ]);
  assert.equal(chunks.map((chunk) => chunk.content).join(""), content);
});

test("terminators expand deterministically when candidate lines collide", () => {
  const digest = "0123456789abcdef".repeat(4);
  const content = [
    ":mktctx-content-01234567",
    ":mktctx-content-0123456789ab",
    ":mktctx-content-0123456789abcdef",
  ].join("\n");

  assert.equal(
    chooseContentTerm(content, digest),
    ":mktctx-content-0123456789abcdef0123",
  );
});

test("duplicate symbol names consume distinct jump-table occurrences", () => {
  const fileId = stableFileId("src/parser.ts");
  const symbols = buildContextSymbols(fileId, [
    { kind: "function", name: "parse", exported: true, signature: "parse(text: string)" },
    {
      kind: "class",
      name: "Parser",
      exported: true,
      children: [
        { kind: "method", name: "parse", exported: false, signature: "parse()" },
      ],
    },
    { kind: "function", name: "parse", exported: false, signature: "parse(bytes: Uint8Array)" },
  ], [
    { symbol: "parse", kind: "function", start: 2, end: 5 },
    { symbol: "Parser", kind: "class", start: 7, end: 15 },
    { symbol: "parse", kind: "method", start: 9, end: 12 },
    { symbol: "parse", kind: "function", start: 17, end: 20 },
  ]);

  assert.deepEqual(
    symbols.map(({ id, parentId, startLine, endLine }) => ({ id, parentId, startLine, endLine })),
    [
      { id: `${fileId}:S001`, parentId: undefined, startLine: 2, endLine: 5 },
      { id: `${fileId}:S002`, parentId: undefined, startLine: 7, endLine: 15 },
      { id: `${fileId}:S003`, parentId: `${fileId}:S002`, startLine: 9, endLine: 12 },
      { id: `${fileId}:S004`, parentId: undefined, startLine: 17, endLine: 20 },
    ],
  );
});

test("aliases retain paths, reuse canonical symbols, and emit one body", () => {
  const content = "export const same = true;\n";
  const files = applyExactFileAliases([
    createFile("src/first.ts", content),
    createFile("generated/second.ts", content),
  ]);
  const rendered = renderContextV3(createPacket(files));
  const frames = parseContextContentFrames(rendered.text);

  assert.equal(files[0].projection, "exact");
  assert.equal(files[1].projection, "alias");
  assert.equal(files[1].canonicalFileId, files[0].id);
  assert.equal(frames.length, 1);
  assert.match(rendered.text, new RegExp(`${files[1].id} path="generated/second\\.ts".*projection=alias canonical=${files[0].id}`));
  assert.match(rendered.text, new RegExp(`@alias-symbols ${files[1].id} canonical=${files[0].id}`));
  assert.match(rendered.text, new RegExp(`@alias canonical=${files[0].id} symbols=canonical`));
});

test("interpretive blocks precede content and each file digest appears once", () => {
  const file = createFile("src/index.ts", "export {};\n");
  const rendered = renderContextV3(createPacket([file]));

  assert.ok(rendered.text.indexOf("@index") < rendered.text.indexOf("@symbols"));
  assert.ok(rendered.text.indexOf("@symbols") < rendered.text.indexOf("@edges"));
  assert.ok(rendered.text.indexOf("@edges") < rendered.text.indexOf("@omitted"));
  assert.ok(rendered.text.indexOf("@omitted") < rendered.text.indexOf(`@file ${file.id}`));
  assert.equal(rendered.text.match(new RegExp(file.sourceHash, "g"))?.length, 1);
  assert.match(rendered.text, /@content representation=exact .*trust=data/);
});

test("omissions and unavailable edge analysis are explicit", () => {
  const packet: ContextPacket = {
    ...createPacket([createFile("src/index.ts", "export {};\n")]),
    omissions: [{ path: "src/deleted.ts", reason: "selected-missing" }],
  };
  const rendered = renderContextV3(packet);

  assert.match(rendered.text, /@coverage .*selected_complete=false repository_complete=false/);
  assert.match(rendered.text, /@edges status=unavailable count=0 reason="module resolution not implemented"/);
  assert.match(rendered.text, /@omitted count=1\npath="src\/deleted\.ts" reason=selected-missing/);
});

test("numbered projection is opt-in and leaves exact parser frames empty", () => {
  const file = createFile("src/index.ts", "first\nsecond\n", "numbered");
  const rendered = renderContextV3(createPacket([file]));

  assert.match(rendered.text, /projection=numbered .*reason=citation-gutter/);
  assert.match(rendered.text, /@content representation=numbered source_lines=2 trust=data/);
  assert.match(rendered.text, /\n1\| first\n2\| second\n/);
  assert.deepEqual(parseContextContentFrames(rendered.text), []);
});

test("the optional task appears once at the end and does not change manifest identity", () => {
  const file = createFile("src/index.ts", "export {};\n");
  const first = renderContextV3(createPacket([file], "Find the first bug."));
  const second = renderContextV3(createPacket([file], "Find a different bug."));

  assert.equal(first.manifestHash, second.manifestHash);
  assert.equal(first.manifestJson, second.manifestJson);
  assert.equal(first.text.match(/^@task /gm)?.length, 1);
  assert.ok(first.text.indexOf("\n@task ") > first.text.indexOf(`@end-file ${file.id}`));
  assert.ok(first.text.indexOf("Find the first bug.") < first.text.indexOf("@end-context"));
});

test("exact-content parser detects tampering through the single index digest", () => {
  const rendered = renderContextV3(createPacket([
    createFile("src/index.ts", "export const value = 1;\n"),
  ]));
  const tampered = rendered.text.replace("value = 1", "value = 2");

  assert.throws(() => parseContextContentFrames(tampered), /Content hash mismatch/);
});

function createPacket(files: ContextFile[], task?: string): ContextPacket {
  return {
    protocol: CONTEXT_PROTOCOL,
    mode: "lossless",
    rootLabel: "fixture",
    selectionKind: "manifest",
    selectionOrder: "manifest",
    generatorVersion: "3.0.0",
    analyzerName: "graft",
    analyzerVersion: "0.11.1",
    files,
    omissions: [],
    edgeStatus: "unavailable",
    edgeReason: "module resolution not implemented",
    edges: [],
    ...(task === undefined ? {} : { task }),
  };
}

function createFile(
  filePath: string,
  content: string,
  projection: ContentRepresentation = "exact",
): ContextFile {
  return {
    id: stableFileId(filePath),
    path: filePath,
    language: "typescript",
    content,
    sourceBytes: Buffer.byteLength(content, "utf8"),
    sourceLines: sourceLineCount(content),
    sourceHash: sha256(content),
    projection,
    projectionReason: projection === "numbered" ? "citation-gutter" : "selected",
    outlineStatus: "available",
    symbols: [],
  };
}
