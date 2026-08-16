#!/usr/bin/env node
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const feedbackRoot = path.join(root, "docs/feedback/mktctx");
const markdownPath = path.join(feedbackRoot, "ACCEPTED-USER-STORIES.md");
const dotPath = path.join(feedbackRoot, "accepted-feedback-dag.dot");
const svgPath = path.join(feedbackRoot, "accepted-feedback-dag.svg");
const checkOnly = process.argv.includes("--check");

const stories = [
  {
    key: "US-01",
    feedbackId: "chatgpt-2026-08-11-004-formal-grammar-and-collision-rules",
    title: "Publish a normative grammar and edge-case rules",
    area: "Foundations",
    role: "independent parser implementer",
    want: "a normative lexical, framing, escaping, identifier, and failure grammar",
    benefit: "I can implement MKTCTX without reverse-engineering one generator",
    acceptance: [
      "The specification defines every control record, attribute encoding, payload boundary, identifier grammar, and terminal condition.",
      "Malformed lengths, terms, quoting, identifiers, ordering, and unsupported protocol versions have deterministic failure behavior.",
      "Conformance fixtures include directive-looking source, delimiter collisions, unusual paths, and malformed packets.",
    ],
    blockedBy: [],
  },
  {
    key: "US-02",
    feedbackId: "kimi-k3-2026-08-11-002-encoding-and-normalization",
    title: "Specify encoding, BOM, newline, and byte-count semantics",
    area: "Foundations",
    role: "source producer or verifier",
    want: "one exact definition of source encoding, BOM, newline, line-count, byte-count, and digest behavior",
    benefit: "exact projections reconstruct and hash the same bytes on every conforming implementation",
    acceptance: [
      "Exact source is defined as original valid UTF-8 bytes, with BOM and LF, CRLF, or CR sequences preserved.",
      "Invalid UTF-8 and binary inputs are rejected or omitted with an explicit reason rather than normalized silently.",
      "Line counts, byte counts, and SHA-256 preimages are specified and covered by round-trip fixtures.",
    ],
    blockedBy: ["US-01"],
  },
  {
    key: "US-03",
    feedbackId: "kimi-k3-2026-08-11-001-length-prefixed-framing",
    title: "Make byte-length framing normative and directive-safe",
    area: "Foundations",
    role: "streaming packet parser",
    want: "authoritative byte-length payload framing with secondary terminator checks",
    benefit: "arbitrary source bytes cannot impersonate outer packet directives",
    acceptance: [
      "A parser consumes exactly the declared payload bytes before interpreting subsequent control syntax.",
      "Directive-looking lines and nested MKTCTX packets inside a payload remain inert source data.",
      "Separator, missing-term, mismatched-term, and incorrect-length behavior is normative and adversarially tested.",
    ],
    blockedBy: ["US-02"],
  },
  {
    key: "US-04",
    feedbackId: "kimi-k3-2026-08-11-005-deterministic-canonical-serialization",
    title: "Specify deterministic canonical packet serialization",
    area: "Foundations",
    role: "packet producer or cache operator",
    want: "a canonical input model and serialization procedure",
    benefit: "identical semantic inputs yield reproducible identities and deterministic packet bytes",
    acceptance: [
      "Canonical JSON key ordering, omission rules, array ordering, number encoding, and UTF-8 preimage are normative.",
      "Packet ordering and generator-controlled defaults are deterministic and contain no incidental timestamps.",
      "Cross-run test vectors reproduce the same manifest hash, packet ID, and rendered packet bytes.",
    ],
    blockedBy: ["US-02"],
  },
  {
    key: "US-05",
    feedbackId: "chatgpt-2026-08-11-001-git-provenance-and-diff-semantics",
    title: "Add Git provenance and per-file change semantics",
    area: "Provenance and selection",
    role: "code reviewer",
    want: "optional Git base, head, branch, dirty-state, and typed file-change provenance",
    benefit: "I can distinguish reviewed changes from pre-existing repository state",
    acceptance: [
      "The packet records the requested base ref, resolved base commit, HEAD, branch or detached state, and working-tree posture.",
      "Added, modified, deleted, renamed, copied, type-changed, and unmerged paths are represented distinctly.",
      "Base blob hashes and rename evidence are included when available, while deleted paths are not misreported as failed reads.",
    ],
    blockedBy: ["US-01"],
  },
  {
    key: "US-06",
    feedbackId: "chatgpt-2026-08-11-002-lossless-terminology-and-coverage-counts",
    title: "Clarify exact representation versus incomplete scope",
    area: "Provenance and selection",
    role: "packet consumer",
    want: "orthogonal representation, selection-scope, and coverage terminology with explicit cardinalities",
    benefit: "I never mistake exact included files for a complete repository snapshot",
    acceptance: [
      "Representation fidelity, projection profile, selection scope, and repository completeness are separate fields.",
      "Normalized requested, included, omitted, and repository-total cardinalities have unambiguous alias and duplicate rules.",
      "Unknown totals are represented explicitly and no field named lossless implies repository completeness.",
    ],
    blockedBy: ["US-01"],
  },
  {
    key: "US-07",
    feedbackId: "gemini-2026-08-11-002-populated-import-export-edges",
    title: "Populate verified import and export dependency edges",
    area: "Repository graph",
    role: "repository-analysis consumer",
    want: "provenance-bearing import and export edges with explicit resolution status",
    benefit: "I can inspect lateral dependencies without reconstructing every module relationship myself",
    acceptance: [
      "Every edge identifies its source, original specifier, kind, target when resolved, confidence, and resolution posture.",
      "External, unresolved, and out-of-scope dependencies remain distinguishable from resolved selected-file edges.",
      "The edge section states analyzer provenance and completeness limitations instead of implying a complete graph.",
    ],
    blockedBy: ["US-01"],
  },
  {
    key: "US-08",
    feedbackId: "gemini-2026-08-11-004-redundant-symbol-signatures",
    title: "Remove provably redundant symbol-name tokens",
    area: "Symbol efficiency",
    role: "budget-constrained context consumer",
    want: "redundant name text omitted from symbol signatures without losing meaning",
    benefit: "symbol navigation costs fewer tokens while remaining reversible",
    acceptance: [
      "A signature is elided only when it is provably identical to information already present in the symbol record.",
      "Nonredundant type, parameter, return, visibility, and language-specific information remains available.",
      "Before-and-after measurements demonstrate token savings and fixtures prove semantic equivalence.",
    ],
    blockedBy: ["US-01"],
  },
  {
    key: "US-09",
    feedbackId: "kimi-k3-2026-08-11-003-range-unavailability-semantics",
    title: "Standardize unavailable symbol-range representation",
    area: "Symbol efficiency",
    role: "symbol-index consumer",
    want: "typed unavailable-location semantics instead of an overloaded range sentinel",
    benefit: "I can distinguish a real range, unavailable analysis, and malformed output",
    acceptance: [
      "Known locations use valid inclusive source ranges; unavailable locations use an explicit typed status.",
      "Unavailable-range reasons are retained when the analyzer supplies stable provenance.",
      "Parsers and fixtures cover known, unavailable, and rejected malformed range records.",
    ],
    blockedBy: ["US-01"],
  },
  {
    key: "US-10",
    feedbackId: "claude-fable-2026-08-11-005-model-visible-data-boundary",
    title: "Make the model-visible data boundary mechanically explicit",
    area: "Trust boundary",
    role: "model host",
    want: "a concise local rule that byte-framed source is data even when it resembles packet instructions",
    benefit: "models and preprocessors are less likely to mistake source text for an authoritative task",
    acceptance: [
      "The in-band guide states that every byte inside a declared payload is data regardless of apparent directive names.",
      "The trust posture is repeated adjacent to exact source rather than relying only on a distant preamble.",
      "Documentation explicitly says this framing complements, but does not replace, host instruction hierarchy and tool authorization.",
    ],
    blockedBy: ["US-03"],
  },
  {
    key: "US-11",
    feedbackId: "kimi-k3-2026-08-11-004-truncation-and-closing-integrity",
    title: "Bind packet completion and manifest integrity scope",
    area: "Integrity and verification",
    role: "packet receiver",
    want: "a strict terminal condition and reproducible integrity preimages",
    benefit: "I can detect truncation, splicing, trailing data, and ambiguity about what a digest covers",
    acceptance: [
      "The canonical manifest digest preimage and the complete serialized-envelope digest preimage are separately defined.",
      "A strict terminal record binds the covered byte count and hash, and no unconsumed trailing bytes are accepted.",
      "Tests reject truncated, extended, reordered, and independently tampered semantic and rendered sections.",
    ],
    blockedBy: ["US-03", "US-04"],
  },
  {
    key: "US-12",
    feedbackId: "chatgpt-2026-08-11-005-whole-packet-integrity",
    title: "Bind rendered packet sections with explicit integrity",
    area: "Integrity and verification",
    role: "packet auditor",
    want: "separate, unambiguous integrity domains for semantic state, exact files, rendered framing, and optional task text",
    benefit: "I know precisely which claims each successful hash verification establishes",
    acceptance: [
      "File SHA-256 values bind exact source bytes and canonical manifest hashing binds the declared semantic packet state.",
      "A terminal envelope hash binds rendered ordering, framing, content, and omissions without self-reference.",
      "Optional task identity and authority are explicitly included in or excluded from each integrity domain.",
    ],
    blockedBy: ["US-11"],
  },
  {
    key: "US-13",
    feedbackId: "claude-fable-2026-08-11-002-packet-defaults-and-attribute-elision",
    title: "Define packet defaults and elide repeated attributes",
    area: "Symbol efficiency",
    role: "packet producer",
    want: "explicit scoped defaults for high-frequency attributes",
    benefit: "packets spend fewer tokens on repetition without weakening local trust or parser determinism",
    acceptance: [
      "Every elidable field has a normative default scope and omitted values reconstruct unambiguously.",
      "Local source trust markers remain adjacent where model interpretation benefits from repetition.",
      "Canonicalization and verification operate on reconstructed semantic values rather than accidental object insertion order.",
    ],
    blockedBy: ["US-04", "US-08", "US-10"],
  },
  {
    key: "US-14",
    feedbackId: "kimi-k3-2026-08-11-007-populated-dependency-edges",
    title: "Populate dependency and symbol-reference edges",
    area: "Repository graph",
    role: "review or retrieval engine",
    want: "a staged dependency graph that resolves selected-file relationships while retaining uncertainty",
    benefit: "I can traverse an honest repository neighborhood for impact analysis and selection",
    acceptance: [
      "The first supported languages and edge kinds have deterministic extraction and selected-file resolution rules.",
      "Resolution incorporates packet path identity and relevant VCS path-change semantics without inferring unsupported causality.",
      "Tests cover resolved, external, unresolved, renamed, and out-of-scope targets.",
    ],
    blockedBy: ["US-05", "US-07"],
  },
  {
    key: "US-15",
    feedbackId: "chatgpt-2026-08-11-007-context-budget-profiles",
    title: "Define versioned context-budget profiles",
    area: "Projection and budgeting",
    role: "context assembler",
    want: "named, deterministic selection and projection policies with an explicit loss audit trail",
    benefit: "I can fit context to a budget without confusing omitted or summarized material with exact source",
    acceptance: [
      "Each profile specifies selection seeds, fidelity rules, degradation order, omission behavior, and estimator posture.",
      "Every non-exact or omitted file has an explicit projection or omission reason.",
      "Required evidence may exceed a requested budget only with an explicit exceeded posture rather than silent truncation.",
    ],
    blockedBy: ["US-06", "US-14"],
  },
  {
    key: "US-16",
    feedbackId: "kimi-k3-2026-08-11-011-projection-tier-ladder",
    title: "Define a projection capability and budget ladder",
    area: "Projection and budgeting",
    role: "profile author or consumer",
    want: "one ordered vocabulary for exact, derived, structural, reference, and alias representations",
    benefit: "every file's available evidence and loss posture is mechanically understandable",
    acceptance: [
      "Projection kinds have nonoverlapping normative meanings and identify which source claims remain verifiable.",
      "The ladder defines deterministic degradation choices without presenting summaries or references as exact source.",
      "Packet-level profiles and per-file projections remain independently inspectable and testable.",
    ],
    blockedBy: ["US-15"],
  },
  {
    key: "US-17",
    feedbackId: "claude-fable-2026-08-11-010-mixed-fidelity-file-projections",
    title: "Support mixed-fidelity per-file projections",
    area: "Projection and budgeting",
    role: "context assembler",
    want: "different explicit projection levels for different files in one packet",
    benefit: "high-value evidence remains exact while lower-priority context remains navigable within budget",
    acceptance: [
      "A packet may combine exact, numbered, signatures, outline, reference, and alias files under one manifest.",
      "Each projection carries a reason and retains the original source identity even when the body is absent or derived.",
      "Verification reports exact and non-exact projections separately and never hashes derived text as original source.",
    ],
    blockedBy: ["US-16"],
  },
  {
    key: "US-18",
    feedbackId: "claude-fable-2026-08-11-009-token-accounting",
    title: "Declare context-cost estimates",
    area: "Projection and budgeting",
    role: "context-budget planner",
    want: "explicitly scoped cost estimates at file, section, and packet levels",
    benefit: "I can apply and audit budgets without mistaking a heuristic for universal tokenizer truth",
    acceptance: [
      "Every estimate names its algorithm or tokenizer, version when applicable, exact byte preimage, and rounding rule.",
      "A stable cheap estimator is available when tokenizer-specific accounting is not requested.",
      "Packet totals, per-file estimates, requested budgets, and exceeded posture reconcile deterministically.",
    ],
    blockedBy: ["US-16"],
  },
  {
    key: "US-19",
    feedbackId: "claude-fable-2026-08-11-004-edge-ranked-selection",
    title: "Use dependency edges for ranked mixed-fidelity selection",
    area: "Projection and budgeting",
    role: "review agent",
    want: "a reproducible graph-distance policy from changed or declared seed files",
    benefit: "the most causally relevant neighborhood receives the highest fidelity under budget",
    acceptance: [
      "Seed definition, edge eligibility, traversal direction, distance, tie-breaking, and projection mapping are deterministic.",
      "Changed files and required evidence remain exact according to policy, while farther files degrade through declared tiers.",
      "Unresolved or unavailable edges reduce completeness honestly and never fabricate relevance.",
    ],
    blockedBy: ["US-17", "US-18"],
  },
  {
    key: "US-20",
    feedbackId: "claude-fable-2026-08-11-001-symbol-outline-budget-policy",
    title: "Control symbol-outline cost by language, depth, and location",
    area: "Symbol efficiency",
    role: "model context consumer",
    want: "configurable symbol projections that retain useful navigation per token",
    benefit: "large structured files do not drown code-relevant symbols in repetitive outline metadata",
    acceptance: [
      "Useful, full, and none policies have language-aware location, kind, export, and depth rules.",
      "Every outline reports analyzer total, emitted count, policy, and availability posture.",
      "Measurements compare token cost and navigation coverage, and unlocated records are never emitted as citable ranges.",
    ],
    blockedBy: ["US-09", "US-13", "US-16"],
  },
  {
    key: "US-21",
    feedbackId: "grok-2026-08-11-003-selection-reproducibility",
    title: "Embed reproducible selection policy and request identity",
    area: "Provenance and selection",
    role: "packet auditor or reproducer",
    want: "the normalized selection request and policy recorded separately from its outcome",
    benefit: "I can explain and, where possible, replay why this working set was chosen",
    acceptance: [
      "The packet distinguishes caller request, normalized policy, resolved candidates, included files, and omissions.",
      "A reproducibility posture states whether the request is exactly replayable, policy-replayable, or descriptive only.",
      "Canonicalization and redaction rules avoid leaking incidental absolute paths, shell commands, or sensitive task text.",
    ],
    blockedBy: ["US-04", "US-19"],
  },
  {
    key: "US-22",
    feedbackId: "chatgpt-2026-08-11-003-configurable-missing-file-failure",
    title: "Make missing-file policy explicit and configurable",
    area: "Provenance and selection",
    role: "CI or review operator",
    want: "structured diagnostics and caller-selected omission policy",
    benefit: "archival, interactive, and CI workflows can react differently without conflating packet integrity with policy compliance",
    acceptance: [
      "Stable diagnostic records include severity, code, path, reason, and optional detail for each selection failure.",
      "Strict and record-and-continue policies define output and process-exit behavior for missing, directory, binary, invalid-UTF-8, and excluded paths.",
      "Structural validity, integrity verification, selection completeness, and workflow policy compliance remain separate dimensions.",
    ],
    blockedBy: ["US-21"],
  },
  {
    key: "US-23",
    feedbackId: "kimi-k3-2026-08-11-012-consumer-verification-procedure",
    title: "Publish a normative consumer verification procedure",
    area: "Integrity and verification",
    role: "consumer implementer",
    want: "ordered verification levels and reference test vectors",
    benefit: "I can state exactly which structural, content, manifest, completion, and authenticity checks succeeded",
    acceptance: [
      "The procedure orders UTF-8, terminal envelope, packet identity, manifest, index, payload, exact-file, alias, and task checks.",
      "Each level defines its evidence, failure result, and what successful verification does not prove.",
      "Positive and negative test vectors are executable without access to the original repository.",
    ],
    blockedBy: ["US-12"],
  },
  {
    key: "US-24",
    feedbackId: "claude-fable-2026-08-11-012-verification-cli",
    title: "Ship a packet verification CLI",
    area: "Integrity and verification",
    role: "packet operator",
    want: "a reference command that executes normative verification and reports machine-readable results",
    benefit: "I can gate packet ingestion and diagnose integrity failures without writing a parser first",
    acceptance: [
      "The CLI accepts a file or stdin, returns nonzero on verification failure, and emits concise human output.",
      "JSON output identifies the protocol, packet and manifest identities, verified file classes, checks, and exact failure.",
      "The installed hermetic command verifies the generated conformance fixtures independently of the source checkout.",
    ],
    blockedBy: ["US-23"],
  },
  {
    key: "US-25",
    feedbackId: "claude-fable-2026-08-11-013-spec-extension-and-media-type",
    title: "Publish specification and interoperability identifiers",
    area: "Integrity and verification",
    role: "tool integrator",
    want: "a concise normative specification, conformance fixtures, file extension, and accurately labeled media type",
    benefit: "independent tools can recognize and exchange packets without overstated registration claims",
    acceptance: [
      "The specification links every normative grammar, exactness, canonicalization, projection, and verification rule to test vectors.",
      "The preferred extension is documented and generated fixtures use it where compatibility permits.",
      "Any media type is explicitly described as provisional and unregistered until a real registration exists.",
    ],
    blockedBy: ["US-23"],
  },
  {
    key: "US-26",
    feedbackId: "chatgpt-2026-08-11-008-packet-versioned-citations",
    title: "Make durable citations packet- or content-specific",
    area: "Communication and citations",
    role: "reviewer or auditor",
    want: "packet-local, packet-qualified, and content-qualified citation forms with normative resolution",
    benefit: "a cited line or symbol cannot silently resolve to different bytes in another packet",
    acceptance: [
      "The grammar distinguishes path-resource identity, packet identity, exact content identity, symbol identity, and line range.",
      "Resolution specifies alias behavior, digest-prefix uniqueness or full-digest use, renamed paths, and validation errors.",
      "Fixtures cover repackaging, content edits, aliases, renames, ambiguous prefixes, and invalid ranges.",
    ],
    blockedBy: ["US-12"],
  },
  {
    key: "US-27",
    feedbackId: "kimi-k3-2026-08-11-006-symbol-id-width-grammar",
    title: "Define symbol-ID width and stability grammar",
    area: "Communication and citations",
    role: "citation parser implementer",
    want: "an unbounded symbol-ordinal grammar with an explicit stability scope",
    benefit: "files with more than 999 symbols remain addressable without implying false cross-packet durability",
    acceptance: [
      "Symbol ordinals are defined as minimum-three-digit, unbounded decimal values, including S999 and S1000.",
      "The specification states that ordinals are packet-local to analyzer traversal and may change after edits or analyzer changes.",
      "Fixtures exercise large ordinals in symbols, parents, citations, and any applicable sidecars.",
    ],
    blockedBy: ["US-26"],
  },
  {
    key: "US-28",
    feedbackId: "grok-2026-08-11-008-name-and-subtitle",
    title: "Retain MKTCTX with a precise descriptive subtitle",
    area: "Communication and citations",
    role: "newcomer evaluating the format",
    want: "a stable technical name and domain-neutral subtitle that matches the actual guarantees",
    benefit: "I understand the artifact without being misled about repository completeness, signatures, or truth authority",
    acceptance: [
      "MKTCTX remains the protocol and technical name unless an overwhelming compatibility reason requires change.",
      "The subtitle describes verifiability and source context without claiming complete, witnessed, signed, or source-truth status.",
      "Documentation uses the chosen terminology consistently across the specification, README, examples, and package metadata.",
    ],
    blockedBy: ["US-06", "US-12"],
  },
  {
    key: "US-29",
    feedbackId: "grok-2026-08-11-009-companion-explainer-draft",
    title: "Publish a verified progressive MKTCTX explainer",
    area: "Communication and citations",
    role: "reader with no prior MKTCTX knowledge",
    want: "one production-generated example traced through selection, structure, integrity, verification, and Git comparison",
    benefit: "I can understand and independently check the format without learning from an illustrative but invalid packet",
    acceptance: [
      "The canonical running example is generated by the production renderer and all IDs, lengths, hashes, blocks, and coverage claims verify.",
      "Integrity, layered-consumption, and Git-bundle comparisons are accurate, scoped, and supported by primary documentation where needed.",
      "All diagrams render successfully, the document distinguishes authored content from generated artifacts, and duplicate drafts are preserved until disposition is authorized.",
    ],
    blockedBy: ["US-20", "US-22", "US-24", "US-25", "US-27", "US-28"],
  },
];

