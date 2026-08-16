#!/usr/bin/env node
import * as fs from "node:fs/promises";
import * as path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const catalogPath = path.join(root, "docs/feedback/mktctx/index.json");
const checkOnly = process.argv.includes("--check");

const acceptedComplete = new Map([
  ["chatgpt-2026-08-11-001-git-provenance-and-diff-semantics", "Accepted as MKTCTX/4 Git working-tree provenance and typed change records, including deletions, renames, and base blob hashes."],
  ["chatgpt-2026-08-11-004-formal-grammar-and-collision-rules", "Accepted as the MKTCTX/4 normative byte, UTF-8, canonicalization, identifier, and framing specification with adversarial fixtures."],
  ["chatgpt-2026-08-11-005-whole-packet-integrity", "Accepted as the canonical manifest digest plus terminal byte-counted whole-envelope SHA-256 trailer."],
  ["chatgpt-2026-08-11-007-context-budget-profiles", "Accepted as lossless, review, and structure profiles with explicit projections and declared heuristic budgets."],
  ["gemini-2026-08-11-002-populated-import-export-edges", "Accepted as confidence-bearing JavaScript and TypeScript module edges with honest partial-resolution posture."],
  ["gemini-2026-08-11-004-redundant-symbol-signatures", "Accepted by omitting signatures identical to symbol names while retaining nonredundant signatures."],
  ["kimi-k3-2026-08-11-001-length-prefixed-framing", "Accepted and completed in MKTCTX/4: bytes is the normative payload boundary, apparent directives inside payloads are inert, and terminators are secondary checks."],
  ["kimi-k3-2026-08-11-002-encoding-and-normalization", "Accepted as original valid UTF-8 source bytes with preserved BOM and newline sequences; invalid UTF-8 remains explicit."],
  ["kimi-k3-2026-08-11-003-range-unavailability-semantics", "Accepted and completed in MKTCTX/4: unavailable symbol locations use range_status=unavailable instead of overloading a source range."],
  ["kimi-k3-2026-08-11-004-truncation-and-closing-integrity", "Accepted as strict @end-context enforcement and a terminal envelope byte count and SHA-256."],
  ["kimi-k3-2026-08-11-005-deterministic-canonical-serialization", "Accepted as mktctx-cjson-1 sorted-key canonical JSON and deterministic wire/test-vector rules."],
  ["kimi-k3-2026-08-11-007-populated-dependency-edges", "Accepted in a staged first implementation: syntax extraction plus selected-file relative resolution with declared limitations."],
  ["kimi-k3-2026-08-11-011-projection-tier-ladder", "Accepted as named profiles, exact/numbered/signatures/outline/reference/alias projections, and explicit loss posture."],
  ["kimi-k3-2026-08-11-012-consumer-verification-procedure", "Accepted as the normative ten-layer verification procedure and executable conformance fixtures."],
  ["claude-fable-2026-08-11-001-symbol-outline-budget-policy", "Accepted as useful/full/none symbol policies with per-language depth and location filtering plus total/emitted counts."],
  ["claude-fable-2026-08-11-002-packet-defaults-and-attribute-elision", "Accepted selectively: default projection, reason, and false export are elided; local trust=data and explicit depth remain."],
  ["claude-fable-2026-08-11-004-edge-ranked-selection", "Accepted as deterministic review-profile graph distances from Git-changed paths with explicit projection reasons."],
  ["claude-fable-2026-08-11-005-model-visible-data-boundary", "Accepted and completed in MKTCTX/4: the guide and every exact chunk state the local byte-framed data boundary while avoiding claims of complete prompt-injection prevention."],
  ["claude-fable-2026-08-11-009-token-accounting", "Accepted as the named deterministic utf8-bytes-div-4-v1 heuristic at file, manifest, and complete-packet levels."],
  ["claude-fable-2026-08-11-010-mixed-fidelity-file-projections", "Accepted as explicit exact, numbered, signatures, outline, reference, and alias projections."],
  ["claude-fable-2026-08-11-012-verification-cli", "Accepted as mktxt verify with human and JSON reports over strict MKTCTX/4 verification."],
  ["claude-fable-2026-08-11-013-spec-extension-and-media-type", "Accepted as a normative v4 specification and preferred .mktctx extension; text/x-mktctx is documented only as provisional and unregistered."],
  ["grok-2026-08-11-008-name-and-subtitle", "Accepted and completed by retaining MKTCTX and using the domain-neutral subtitle 'a verifiable, budget-aware source-context packet'; lossless, witnessed, and source-truth claims remain avoided."],
  ["chatgpt-2026-08-11-002-lossless-terminology-and-coverage-counts", "Accepted and completed in MKTCTX/5: representation, projection profile, selection scope, and completeness are orthogonal; normalized requested, included, omitted, alias, and explicitly unknown repository cardinalities are verified."],
  ["chatgpt-2026-08-11-008-packet-versioned-citations", "Accepted and completed in MKTCTX/5: packet-local, packet-qualified, and full-content-qualified line and symbol citations have normative parsing, resolution, alias, rename, collision, and validation behavior."],
  ["kimi-k3-2026-08-11-006-symbol-id-width-grammar", "Accepted and completed in MKTCTX/5: symbol ordinals are canonical minimum-three-digit unbounded decimals, explicitly packet-local to analyzer traversal, with S999/S1000 parent, citation, verifier, sidecar, and generated-fixture coverage."],
  ["grok-2026-08-11-003-selection-reproducibility", "Accepted and completed in MKTCTX/5: normalized caller requests, canonical selection policy, resolved candidates, and outcomes are distinct; replay posture and request SHA-256 use privacy-aware portable paths without shell commands or task text."],
  ["chatgpt-2026-08-11-003-configurable-missing-file-failure", "Accepted and completed in MKTCTX/5: --missing=error|record governs output and exit behavior, stable structured diagnostics cover every omission class, and verification reports integrity, completeness, and policy compliance separately."],
  ["grok-2026-08-11-009-companion-explainer-draft", "Accepted and completed as docs/explain.md: it embeds and verifies the production-generated MKTCTX/5 fixture, accurately explains integrity and Git-bundle boundaries from primary sources, renders every Mermaid figure, and preserves the separate legacy draft."],
]);

