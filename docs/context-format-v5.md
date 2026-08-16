# MKTCTX/5: a verifiable, budget-aware source-context packet

MKTCTX/5 is the default output protocol of `mktxt` 5.0.0. It is an
incompatible successor to MKTCTX/4. The v3 and v4 renderers remain available
through explicit `--format` values; new packets should use `context-v5`.

MKTCTX/5 makes five commitments:

1. exact source means the original bytes of a valid UTF-8 file, including its
   UTF-8 BOM and original LF, CRLF, or CR line endings;
2. packet and manifest identities have reproducible preimages and can be
   checked without the source repository;
3. Git changes and syntax-derived module relationships carry explicit
   provenance and uncertainty;
4. mixed-fidelity projections and budgets never disguise missing source as
   exact source; and
5. derived symbol and attribute overhead is controlled without weakening the
   local source-as-data boundary.

The normative generated example is
[`examples/mktctx-v5-exact.mktctx`](examples/mktctx-v5-exact.mktctx).

## Representation, projection, scope, and coverage

MKTCTX/5 describes four independent facts. `representation` names the source
byte model. `projection_profile` names the deterministic policy used to choose
per-file projections. `selection_scope` names the candidate universe. The
coverage fields say how much of that universe was actually included. Neither
an exact representation nor the `exact-selection` profile claims that the
packet represents a complete repository.

The manifest uses `representation=valid-utf8-source-bytes`; the wire header
uses the equivalent token `exact-valid-utf8-source-bytes`. The coverage record
has this shape:

```text
@coverage selection_scope=explicit-selection normalized_requested=3 included=2 omitted=1 repository_total=unknown selected_complete=false repository_complete=unknown aliases_included=1 duplicate_requests=one-after-normalized-path-deduplication alias_counting=each-included-path
```

Cardinalities are normative:

- a request is counted after path normalization and duplicate removal, so the
  first occurrence of a normalized path contributes one request and later
  duplicates contribute zero;
- `included` counts paths, not distinct byte sequences, so an alias contributes
  one included file and also contributes to `aliases_included`;
- `omitted` counts normalized requested paths with an explicit omission record;
- `normalized_requested` must equal `included + omitted`; and
- `repository_total=unknown` and `repository_complete=unknown` are literal
  unknown values, not false, zero, or an absent claim.

`selected_complete=true` means every normalized request was included. It says
nothing about paths outside the declared `selection_scope`.

## Selection request, policy, candidates, and outcome

Selection provenance has four layers, in order:

1. `@selection-request` records the normalized caller request: logical root
   labels, a replayable path list when one exists, or the Git base ref;
2. `@selection-policy` records generator-controlled filters, discovery
   visibility, ordering, projection profile, symbol policy, numbering, and the
   optional token budget;
3. `@candidates` records the ordered, unique, normalized paths produced by
   resolving that request and policy; and
4. `@index` plus `@omitted` records the outcome for every candidate.

`mktxt-selection-request-1` is the normalization identifier. Its request
identity is SHA-256 of canonical JSON containing only the identifier,
reproducibility posture, caller request, and normalized policy. Candidate paths,
file bytes, omissions, and task text are outcome or instruction data and do not
change that request identity.

The three reproducibility postures are deliberately narrow:

- `exact-request-replayable` means the normalized logical path request is
  embedded and can be submitted again; it does not promise the repository will
  still contain the same bytes;
- `policy-replayable` means discovery or Git-selection policy is embedded but
  replay depends on repository and working-tree state; and
- `descriptive-only` means redaction or multiple logical roots prevents an
  exact replay claim, while the packet still describes what happened.

The canonical record never stores invocation-directory paths, source-root
absolute paths, manifest filenames, producer shell commands, or task text.
Paths inside one logical root are root-relative with `/` separators. External
paths use `external/<eight-hex-redaction-id>/<basename>`; only the redacted form
appears in requests, candidates, omissions, and file records. Multiple roots
use ordinal labels such as `root-1`. Extension sets are sorted and unique.
These rules prevent incidental machine paths from perturbing packet identity;
they are privacy minimization, not a claim that filenames or source content are
non-sensitive.

## Selection-failure policy and diagnostics