const statusStyle = {
  complete: { fill: "#DCFCE7", border: "#15803D", label: "complete" },
  "in-progress": { fill: "#FEF3C7", border: "#B45309", label: "in progress" },
  planned: { fill: "#DBEAFE", border: "#1D4ED8", label: "planned" },
};

const areaStyle = new Map([
  ["Foundations", "#64748B"],
  ["Provenance and selection", "#7C3AED"],
  ["Repository graph", "#0891B2"],
  ["Symbol efficiency", "#C2410C"],
  ["Trust boundary", "#BE123C"],
  ["Integrity and verification", "#047857"],
  ["Projection and budgeting", "#2563EB"],
  ["Communication and citations", "#9333EA"],
]);

function escapeMarkdown(value) {
  return value.replaceAll("|", "\\|");
}

function escapeDot(value) {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\n");
}

function indefiniteArticle(value) {
  return /^[aeiou]/i.test(value) ? "an" : "a";
}

function wrap(value, width = 28) {
  const words = value.split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    if (line.length > 0 && line.length + word.length + 1 > width) {
      lines.push(line);
      line = word;
    } else {
      line = line.length === 0 ? word : `${line} ${word}`;
    }
  }
  if (line.length > 0) lines.push(line);
  return lines.join("\n");
}

async function loadAcceptedItems() {
  const catalog = JSON.parse(await fs.readFile(path.join(feedbackRoot, "index.json"), "utf8"));
  const result = new Map();
  for (const collection of catalog.collections) {
    const indexPath = path.join(feedbackRoot, collection.path);
    const index = JSON.parse(await fs.readFile(indexPath, "utf8"));
    for (const record of index.items) {
      if (record.decision !== "accepted") continue;
      const itemPath = path.join(path.dirname(indexPath), record.path);
      const item = JSON.parse(await fs.readFile(itemPath, "utf8"));
      result.set(item.id, {
        item,
        relativePath: path.relative(feedbackRoot, itemPath),
      });
    }
  }
  return result;
}