const acceptedInProgress = new Map([]);

const acceptedPlanned = new Map([
]);

const deferred = new Map([
  ["chatgpt-2026-08-11-006-retrieval-roles-and-derived-artifacts", "Deferred pending a corpus-derived role vocabulary and retrieval evidence. Incorrect generated or low-priority labels can hide authoritative evidence; derivation must come from explicit build or manifest provenance, not filename heuristics."],
  ["grok-2026-08-11-001-human-facing-summary", "Deferred until role metadata and cold-open tests show a deterministic summary improves navigation enough to justify duplicated packet tokens. Narrative summaries remain outside the authoritative core."],
  ["grok-2026-08-11-002-adaptive-and-streaming-chunking", "Deferred pending giant-line, memory, latency, and citation benchmarks. Reopen when a hard byte cap or streaming renderer solves a measured failure rather than adding policy complexity speculatively."],
  ["grok-2026-08-11-004-outline-fallbacks", "Deferred pending an unsupported-language census and gold range tests. Fallback analysis belongs in a provenance-bearing analyzer layer such as graft, not as unlabeled regex guesses in mktxt."],
  ["kimi-k3-2026-08-11-008-symbol-aware-chunk-boundaries", "Deferred as an experiment. Benchmark deterministic fixed, boundary-snapped, and symbol-primary partitions before changing exact packet bytes or coupling source transport to analyzer churn."],
  ["kimi-k3-2026-08-11-010-signed-packet-attestations", "Deferred until a concrete local, CI, or release attestation claim and trust model exists. If reopened, use a detached statement over the normative packet identity rather than changing deterministic packet bytes."],
  ["claude-fable-2026-08-11-011-per-chunk-digests", "Deferred until independent partial retrieval, caching, or retransmission exists. Whole-file plus envelope integrity is sufficient today; repeated high-entropy hashes are unjustified without a consumer."],
  ["claude-fable-2026-08-11-014-task-scoped-context-receipts", "Deferred as a separate evidence artifact. Reopen only with a threat model for what an agent-run receipt can truthfully prove, plus privacy and redaction rules for tasks and outputs."],
]);

const rejected = new Map([
  ["gemini-2026-08-11-003-write-protocol", "Rejected from mktxt's product boundary. MKTCTX packages read context; mature unified-diff and filesystem tools should continue to carry mutations, guarded by exact source hashes where useful. A custom application language would add authority and conflict semantics without demonstrated need."],
  ["grok-2026-08-11-005-compression-and-delta-encoding", "Rejected as a core MKTCTX feature. Standard transport compression, Git bundles, and content-addressed stores already solve wire and storage reuse; external body references would weaken the packet's standalone model-readable property."],
  ["grok-2026-08-11-006-packet-profile-declaration", "Rejected as a second capability-negotiation layer. MKTCTX/4 protocol magic, named projection profiles, section statuses, and per-file projections already state the testable guarantees; another profile version would duplicate and risk drifting from them."],
  ["kimi-k3-2026-08-11-009-causal-packet-chains", "Rejected from the core format. Parent chains duplicate Git and CAS history, weaken standalone portability, and make absence, deletion, and garbage collection substantially harder. Compare standalone packets by their existing identities instead."],
  ["claude-fable-2026-08-11-006-dual-path-and-content-identities", "Rejected as redundant wire syntax. MKTCTX already keeps path-derived file IDs separate from full source SHA-256 identities, while Git change records supply rename evidence. Citation design should use those existing identities rather than add C-prefixed aliases."],
  ["claude-fable-2026-08-11-007-random-access-offsets", "Rejected absent a measured seek bottleneck. A consumer can build an offset map during one strict parse; in-band offsets add model-irrelevant entropy and serialization feedback, while a future tool-owned sidecar needs no core protocol change."],
]);

