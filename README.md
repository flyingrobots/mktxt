# mktxt & mktxtx

Tools to aggregate all non-binary files in a directory into a single text file.

## mktxtx (TypeScript + Graft)

The modern version that uses AST parsing for robust symbol and signature extraction.

## Install for the current user

Run the installer from this checkout:

```bash
./scripts/install.sh
```

The default installation follows the conventional per-user layout:

```text
~/.local/share/mktxt/
├── current -> versions/5.1.0
└── versions/5.1.0/       # compiled app and production dependencies

~/.local/bin/mktxt        # primary command
~/.local/bin/mktxtx       # compatibility alias
```

Each version directory is a complete copy of the compiled application and its frozen production dependency graph. The installer verifies that dependency symlinks remain inside that directory before activating it; it does not link back to this checkout. Installation requires Node.js 20.11 or newer and pnpm. The installed command requires Node.js at runtime; directory discovery and diff generation also use the system `git` and `diff` commands.

Use an isolated prefix—useful for testing or packaging—with:

```bash
./scripts/install.sh --prefix=/path/to/prefix
```

That creates `/path/to/prefix/share/mktxt` and `/path/to/prefix/bin/mktxt`. To use a layout such as `~/.bin/mktxt/` instead:

```bash
./scripts/install.sh --install-root="$HOME/.bin/mktxt" --bin-dir="$HOME/.bin"
```

The installer safely replaces versions it owns, but refuses to overwrite a regular file or unrelated symlink already named `mktxt` or `mktxtx` in the selected bin directory.

### Usage

```bash
./mktxtx [directories...] [--include-ext=<ext>] [--exclude-ext=<ext>] [--out=<name>] [--no-tests]
./mktxtx [--cwd=<directory>] --files-from=<manifest-or-> [--out=<name>]
./mktxtx [--profile=exact-selection|review|structure] [--symbols=useful|full|none]
./mktxtx [--git-diff=<ref>] [--budget-tokens=<n>] [--task=<text>] [--emit-manifest]
./mktxtx [--missing=error|record]
./mktxtx verify <packet.mktctx|-> [--json]
./mktxtx --format=legacy
./mktxtx --version
```

Example:
```bash
./mktxtx --cwd=src --include-ext=ts --out=mysrc
```

When `--out` is omitted, the output name comes from the directory where the
command is invoked—not from `--cwd`. Running the command from `~/git/mktxt`,
for example, writes `mktxt.txt`. Use `--out=<name>` to override that basename,
`--emit-manifest` to add the canonical JSON manifest, or `--emit-sidecars` to
add the derived TOC, symbol CSV, previous aggregate, and unified diff.

### Package an exact list of files

Use `--files-from` when the aggregate must contain only explicitly selected files. Paths are resolved relative to `--cwd` (or the current directory when `--cwd` is omitted), retained in manifest order, and deduplicated by their canonical path.

Newline-separated (`paths.txt`):

```text
src/index.ts
README.md
```

JSON (`paths.json`):

```json
["src/index.ts", "README.md"]
```

JSONL (`paths.jsonl`):

```jsonl
{"path":"src/index.ts"}
{"path":"README.md"}
```

Run it with a manifest file or pipe the manifest on stdin:

```bash
./mktxtx --cwd=/path/to/repo --files-from=paths.txt --out=selected
printf '%s\n' src/index.ts README.md | ./mktxtx --cwd=/path/to/repo --files-from=- --out=selected
git diff origin/main --name-only | mktxt
```

Non-empty piped stdin is detected automatically, so the final command is
equivalent to using `--files-from=-`. Piped paths are resolved from the current
directory, retained in order, and remain the only candidates. Missing paths,
directories, and non-text files are warned about and recorded as structured
diagnostics in this convenient pipeline form. Use `--missing=error` when any
invalid or excluded candidate must fail before output is written; use
`--missing=record` to continue explicitly. An explicit `--files-from` defaults
to `error`, while implicit piped input and discovery default to `record`.

Missing paths, directories, binary files, and output files named in the manifest are errors. Extension filters and `--no-tests` cannot be combined with `--files-from`, so the manifest remains the exact selection authority. JSON may also use `{"paths":[...]}`, and JSON/JSONL entries may be strings or `{"path":"..."}` objects.

### Package verifiable LLM context with MKTCTX/5

The default `context-v5` format is a self-contained, deterministic source
context packet. Exact content preserves the original bytes of valid UTF-8
files—including a UTF-8 BOM and LF, CRLF, or CR newlines. It adds canonical
manifest identity, a strict whole-envelope trailer, verified byte-count
framing, stable path IDs, compact and policy-controlled Graft outlines,
syntax-level module edges, explicit omissions, mixed-fidelity projections,
heuristic token budgets, and privacy-aware selection-request identity. V5
separates the normalized caller request, generator policy, resolved candidates,
included files, and omissions, and labels replayability as exact-request,
policy-only, or descriptive.