function validateAndOrder(accepted) {
  const byKey = new Map();
  const byFeedback = new Map();
  for (const story of stories) {
    if (byKey.has(story.key)) throw new Error(`Duplicate user-story key ${story.key}`);
    if (byFeedback.has(story.feedbackId)) throw new Error(`Duplicate feedback mapping ${story.feedbackId}`);
    if (!accepted.has(story.feedbackId)) throw new Error(`${story.key} maps to non-accepted or missing ${story.feedbackId}`);
    if (story.acceptance.length !== 3) throw new Error(`${story.key} must have exactly three acceptance criteria`);
    byKey.set(story.key, story);
    byFeedback.set(story.feedbackId, story);
  }
  if (accepted.size !== stories.length) {
    const missing = [...accepted.keys()].filter((id) => !byFeedback.has(id));
    throw new Error(`Expected ${accepted.size} accepted items but modeled ${stories.length}; missing=${missing.join(",")}`);
  }

  const indegree = new Map(stories.map((story) => [story.key, 0]));
  const blocks = new Map(stories.map((story) => [story.key, []]));
  let edgeCount = 0;
  for (const story of stories) {
    for (const blocker of story.blockedBy) {
      if (!byKey.has(blocker)) throw new Error(`${story.key} has unknown blocker ${blocker}`);
      if (blocker === story.key) throw new Error(`${story.key} blocks itself`);
      indegree.set(story.key, indegree.get(story.key) + 1);
      blocks.get(blocker).push(story.key);
      edgeCount++;
    }
  }

  const queue = stories.filter((story) => indegree.get(story.key) === 0).map((story) => story.key).sort();
  const ordered = [];
  while (queue.length > 0) {
    const key = queue.shift();
    ordered.push(key);
    for (const blocked of blocks.get(key).toSorted()) {
      indegree.set(blocked, indegree.get(blocked) - 1);
      if (indegree.get(blocked) === 0) {
        queue.push(blocked);
        queue.sort();
      }
    }
  }
  if (ordered.length !== stories.length) {
    const cyclic = stories.filter((story) => !ordered.includes(story.key)).map((story) => story.key);
    throw new Error(`Feedback dependency graph contains a cycle: ${cyclic.join(",")}`);
  }
  for (const story of stories) {
    if (stories.length > 1 && story.blockedBy.length === 0 && blocks.get(story.key).length === 0) {
      throw new Error(`Isolated user story ${story.key}`);
    }
  }
  const roots = stories.filter((story) => story.blockedBy.length === 0).map((story) => story.key);
  const sinks = stories.filter((story) => blocks.get(story.key).length === 0).map((story) => story.key);
  if (roots.length !== 1 || roots[0] !== "US-01") throw new Error(`Expected US-01 as the unique root; found ${roots.join(",")}`);
  if (sinks.length !== 1 || sinks[0] !== "US-29") throw new Error(`Expected US-29 as the unique sink; found ${sinks.join(",")}`);

  for (const story of stories) {
    for (const blocker of story.blockedBy) {
      const pending = blocks.get(blocker).filter((key) => key !== story.key);
      const visited = new Set();
      while (pending.length > 0) {
        const key = pending.pop();
        if (key === story.key) {
          throw new Error(`Redundant blocking edge ${blocker} -> ${story.key}; another path already establishes it`);
        }
        if (visited.has(key)) continue;
        visited.add(key);
        pending.push(...blocks.get(key));
      }
    }
  }

  const levels = new Map();
  for (const key of ordered) {
    const story = byKey.get(key);
    levels.set(key, story.blockedBy.length === 0
      ? 0
      : Math.max(...story.blockedBy.map((blocker) => levels.get(blocker))) + 1);
  }
  return { byKey, blocks, ordered, levels, edgeCount };
}

