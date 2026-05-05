# mktxt & mktxtx

Tools to aggregate all non-binary files in a directory into a single text file.

## mktxtx (TypeScript + Graft)

The modern version that uses AST parsing for robust symbol and signature extraction.

### Usage

```bash
./mktxtx [directories...] [--include-ext=<ext>] [--exclude-ext=<ext>] [--out=<name>] [--no-tests]
```

Example:
```bash
./mktxtx --cwd=src --include-ext=ts --out=mysrc
```

### Outputs

- `mysrc.txt`: Aggregated content.
- `mysrc_toc.md`: Table of contents.
- `mysrc_symbols.csv`: Symbols with Type, Signature, File, and Line.
- `mysrc_diff.txt`: Diff against the previous run.

---

## mktxt (Legacy Bash)
...

## Features

- **Multiple Directories**: Pass one or more directories as positional arguments to aggregate them all.
- **Extension Filter**: Use `--ext=foo` to quickly include only files with the `.foo` extension.
- **Glob Filter**: Use `--filter="*.ext"` (or the legacy `filter="*.ext"`) to filter files by glob pattern.
- **Ignore Tests**: Use `--no-tests` to exclude common test files and directories (e.g., `*_test.go`, `tests/`, `__tests__/`).
- **Git Integration**: Respects `.gitignore` by using `git ls-files` when inside a Git repository, including untracked files.
- **Binary Detection**: Excludes binary and empty files automatically.
- **Cycle Detection**: Detects and avoids infinite loops from symlinks and skips duplicate file contents (using canonical paths).
- **JSONL Output**: Emits JSONL for each file processed and a final summary: `{"path":"...","lines":...,"size":...}`.
- **Diff Tracking**: Rotates previous output and generates a diff (`.prev.txt` and `.prev.diff.txt`).
- **Headers**: Formats each file in the aggregate with its relative path as a header.
