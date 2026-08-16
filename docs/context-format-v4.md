# MKTCTX/4: a verifiable, budget-aware source-context packet

MKTCTX/4 is the default output protocol of `mktxt` 4.0.0. It is an
incompatible successor to MKTCTX/3. The v3 renderer remains available through
`--format=context-v3`; new packets should use `context-v4`.

MKTCTX/4 makes five commitments:

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
[`examples/mktctx-v4-exact.mktctx`](examples/mktctx-v4-exact.mktctx).

## Byte and text model

The packet itself and every textual source file are valid UTF-8. An exact file
is included only when its original bytes decode as UTF-8 with a fatal decoder.
The decoder must preserve, rather than consume, an initial UTF-8 BOM. Encoding
the decoded scalar sequence as UTF-8 must reproduce the original bytes.

MKTCTX/4 does not normalize source:

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
MKTCTX/4
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

The JSON manifest contains protocol, representation, profile, generator,
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

`N` and `H` cover every packet byte from `MKTCTX/4` through the LF after
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

MKTCTX/4 currently performs syntax extraction for JavaScript and TypeScript
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

- `lossless`: every successfully selected file is exact by default;
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

MKTCTX/4 parsers must reject unsupported magic versions rather than guessing.
The `context-v3` renderer and historical fixtures remain available for
compatibility, but v4 is the default and the only version accepted by
`mktxt verify`.

`.mktctx` is the preferred explicit packet extension. The CLI retains its
historical `.txt` default so existing scripts and the working-directory-derived
output convention remain compatible. `text/x-mktctx; version=4` is a
provisional, unregistered media type for local integrations; it must not be
described as an IANA-registered type.

The production generator owns:

- `examples/mktctx-v4-exact.mktctx`;
- `examples/mktctx-v4-numbered.mktctx`; and
- `examples/mktctx-v4-adversarial.mktctx`.

The adversarial fixture nests apparent packets, tasks, chunks, end markers, and
trailers inside exact source data. `pnpm check:fixtures` regenerates and
strictly verifies these artifacts byte-for-byte.