function renderMarkdown(accepted, graph) {
  const counts = new Map();
  for (const story of stories) {
    const status = accepted.get(story.feedbackId).item.state.implementation;
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  const lines = [
    "# Accepted MKTCTX feedback as user stories",
    "",
    "This document formally restates every accepted external-feedback item as a",
    "user story with testable acceptance criteria and an explicit dependency",
    "contract. It is generated by `scripts/generate-feedback-user-stories.mjs`",
    "from the adjudicated feedback catalog plus the maintained story model.",
    "",
    "The rendered dependency graph is",
    "[`accepted-feedback-dag.svg`](accepted-feedback-dag.svg); its Graphviz source",
    "is [`accepted-feedback-dag.dot`](accepted-feedback-dag.dot). Graphviz `dot`",
    "uses a Sugiyama-style hierarchical layout: cycle validation, ranking into",
    "layers, crossing reduction, and coordinate assignment.",
    "",
    "## Formal dependency semantics",
    "",
    "For a directed edge `A -> B`:",
    "",
    "- **A blocks B**: B's acceptance criteria cannot be satisfied truthfully",
    "  until A's normative contract exists.",
    "- **B is blocked by A**: B may be researched or prototyped, but cannot be",
    "  considered conformant or complete before A.",
    "- Edges are direct logical prerequisites, not a historical claim about the",
    "  order in which MKTCTX/4 happened to be implemented.",
    "- The graph intentionally excludes deferred, rejected, and superseded items.",
    "  Their absence is a decision boundary, not evidence that they never existed.",
    "",
    "The graph contains all 29 accepted items, has no isolated story, and is a",
    `validated, transitively reduced DAG with ${graph.edgeCount} direct blocking`,
    "relationships, one root (`US-01`), and one sink (`US-29`).",
    "",
    "## Portfolio status",
    "",
    "| Implementation posture | Stories |",
    "|---|---:|",
    `| Complete | ${counts.get("complete") ?? 0} |`,
    `| In progress | ${counts.get("in-progress") ?? 0} |`,
    `| Planned | ${counts.get("planned") ?? 0} |`,
    "| **Total** | **29** |",
    "",
    "## Blocking matrix",
    "",
    "The table lists direct edges only. Transitive prerequisites are visible in",
    "the DAG and can be derived by graph traversal.",
    "",
    "| Story | Implementation | Directly blocked by | Directly blocks |",
    "|---|---|---|---|",
  ];

  for (const story of stories) {
    const status = accepted.get(story.feedbackId).item.state.implementation;
    const blockedBy = story.blockedBy.length === 0 ? "-" : story.blockedBy.map((key) => `\`${key}\``).join(", ");
    const blocks = graph.blocks.get(story.key).length === 0 ? "-" : graph.blocks.get(story.key).toSorted().map((key) => `\`${key}\``).join(", ");
    lines.push(`| \`${story.key}\` ${escapeMarkdown(story.title)} | ${status} | ${blockedBy} | ${blocks} |`);
  }

  const maxLevel = Math.max(...graph.levels.values());
  lines.push("", "## Topological delivery layers", "");
  lines.push("Stories in one layer have no blocking relationship with each other and", "may proceed in parallel after every prior prerequisite on their path is met.", "");
  for (let level = 0; level <= maxLevel; level++) {
    const keys = stories.filter((story) => graph.levels.get(story.key) === level).map((story) => story.key);
    lines.push(`- **Layer ${level}:** ${keys.map((key) => `\`${key}\``).join(", ")}`);
  }

  lines.push("", "## User stories", "");
  for (const story of stories) {
    const acceptedItem = accepted.get(story.feedbackId);
    const status = acceptedItem.item.state.implementation;
    const blocks = graph.blocks.get(story.key).toSorted();
    lines.push(
      `### ${story.key} — ${story.title}`,
      "",
      `- **Feedback artifact:** [\`${story.feedbackId}\`](${acceptedItem.relativePath})`,
      `- **Area:** ${story.area}`,
      `- **Implementation posture:** ${status}`,
      `- **Blocked by:** ${story.blockedBy.length === 0 ? "none" : story.blockedBy.map((key) => `\`${key}\``).join(", ")}`,
      `- **Blocks:** ${blocks.length === 0 ? "none" : blocks.map((key) => `\`${key}\``).join(", ")}`,
      "",
      `> As ${indefiniteArticle(story.role)} **${story.role}**, I want **${story.want}**, so that **${story.benefit}**.`,
      "",
      "Acceptance criteria:",
      "",
      ...story.acceptance.map((criterion) => `- ${criterion}`),
      "",
    );
  }
  return `${lines.join("\n")}\n`;
}

function renderDot(accepted, graph) {
  const lines = [
    "digraph accepted_feedback_dag {",
    "  graph [",
    "    layout=dot,",
    "    rankdir=LR,",
    "    newrank=true,",
    "    compound=true,",
    "    splines=polyline,",
    "    overlap=false,",
    "    nodesep=0.28,",
    "    ranksep=0.72,",
    "    pad=0.25,",
    "    bgcolor=\"#FFFFFF\",",
    "    fontname=\"Helvetica\",",
    "    fontsize=18,",
    "    labelloc=t,",
    "    label=\"Accepted MKTCTX feedback dependency DAG\\nSugiyama layered layout via Graphviz dot | green=complete, amber=in progress, blue=planned\"",
    "  ];",
    "  node [shape=box, style=\"rounded,filled\", fontname=\"Helvetica\", fontsize=10, margin=\"0.12,0.08\", penwidth=1.5];",
    "  edge [color=\"#64748B\", penwidth=1.15, arrowsize=0.7];",
    "",
  ];

  for (const [area, color] of areaStyle) {
    const areaStories = stories.filter((story) => story.area === area);
    if (areaStories.length === 0) continue;
    const cluster = area.toLowerCase().replaceAll(/[^a-z0-9]+/g, "_");
    lines.push(`  subgraph cluster_${cluster} {`);
    lines.push(`    label=\"${escapeDot(area)}\"; color=\"${color}\"; fontcolor=\"${color}\"; style=\"rounded,dashed\"; penwidth=1.1;`);
    for (const story of areaStories) {
      const acceptedItem = accepted.get(story.feedbackId);
      const status = acceptedItem.item.state.implementation;
      const style = statusStyle[status];
      if (style === undefined) throw new Error(`No graph style for implementation posture ${status}`);
      const label = `${story.key}\n${wrap(story.title)}\n[${style.label}]`;
      lines.push(`    "${story.key}" [label=\"${escapeDot(label)}\", fillcolor=\"${style.fill}\", color=\"${style.border}\", URL=\"${escapeDot(acceptedItem.relativePath)}\", tooltip=\"${escapeDot(story.feedbackId)}\"];`);
    }
    lines.push("  }", "");
  }

  lines.push("  // A -> B means A blocks B.");
  for (const story of stories) {
    for (const blocker of story.blockedBy) lines.push(`  "${blocker}" -> "${story.key}";`);
  }
  lines.push("}", "");
  return lines.join("\n");
}

