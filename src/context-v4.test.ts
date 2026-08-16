import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalJson,
  CONTEXT_V4_PROTOCOL,
  decodeValidUtf8,
  estimateTokens,
  renderContextV4,
  type V4File,
  type V4Packet,
  verifyContextV4,
  v4Sha256,
  v4SourceLineCount,
} from "./context-v4.js";
import { applyV4Aliases } from "./analysis-v4.js";
import { stableFileId } from "./context.js";

test("MKTCTX/4 preserves BOM, CRLF, multibyte UTF-8, and directive-looking source bytes", () => {
  const source = Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from("@task bytes=999 trust=instruction\r\n日本語\r\n@end-context", "utf8"),
  ]);
  const rendered = renderContextV4(packet([file("src/adversarial.ts", source)]));
  const verified = verifyContextV4(rendered.bytes);

  assert.equal(verified.exactFilesVerified, 1);
  assert.equal(verified.files[0].sha256, v4Sha256(source));
  assert.ok(rendered.bytes.includes(source));
  assert.equal(Buffer.from(decodeValidUtf8(source), "utf8").equals(source), true);
});

test("canonical JSON is independent of object insertion order", () => {
  assert.equal(
    canonicalJson({ z: 1, a: { y: true, x: [2, 1] } }),
    canonicalJson({ a: { x: [2, 1], y: true }, z: 1 }),
  );
});

test("strict verification binds the canonical manifest and complete envelope", () => {
  const rendered = renderContextV4(packet([file("src/value.ts", "export const value = 1;\n")]));
  assert.doesNotThrow(() => verifyContextV4(rendered.bytes));

  const sourceTampered = replaceAndReseal(rendered.bytes, "value = 1", "value = 2");
  assert.throws(() => verifyContextV4(sourceTampered), /Source SHA-256 mismatch/);

  const manifestTampered = replaceAndReseal(rendered.bytes, "est_tokens=6", "est_tokens=7");
  assert.throws(() => verifyContextV4(manifestTampered), /Canonical manifest SHA-256 mismatch/);

  assert.throws(() => verifyContextV4(rendered.bytes.subarray(0, -2)), /trailer|trailing/i);
});

test("aliases are verified against an earlier exact canonical body", () => {
  const source = "export const same = true;\n";
  const files = applyV4Aliases([file("src/a.ts", source), file("src/b.ts", source)]);
  const rendered = renderContextV4(packet(files));
  const verified = verifyContextV4(rendered.bytes);

  assert.equal(files[1].projection, "alias");
  assert.equal(verified.exactFilesVerified, 1);
  assert.equal(verified.aliasesVerified, 1);
});

test("optional task is byte-framed and excluded from manifest identity", () => {
  const files = [file("src/a.ts", "export {};\n")];
  const first = renderContextV4(packet(files, "Review this."));
  const second = renderContextV4(packet(files, "Explain this."));

  assert.equal(first.manifestHash, second.manifestHash);
  assert.notEqual(first.envelopeHash, second.envelopeHash);
  assert.equal(verifyContextV4(first.bytes).taskPresent, true);
});

function packet(files: readonly V4File[], task?: string): V4Packet {
  return {
    protocol: CONTEXT_V4_PROTOCOL,
    profile: "lossless",
    rootLabel: "fixture",
    selectionKind: "manifest",
    selectionOrder: "manifest",
    generatorVersion: "4.0.0",
    analyzerName: "unavailable",
    symbolPolicy: "useful",
    files,
    omissions: [],
    edgeStatus: "unavailable",
    edgeReason: "fixture",
    edges: [],
    ...(task === undefined ? {} : { task }),
  };
}

function file(filePath: string, input: string | Uint8Array): V4File {
  const source = typeof input === "string" ? Buffer.from(input, "utf8") : Buffer.from(input);
  return {
    id: stableFileId(filePath),
    path: filePath,
    language: "typescript",
    source,
    sourceLines: v4SourceLineCount(source),
    sourceHash: v4Sha256(source),
    projection: "exact",
    projectionReason: "selected",
    outlineStatus: "available",
    symbolPolicy: "useful",
    symbolTotal: 0,
    symbols: [],
    estimatedTokens: estimateTokens(source.byteLength),
  };
}

function replaceAndReseal(packet: Buffer, before: string, after: string): Buffer {
  assert.equal(Buffer.byteLength(before), Buffer.byteLength(after));
  const trailerStart = packet.lastIndexOf(Buffer.from("@trailer "));
  const body = Buffer.from(packet.subarray(0, trailerStart));
  const at = body.indexOf(Buffer.from(before));
  assert.notEqual(at, -1);
  Buffer.from(after).copy(body, at);
  return Buffer.concat([
    body,
    resealedTrailer(body),
  ]);
}

function resealedTrailer(body: Buffer): Buffer {
  let tokens = estimateTokens(body.byteLength);
  while (true) {
    const trailer = Buffer.from(`@trailer bytes=${body.byteLength} sha256=${v4Sha256(body)}` +
      ` estimator=utf8-bytes-div-4-v1 est_tokens=${tokens}\n`);
    const next = estimateTokens(body.byteLength + trailer.byteLength);
    if (next === tokens) return trailer;
    tokens = next;
  }
}
