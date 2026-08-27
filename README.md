# mktxt

**mktxt** is a blazingly fast, deterministic context bundler designed to package source code for consumption by AI agents and LLMs. 

Instead of dumping raw text into a prompt, `mktxt` produces a verifiable **MKTCTX/5** artifact. It extracts dependency graphs, parses AST outlines (via [Graft](https://github.com/flyingrobots/graft)), automatically converts binary PDFs to text, and embeds files using cryptographic hash framing so agents receive a structured, mathematically verified working set.

## Installation

The recommended way to install `mktxt` globally is via its self-contained installation script. 

```bash
# Installs to ~/.local/share/mktxt and symlinks to ~/.local/bin/mktxt
./scripts/install.sh --prefix=$HOME/.local
```

## Features

- 🚀 **Parallel Execution:** Saturates I/O by batching file parsing and AST extraction asynchronously.
- 📄 **PDF Extraction:** Automatically extracts text from `.pdf` binaries (requires `pdftotext`) asynchronously without blocking the event loop.
- 🌳 **AST Outlines & Dependencies:** Uses `@flyingrobots/graft` to expose function/class signatures and builds module-resolution graphs.
- 🔒 **Cryptographic Verification:** Every packet is emitted with a canonical JSON manifest, chunk-level file hashes, and a whole-envelope `sha256` trailer.
- 📂 **Git Provenance:** Respects `.gitignore`, supports `--git-diff` generation, and accurately bounds context budget by selectively projecting out-of-scope files.

## Quickstart

Bundle a specific folder:
```bash
mktxt --cwd=src --include-ext=ts --out=mysrc
```

Provide explicit files to bundle via stdin:
```bash
git diff origin/main --name-only | mktxt --out=diff-context
```

Generate an LLM code-review packet:
```bash
mktxt \
  --cwd=/path/to/repo \
  --git-diff=origin/main \
  --profile=review \
  --task="Review these files for unsafe path handling" \
  --out=review-context
```


## CLI Usage

```text
Usage: mktxt [directories...] [options]
       mktxt verify <packet.mktctx|-> [--json]

Aggregate selected UTF-8 source files for humans or language models.

Options:
  --cwd=DIR                 Add a source directory
  --files-from=PATH|-       Package exactly the listed paths
                            Non-empty piped stdin is detected automatically
  --include-ext=EXT         Include only an extension (repeatable)
  --exclude-ext=EXT         Exclude an extension (repeatable)
  --no-tests                Exclude common test paths during discovery
  --out=NAME                Override the output basename
  --format=context-v5       Emit the MKTCTX/5 context protocol (default)
  --format=context-v4       Emit the historical MKTCTX/4 protocol
  --format=context-v3       Emit the historical MKTCTX/3 protocol
  --format=legacy           Emit the original aggregate and sidecars
  --profile=exact-selection Exact selected valid UTF-8 bytes (default)
  --profile=review          Exact changes and neighbors; structural remainder
  --profile=structure       Outlines and identities without source bodies
  --symbols=useful|full|none
                            Select derived symbol detail (default: useful)
  --budget-tokens=N         Apply the declared bytes-div-4 heuristic budget
  --missing=error|record    Fail before output or record structured diagnostics
                            Defaults: error for --files-from; record otherwise
  --git-diff=REF            Capture Git provenance and review REF..working-tree
  --line-numbers            Emit a numbered citation view instead of exact chunks
  --task=TEXT               Append one optional instruction after context data
  --task-file=PATH          Read the task from a UTF-8 file
  --emit-manifest           Emit <basename>.manifest.json with a context format
  --emit-sidecars           Emit derived TOC, symbol CSV, previous file, and diff
  -V, --version             Print the installed version
  -h, --help                Show this help
```


## Model Context Protocol (MCP) Server

`mktxt` can operate natively as an MCP server, allowing AI agents to dynamically generate verified context payloads on-demand.

### What it does
The MCP server exposes a `generate_context` tool. When an agent calls this tool with a repository path, `mktxt` will generate a deterministic `MKTCTX/5` packet locally and return the absolute file path directly to the agent.

### How to use it
Since the MCP server is built directly into `mktxt`, you can configure your AI agent (like Claude Desktop or an Antigravity agent) to spawn it.

Add the following configuration to your agent's MCP settings:
```json
{
  "mcpServers": {
    "mktxt": {
      "command": "mktxt",
      "args": ["--mcp"]
    }
  }
}
```
*(Note: Replace `mktxt` with the absolute path if it is not in your agent's PATH).*

To run the MCP server manually for testing:
```bash
npm run mcp
```

## The MKTCTX/5 Protocol

`mktxt` outputs a progressive-disclosure format called **MKTCTX/5**. It includes:
1. **Header**: Request metadata and execution policies.
2. **Index**: A flat, hashed index of every included file.
3. **Symbols**: A structural outline of classes, interfaces, and functions.
4. **Edges**: A directed dependency graph of the codebase slice.
5. **Payload**: The exact byte-perfect source code embedded inside chunked demarcations.

Agents can instantly verify they are looking at unaltered code by running the `verify` command directly on the packet:
```bash
mktxt verify review-context.txt
```

> **Learn More**: Read [The MKTCTX Explainer](docs/explain.md) for a deep dive into how `mktxt` replaces Git bundles for AI agents.


## FAQ

**Q: How is this different from a Git bundle?**
A Git bundle moves a repository's history and objects, leaving the receiver to figure out what files actually matter for a given task. `mktxt` does the opposite: it produces a targeted, task-shaped working set. Instead of saying "here is the repo," it says "here are the 5 relevant files, their AST outlines, their dependency graph, and their cryptographically verified source bytes."

**Q: Is this just a zip file of code?**
No. A zip file is an opaque binary blob that an LLM cannot natively read. An MKTCTX packet is a deterministic, plain-text artifact that progressively discloses information. An agent can read the index and AST outlines at the top of the file to understand the architecture *before* deciding to read the heavy source-code chunks at the bottom.

**Q: Why not just pipe `cat **/*` into my LLM prompt?**
Naive concatenation destroys file provenance, corrupts easily on binary files (like PDFs), and breaks completely if the source code happens to contain control tokens that confuse the LLM. `mktxt` safely extracts text from binaries, strictly frames source bytes to prevent injection, and provides stable line-number addressing so agents can accurately cite line ranges in code reviews.
## License

This project is licensed under the Apache 2.0 License. See the [LICENSE](LICENSE) file for details.