function renderSvg(dot) {
  const result = spawnSync("dot", ["-Tsvg"], {
    input: dot,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) throw new Error(`Graphviz dot failed: ${result.stderr}`);
  const nodeCount = (result.stdout.match(/class="node"/g) ?? []).length;
  const edgeCount = (result.stdout.match(/class="edge"/g) ?? []).length;
  if (nodeCount !== stories.length) throw new Error(`Rendered SVG contains ${nodeCount} story nodes; expected ${stories.length}`);
  const expectedEdges = stories.reduce((sum, story) => sum + story.blockedBy.length, 0);
  if (edgeCount !== expectedEdges) throw new Error(`Rendered SVG contains ${edgeCount} edges; expected ${expectedEdges}`);
  return result.stdout;
}

async function writeOrCheck(filePath, content) {
  if (checkOnly) {
    const current = await fs.readFile(filePath, "utf8");
    if (current !== content) throw new Error(`Generated user-story artifact is stale: ${path.relative(root, filePath)}`);
    return;
  }
  await fs.writeFile(filePath, content);
}

const accepted = await loadAcceptedItems();
const graph = validateAndOrder(accepted);
const markdown = renderMarkdown(accepted, graph);
const dot = renderDot(accepted, graph);
const svg = renderSvg(dot);
await writeOrCheck(markdownPath, markdown);
await writeOrCheck(dotPath, dot);
await writeOrCheck(svgPath, svg);

console.log(`${checkOnly ? "Verified" : "Generated"} 29 accepted user stories, ${graph.edgeCount} blocking edges, and an acyclic Graphviz SVG`);