`--missing=error|record` controls every candidate that cannot become an
included source file. Explicit `--files-from` defaults to `error`; implicit
piped lists, repository discovery, and Git-diff selection default to `record`.

Under `error`, the first missing path, directory, binary file, invalid-UTF-8
file, processing failure, extension exclusion, test exclusion, or output-path
exclusion emits a stable error diagnostic on stderr, exits nonzero, and writes
no new packet or sidecar. Existing output is not rotated. Under `record`, the
producer emits a warning diagnostic and corresponding `@omitted` record,
continues with the remaining candidates, writes the packet, and exits zero.

Every diagnostic has `severity`, `code`, `path`, `reason`, and optional
`detail`. Codes are stable protocol vocabulary:

| Reason | Code |
|---|---|
| `selected-missing` | `SELECTED_PATH_MISSING` |
| `selected-not-file` | `SELECTED_PATH_NOT_FILE` |
| `selected-binary` | `SELECTED_PATH_BINARY` |
| `selected-invalid-utf8` | `SELECTED_PATH_INVALID_UTF8` |
| `processing-error` | `SELECTED_PATH_PROCESSING_ERROR` |
| `excluded-extension` | `PATH_EXCLUDED_EXTENSION` |
| `excluded-test` | `PATH_EXCLUDED_TEST` |
| `output-file` | `OUTPUT_PATH_EXCLUDED` |

The packet's `@diagnostics` block does not certify its own structure or
integrity; both are `not-evaluated` until a verifier checks them. A strict
verifier can therefore report four orthogonal facts: structure and integrity
passed, `selection_complete` may be false, and `policy_compliant` may be true
under `record` or false for an independently constructed `error`-policy packet.
There is intentionally no single `valid` flag that collapses these claims.

## Citation grammar and resolution

The five identities in a citation are deliberately distinct:

- `F<12-to-64-lowercase-hex>` identifies a path resource;
- `P<12-lowercase-hex>` identifies one canonical packet manifest;
- `sha256-<64-lowercase-hex>` identifies exact source bytes;
- `S<at-least-three-decimal-digits>` identifies a packet-local symbol; and
- `L<positive-decimal>-L<positive-decimal>` identifies a 1-based inclusive
  source-line range.

The normative citation grammar is:

```text
local              = file-id ":" locator
packet-qualified   = packet-id "/" file-id ":" locator
content-qualified  = file-id "@sha256-" 64HEXDIG ":" locator
locator            = line-range | symbol-id
```

Local citations such as `Fc242cace9874:L12-L18` are shorthand within the
packet being read; the path identity does not bind file bytes. Packet-qualified
citations such as `Pab781a4ee54f/Fc242cace9874:S001` must reject a different
packet ID. Content-qualified citations use the complete SHA-256 digest. Digest
prefixes are invalid rather than conditionally resolved, so their meaning
cannot change when a collection grows.

Resolution first checks the optional packet ID, then the path resource. If the
path exists, a content qualifier must match its exact source digest; an edit is
a `CONTENT_MISMATCH`, never a search for similar bytes elsewhere. If the path
is absent and the citation is content-qualified, a consumer may follow a
rename only when the full digest identifies exactly one canonical content
group. Zero groups is `CONTENT_NOT_FOUND`; multiple independent groups is
`CONTENT_AMBIGUOUS`.

An alias citation preserves the alias file ID and path as the resource being
cited. Line ranges resolve against its byte-identical content. Symbol locators
resolve through the alias's declared canonical file because alias bodies carry
`symbols=canonical`. Invalid syntax, absent files or symbols, reversed ranges,
zero lines, and ranges past the declared source line count are errors. The
reference implementation exposes `parseV5Citation`, `formatV5Citation`, and
`resolveV5Citation` with stable error codes for these cases.

Symbol tokens use an unbounded positive decimal ordinal with a minimum width of
three digits: `S001` through `S999`, followed by `S1000`, `S1001`, and so on.
Extra leading zeroes are non-canonical, so `S0001` is invalid. A full symbol ID
is the owning path-resource ID, a colon, and the token. Parent IDs use the same
grammar.

