# AGENTS

## File-format versioning

Every change to a file format that `mktxt` emits or accepts must include a
version bump in the same change. Never change a format while leaving its
published version identifiers unchanged.

This rule applies to, at minimum:

- the `MKTCTX` text protocol;
- canonical manifest JSON;
- TOC and symbol sidecar schemas;
- path-manifest formats;
- diff or projection-ledger formats; and
- installed or packaged fixtures that represent those formats.

For every file-format change:

1. Bump the package version in `package.json`.
2. Bump the format or schema version when the change alters compatibility or
   interpretation. For `MKTCTX`, this is the version in the leading protocol
   marker such as `MKTCTX/3`.
3. Update all documentation, examples, golden files, parser fixtures, installer
   assertions, and version tests in the same change.
4. Add or update round-trip and compatibility tests that prove the intended
   old/new behavior.
5. Verify the built and installed commands report the new package version.

Use semantic-versioning intent for the package bump:

- **Patch**: a format implementation bug is corrected without changing the
  documented accepted/emitted structure or semantics.
- **Minor**: a backward-compatible field, record, projection, or capability is
  added.
- **Major**: an existing accepted/emitted structure or semantic interpretation
  changes incompatibly.

Documentation-only discussion of a possible future format does not require a
version bump. Once an example or fixture is presented as valid current output,
however, it is part of the format surface and this rule applies.
