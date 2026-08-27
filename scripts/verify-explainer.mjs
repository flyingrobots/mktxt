#!/usr/bin/env node
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { verifyContextV5 } from "../dist/context-v5.js";

const root = path.resolve(import.meta.dirname, "..");
const explainerPath = path.join(root, "docs/explain.md");
const fixturePath = path.join(root, "docs/examples/mktctx-v5-exact.mktctx");
const [explainer, fixture] = await Promise.all([
  fs.readFile(explainerPath, "utf8"),
  fs.readFile(fixturePath, "utf8"),
]);

const embedded = /```text\n(MKTCTX\/5\n[\s\S]*?)\n```/.exec(explainer)?.[1];
if (embedded === undefined) throw new Error("Explainer does not contain a complete MKTCTX/5 text block");
if (`${embedded}\n` !== fixture) throw new Error("Explainer's canonical packet differs from the generated V5 fixture");

const verified = verifyContextV5(Buffer.from(fixture, "utf8"));
const expected = {
  packetId: "P6eada7119327",
  manifestSha256: "6eada7119327cff993e77369e3dcb9685423ef4b58e1ee00a4349d368cf41942",
  envelopeSha256: "6fe6b6f4749adf86550b5c1c81ca239b09055602bacaa791d62534dedf0f9096",
};
for (const [key, value] of Object.entries(expected)) {
  if (verified[key] !== value) throw new Error(`Explainer fixture ${key} changed: ${verified[key]} != ${value}`);
  if (!explainer.includes(value)) throw new Error(`Explainer prose does not identify ${key} ${value}`);
}
if (verified.filesDeclared !== 3 || verified.exactFilesVerified !== 2 || verified.aliasesVerified !== 1) {
  throw new Error("Explainer fixture file, exact-body, or alias counts changed");
}
if (!verified.selectionComplete || !verified.policyCompliant || verified.diagnostics.length !== 0) {
  throw new Error("Explainer fixture selection or diagnostic posture changed");
}

const requiredRelations = [
  "request_sha256=670568d940138427adef924837a9cdd7db867cc551a68926901ece36c2f7b173",
  "normalized_requested=3 included=3 omitted=0 repository_total=unknown",
  "aliases_included=1",
  "F9c6e445a719b path=\"src/math.ts\"",
  "Fd6a0af48e152 path=\"src/math.test.ts\"",
  "F02dadac9836a path=\"fixtures/math-copy.ts\"",
  "sha256=7427cb931505e1a72ab73ed89948ad77a821ddcdb262dd129da844f619aef6e3",
  "sha256=6d1dc27b26c4b09933f5172a4d64e7e4262864b4158a68466dba0bb9583a07e5",
  "@index",
  "@symbols",
  "@edges status=partial count=1",
  "@diagnostics policy=record count=0",
  "@omitted count=0",
  "@end-context",
  "@trailer bytes=4028",
];
for (const relation of requiredRelations) {
  if (!fixture.includes(relation)) throw new Error(`Generated fixture is missing required relation: ${relation}`);
  if (!explainer.includes(relation)) throw new Error(`Explainer is missing generated relation: ${relation}`);
}

for (const primaryLink of [
  "https://git-scm.com/docs/git-bundle",
  "https://git-scm.com/docs/bundle-format",
  "https://git-scm.com/book/en/v2/Git-Internals-Git-Objects",
  "https://git-scm.com/book/en/v2/Git-Internals-Packfiles",
]) {
  if (!explainer.includes(primaryLink)) throw new Error(`Explainer is missing primary Git reference: ${primaryLink}`);
}

const diagrams = [...explainer.matchAll(/```mermaid\n([\s\S]*?)\n```/g)].map((match) => match[1]);
if (diagrams.length < 3) throw new Error(`Expected at least three earned Mermaid diagrams; found ${diagrams.length}`);
const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "mktctx-explainer-"));
try {
  for (const [index, diagram] of diagrams.entries()) {
    const input = path.join(temporaryDirectory, `figure-${index + 1}.mmd`);
    const output = path.join(temporaryDirectory, `figure-${index + 1}.svg`);
    await fs.writeFile(input, `${diagram}\n`, "utf8");
    const rendered = spawnSync("mmdc", ["-i", input, "-o", output, "--quiet"], { encoding: "utf8" });
    if (rendered.status !== 0) {
      throw new Error(`Mermaid figure ${index + 1} failed to render:\n${rendered.stderr || rendered.stdout}`);
    }
    const svg = await fs.readFile(output, "utf8");
    if (!svg.includes("<svg")) throw new Error(`Mermaid figure ${index + 1} did not produce SVG`);
  }
} finally {
  await fs.rm(temporaryDirectory, { recursive: true, force: true });
}

console.log(
  `Verified progressive explainer: exact generated packet, ${verified.filesDeclared} files, ` +
  `${diagrams.length} rendered Mermaid figures, and primary Git references`,
);