Symbol ordinals are packet-local products of the declared analyzer traversal.
They are stable only within that packet. Inserting or removing symbols, changing
symbol filtering, or changing the analyzer or its version may renumber them,
even when the path-resource ID is unchanged. Durable references across packets
should prefer content-qualified line ranges; a packet-qualified symbol citation
is appropriate when the exact analyzed packet is the intended authority.

## Byte and text model

The packet itself and every textual source file are valid UTF-8. An exact file
is included only when its original bytes decode as UTF-8 with a fatal decoder.
The decoder must preserve, rather than consume, an initial UTF-8 BOM. Encoding
the decoded scalar sequence as UTF-8 must reproduce the original bytes.

MKTCTX/5 does not normalize source:

- a UTF-8 BOM is source data;
- LF, CRLF, and bare CR are preserved;
- Unicode text is preserved as its original UTF-8 byte sequence;
- invalid UTF-8 and binary input are omitted or rejected with an explicit
  reason; and
- `bytes` and `sha256` always describe the original source byte sequence, not
  a numbered or structural projection.

Line ranges are computed over preserved source bytes. LF counts as one line
terminator, CRLF counts as one terminator, and bare CR counts as one
terminator. A trailing terminator does not create an extra empty source line.

## Control and data framing

The first line is exactly:

```text
MKTCTX/5
```

Control records are UTF-8 lines beginning with `@`. Quoted attribute values use
JSON string escaping. Bare values cannot contain whitespace.

An exact chunk header has this form:

```text
@chunk range=L1-L64 bytes=1234 trust=data term=":mktctx-chunk-1-abcd1234" sep=LF-if-needed
```

`bytes` is authoritative. A parser must consume exactly that many bytes after
the header's LF before interpreting any later byte as control syntax. Any
`@file`, `@task`, `@end-content`, `@end-context`, or other apparent directive
inside those bytes is source data and has no instruction authority.

After the payload bytes, the parser expects the declared whole-line `term`.
When the payload does not end in LF, CRLF, or CR, one LF framing separator is
inserted before the term; that separator is not source data. Terms are checked
against every whole payload line and deterministically lengthened on collision.
They are redundant corruption landmarks, not payload delimiters.

`trust=data` remains adjacent to every source chunk. The packet-level default
does not remove this local model-facing boundary.

## Canonical manifest and packet identities

The JSON manifest contains protocol, representation, projection profile, generator,
analyzer, selection, coverage, defaults, budget, optional VCS provenance,
omissions, edges, and every indexed file and emitted symbol. It excludes the
optional task.

Its canonicalization identifier is `mktctx-cjson-1`. The canonical byte
preimage is valid UTF-8 JSON with:

- object keys sorted by Unicode code-point order;
- arrays retained in declared order;
- no insignificant whitespace;
- ordinary JSON string and finite-number serialization; and
- properties whose value is absent omitted before serialization.

`manifest_sha256` is SHA-256 of those canonical bytes. The packet ID is `P`
plus the first 12 hexadecimal characters of that digest. The pretty
`*.manifest.json` sidecar represents the same value but is not itself the hash
preimage.

The packet ends with:

```text
@end-context
@trailer bytes=N sha256=H estimator=utf8-bytes-div-4-v1 est_tokens=T
```

`N` and `H` cover every packet byte from `MKTCTX/5` through the LF after
`@end-context`, excluding the trailer. No bytes may follow the trailer's LF.
`T` is the stable `ceil(total_packet_bytes / 4)` heuristic, including the
trailer. It is a budgeting estimate, not a model-independent tokenizer count.

## Verification levels

`mktxt verify PACKET` is the reference strict verifier. It rejects a packet
unless it verifies:

1. valid UTF-8 for the envelope and every exact source;
2. the terminal envelope byte count and SHA-256;
3. the final `@end-context` and absence of trailing data;
4. the packet-ID prefix relation;
5. canonical reconstruction and SHA-256 of the manifest;
6. agreement between declared file count and index records;
7. every authoritative chunk byte boundary and terminator;
8. reconstructed exact-file byte count and SHA-256;
9. every alias against an earlier verified exact canonical file; and
10. optional task byte framing.

Use `--json` for a machine-readable report:

```bash
mktxt verify review.mktctx --json
cat review.mktctx | mktxt verify - --json
```

Verification proves internal integrity and declared completeness posture. It
does not prove that source is safe, semantically correct, repository-complete,
or signed by a trusted party.