```bash
mktxt \
  --cwd=/path/to/repo \
  --files-from=paths.jsonl \
  --format=context-v5 \
  --profile=exact-selection \
  --symbols=useful \
  --task="Review these files for unsafe path handling" \
  --emit-manifest \
  --out=review-context
```

This writes the self-contained `review-context.txt` and
`review-context.manifest.json`. Add `--emit-sidecars` when you also want the
derived TOC, symbol CSV, previous packet, and streaming diff.
Use `--task-file=prompt.txt` instead of `--task` for a multiline task. The task
is placed after all source context so that changing it does not change the
canonical context manifest. Both task options are optional; omit them to create
a reusable context artifact and provide the request separately.

Verify a packet without its source repository:

```bash
mktxt verify review-context.txt
mktxt verify review-context.txt --json
```

For code review, let `mktxt` capture the comparison instead of piping only
file names:

```bash
mktxt \
  --cwd=/path/to/repo \
  --git-diff=origin/main \
  --profile=review \
  --budget-tokens=100000 \
  --out=review
```

This records branch, `HEAD`, resolved base commit, dirty posture, additions,
modifications, deletions, renames, base blob hashes, and the declared
working-tree source. Changed files and direct resolved dependency neighbors are
exact; more distant files degrade explicitly to signatures, outlines, or
references.

The previous aggregate and four-output behavior remain available explicitly:

```bash
mktxt --format=legacy
```

Use `--line-numbers` when citation accuracy is worth a gutter on every source
line. It is an explicit numbered projection rather than exact source.

Use `--symbols=full` to retain every analyzer record or `--symbols=none` to
disable symbols. The default `useful` policy removes unlocatable symbols and
bounds structured-data depth while reporting analyzer totals and emitted
counts. Token figures declare the `utf8-bytes-div-4-v1` heuristic; they are not
presented as universal tokenizer counts.

The protocol and design rationale are specified in
[`docs/context-format-v5.md`](docs/context-format-v5.md). A generated, taskless
example is available at
[`docs/examples/mktctx-v5-exact.mktctx`](docs/examples/mktctx-v5-exact.mktctx),
with numbered and adversarial companions in the same directory. The progressive
[`docs/explain.md`](docs/explain.md) guide reads that exact fixture end to end
and compares its job with Git bundles. MKTCTX/4 and MKTCTX/3 remain available
explicitly and are documented in
[`docs/context-format-v4.md`](docs/context-format-v4.md) and
[`docs/context-format-v3.md`](docs/context-format-v3.md).

### Outputs

- `mysrc.txt`: Self-contained MKTCTX/5 context by default.
- `mysrc.manifest.json`: Canonical v5 metadata with `--emit-manifest`.
- `mysrc_toc.md`: Derived table of contents with `--emit-sidecars` or legacy mode.
- `mysrc_symbols.csv`: Derived symbol table with `--emit-sidecars` or legacy mode.
- `mysrc_diff.txt`: Streaming unified diff with `--emit-sidecars` or legacy mode.
- `mysrc.prev.txt`: Previous aggregate retained with `--emit-sidecars` or legacy mode.

---

## mktxt (Legacy Bash)
...

## Features

- **Multiple Directories**: Pass one or more directories as positional arguments to aggregate them all.
- **Extension Filter**: Use `--ext=foo` to quickly include only files with the `.foo` extension.
- **Glob Filter**: Use `--filter="*.ext"` (or the legacy `filter="*.ext"`) to filter files by glob pattern.
- **Exclude Filter**: Use one or more `--exclude=<pattern>` or `--excludes=<pattern>` arguments to skip files or directories (for example, `--exclude=docs/` skips `docs/` recursively).
- **Ignore Tests**: Use `--no-tests` to exclude common test files and directories (e.g., `*_test.go`, `tests/`, `__tests__/`).
- **Git Integration**: Respects `.gitignore` by using `git ls-files` when inside a Git repository, including untracked files.
- **Binary Detection**: Excludes binary and empty files automatically.
- **Cycle Detection**: Detects and avoids infinite loops from symlinks and skips duplicate file contents (using canonical paths).
- **JSONL Output**: Emits JSONL for each file processed and a final summary: `{"path":"...","lines":...,"size":...}`.
- **Diff Tracking**: Rotates previous output and generates a diff (`.prev.txt` and `.prev.diff.txt`).
- **Headers**: Formats each file in the aggregate with its relative path as a header.