const superseded = new Map([
  ["gemini-2026-08-11-001-delimiter-collision-risk", "Superseded by the accepted normative byte-framing, formal-grammar, and model-visible-boundary proposals implemented in MKTCTX/4. No additional visual delimiter is warranted without contrary model-evaluation evidence."],
  ["grok-2026-08-11-007-companion-lossy-view", "Superseded by MKTCTX/4's explicit review and structure profiles plus signatures, outline, and reference projections. A separate lossy protocol would duplicate those auditable loss semantics."],
  ["claude-fable-2026-08-11-003-symbol-aware-rag-chunks", "Superseded by the narrower symbol-boundary experiment. Do not add external retrieval-unit identities until boundary quality, stability, and partial-retrieval workflows are demonstrated."],
  ["claude-fable-2026-08-11-008-delta-packets", "Superseded by the broader causal-chain and differential-transport proposals, which were rejected for the core format. Iterative sessions should exchange standalone packets or use external Git/CAS transport."],
]);

const decisionMaps = [acceptedComplete, acceptedInProgress, acceptedPlanned, deferred, rejected, superseded];
const allDecisions = new Map(decisionMaps.flatMap((entries) => [...entries]));

function stateFor(id) {
  const rationale = allDecisions.get(id);
  if (rationale === undefined) throw new Error(`No adjudication decision for ${id}`);
  if (acceptedComplete.has(id)) return { lifecycle: "adjudicated", decision: "accepted", implementation: "complete", rationale };
  if (acceptedInProgress.has(id)) return { lifecycle: "adjudicated", decision: "accepted", implementation: "in-progress", rationale };
  if (acceptedPlanned.has(id)) return { lifecycle: "adjudicated", decision: "accepted", implementation: "planned", rationale };
  if (deferred.has(id)) return { lifecycle: "adjudicated", decision: "deferred", implementation: "not-started", rationale };
  if (rejected.has(id)) return { lifecycle: "adjudicated", decision: "rejected", implementation: "not-applicable", rationale };
  return { lifecycle: "superseded", decision: "superseded", implementation: "not-applicable", rationale };
}

async function writeJson(filePath, value) {
  const next = `${JSON.stringify(value, null, 2)}\n`;
  if (checkOnly) {
    const current = await fs.readFile(filePath, "utf8");
    if (current !== next) throw new Error(`Feedback adjudication is stale: ${path.relative(root, filePath)}`);
    return;
  }
  await fs.writeFile(filePath, next);
}

function countsFor(decisions) {
  const count = (decision) => decisions.filter((value) => value === decision).length;
  return {
    accepted_count: count("accepted"),
    rejected_count: count("rejected"),
    deferred_count: count("deferred"),
    superseded_count: count("superseded"),
    pending_count: count("pending"),
  };
}

const catalog = JSON.parse(await fs.readFile(catalogPath, "utf8"));
const encountered = new Set();
const catalogDecisions = [];
for (const collection of catalog.collections) {
  const collectionPath = path.join(path.dirname(catalogPath), collection.path);
  const index = JSON.parse(await fs.readFile(collectionPath, "utf8"));
  for (const record of index.items) {
    if (encountered.has(record.id)) throw new Error(`Duplicate feedback ID: ${record.id}`);
    encountered.add(record.id);
    const decision = stateFor(record.id);
    const itemPath = path.join(path.dirname(collectionPath), record.path);
    const item = JSON.parse(await fs.readFile(itemPath, "utf8"));
    if (item.id !== record.id) throw new Error(`Index ID mismatch for ${itemPath}`);
    item.state = {
      lifecycle: decision.lifecycle,
      decision: decision.decision,
      implementation: decision.implementation,
      decided_on: "2026-08-12",
      decided_by: "James and Codex",
      decision_rationale: decision.rationale,
    };
    record.decision = decision.decision;
    catalogDecisions.push(decision.decision);
    await writeJson(itemPath, item);
  }
  const counts = countsFor(index.items.map((record) => record.decision));
  index.adjudication = {
    ...index.adjudication,
    status: counts.pending_count === 0 ? "complete" : "in-progress",
    ...counts,
  };
  Object.assign(collection, counts);
  await writeJson(collectionPath, index);
}

if (encountered.size !== allDecisions.size) {
  const unused = [...allDecisions.keys()].filter((id) => !encountered.has(id));
  throw new Error(`Decision catalog mismatch: ${encountered.size} items, ${allDecisions.size} decisions; unused=${unused.join(",")}`);
}

const catalogCounts = countsFor(catalogDecisions);
catalog.adjudication = {
  ...catalog.adjudication,
  status: catalogCounts.pending_count === 0 ? "complete" : "in-progress",
  ...catalogCounts,
  policy: "Every proposal has an independent durable decision. Accepted work follows format-versioning rules; deferred work names an evidence trigger; rejected work may be reopened only with new evidence or a changed product boundary.",
};
await writeJson(catalogPath, catalog);

console.log(`${checkOnly ? "Verified" : "Adjudicated"} ${encountered.size} proposals: ` +
  `${catalogCounts.accepted_count} accepted, ${catalogCounts.deferred_count} deferred, ` +
  `${catalogCounts.rejected_count} rejected, ${catalogCounts.superseded_count} superseded, ` +
  `${catalogCounts.pending_count} pending`);