## Git provenance and change records

Use the Git-aware entry point instead of piping only names:

```bash
mktxt --cwd=/path/to/repo --git-diff=origin/main --out=review
```

The packet records branch or detached posture, `HEAD`, resolved base commit,
the caller's base ref, dirty status, and that final bytes came from the working
tree. Change records distinguish added, modified, deleted, renamed, copied,
type-changed, and unmerged paths. Where a base blob exists, `base_sha256`
binds its bytes. Renames retain `previous_path` and Git's similarity score.

Deleted paths are change records, not failed file reads. Untracked files are
recorded as additions. Git provenance describes the selected comparison; it
does not make the packet a replacement for Git history.

## Dependency edges

MKTCTX/5 currently performs syntax extraction for JavaScript and TypeScript
static imports, re-exports, dynamic imports, and CommonJS `require` calls. It
resolves relative specifiers against selected files, including the TypeScript
source behind emitted `.js` specifiers.

Every edge declares:

- source file ID;
- optional resolved target file ID;
- original specifier;
- edge kind;
- `resolved`, `external`, `unresolved`, or `out-of-scope` posture; and
- `syntax` or `resolved` confidence.

The edge block is `partial`: package exports, `tsconfig` paths, runtime loaders,
and other languages are not claimed to be resolved. This limitation is emitted
in the block's reason rather than hidden.

## Profiles, projections, and budgets

Profiles are deterministic presets:

- `exact-selection`: every successfully selected file is exact by default;
- `review`: Git changes and their direct resolved neighbors are exact, files
  two graph hops away use signatures when available, and the remainder uses
  outlines or references; and
- `structure`: source bodies are absent; files use outlines or references.

Per-file projections are:

- `exact`: original valid UTF-8 source bytes;
- `numbered`: a derived citation view, never byte-exact source;
- `signatures`: selected top-level or exported structural records;
- `outline`: the emitted structural outline;
- `reference`: path and source identity only; and
- `alias`: a distinct path whose bytes equal an earlier exact file.

`--budget-tokens=N` uses the declared `utf8-bytes-div-4-v1` heuristic. Changed
files in a review remain exact even when that exceeds the requested budget;
`exceeded=true` makes that posture explicit. Other exact candidates degrade to
signatures or references rather than being silently truncated. Per-file
`est_tokens` and the packet trailer's total estimate use the same estimator.

## Symbol policy and compact defaults

`--symbols=useful` is the default:

- unlocatable symbols are excluded;
- JSON, JSONL, YAML, and TOML retain located depths 0 and 1;
- Markdown retains located depths 0 through 2;
- supported code retains located symbols; and
- other formats retain located top-level structure.

`--symbols=full` retains all analyzer records, including unavailable ranges.
`--symbols=none` disables derived symbols. Every outline declares policy,
analyzer total, and emitted count, so filtering is visible.

Common file defaults are declared once:

```text
@defaults projection=exact reason=selected trust=data symbol_exported=false
```

Index records omit default projection and reason. Symbols omit `exported=false`
and signatures identical to their names. Depth remains explicit for cheap
validation, and each chunk retains `trust=data` locally.

## Compatibility and generated fixtures

MKTCTX/5 parsers must reject unsupported magic versions rather than guessing.
The `context-v3` and `context-v4` renderers and historical fixtures remain
available for compatibility. `mktxt verify` accepts V5 and frozen V4 packets
by inspecting their magic line before invoking the corresponding strict
verifier.

`.mktctx` is the preferred explicit packet extension. The CLI retains its
historical `.txt` default so existing scripts and the working-directory-derived
output convention remain compatible. `text/x-mktctx; version=5` is a
provisional, unregistered media type for local integrations; it must not be
described as an IANA-registered type.

The production generator owns:

- `examples/mktctx-v5-exact.mktctx`;
- `examples/mktctx-v5-numbered.mktctx`; and
- `examples/mktctx-v5-adversarial.mktctx`; and
- `examples/mktctx-v5-symbol-1000.mktctx`.

The adversarial fixture nests apparent packets, tasks, chunks, end markers, and
trailers inside exact source data. `pnpm check:fixtures` regenerates and
strictly verifies these artifacts byte-for-byte.
