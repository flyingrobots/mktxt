#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
PROJECT_ROOT=$(CDPATH='' cd -- "$SCRIPT_DIR/.." && pwd)
TEST_ROOT=$(mktemp -d)
trap 'rm -rf -- "$TEST_ROOT"' EXIT

PREFIX="$TEST_ROOT/prefix"
FIXTURE="$TEST_ROOT/sample-project"

# Seed the exact upgrade posture that exposed the macOS activation bug: `current`
# is a symlink to an older version directory. Plain `mv -f stage current` follows
# that directory symlink instead of replacing it.
mkdir -p "$PREFIX/share/mktxt/versions/1.1.1"
ln -s versions/1.1.1 "$PREFIX/share/mktxt/current"

"$PROJECT_ROOT/scripts/install.sh" --prefix="$PREFIX"

[[ "$("$PREFIX/bin/mktxt" --version)" == "mktxt 5.2.0" ]]
[[ "$("$PREFIX/bin/mktxtx" --version)" == "mktxt 5.2.0" ]]
[[ -d "$PREFIX/share/mktxt/versions/5.2.0/node_modules" ]]
[[ -L "$PREFIX/share/mktxt/current" ]]
[[ "$(readlink "$PREFIX/share/mktxt/current")" == "versions/5.2.0" ]]
[[ -z "$(find "$PREFIX/share/mktxt/versions/1.1.1" -name '.current.*' -print -quit)" ]]

# Reinstalling the same version exercises managed command replacement and the
# version-directory backup/swap path.
"$PROJECT_ROOT/scripts/install.sh" --prefix="$PREFIX"
[[ "$("$PREFIX/bin/mktxt" --version)" == "mktxt 5.2.0" ]]

mkdir -p "$FIXTURE"
git -C "$FIXTURE" init -q
printf 'SELECTED\n' > "$FIXTURE/selected.md"
printf 'OMITTED\n' > "$FIXTURE/omitted.md"
printf '["selected.md"]\n' > "$FIXTURE/paths.json"

(
  cd "$FIXTURE"
  "$PREFIX/bin/mktxt" --files-from=paths.json --format=legacy
)

OUTPUT="$FIXTURE/sample-project.txt"
[[ -f "$OUTPUT" ]]
grep -q 'SELECTED' "$OUTPUT"
if grep -q 'OMITTED' "$OUTPUT"; then
  printf 'Error: installed mktxt included a path absent from the manifest\n' >&2
  exit 1
fi

(
  cd "$FIXTURE"
  "$PREFIX/bin/mktxt" \
    --files-from=paths.json \
    --format=context-v5 \
    --emit-manifest \
    --out=context-smoke
)

grep -q '^MKTCTX/5$' "$FIXTURE/context-smoke.txt"
grep -q '^@guide .*@task alone is instruction\.$' "$FIXTURE/context-smoke.txt"
grep -q '@defaults projection=exact' "$FIXTURE/context-smoke.txt"
grep -q 'trust=data' "$FIXTURE/context-smoke.txt"
grep -q '"protocol": "MKTCTX/5"' "$FIXTURE/context-smoke.manifest.json"
"$PREFIX/bin/mktxt" verify "$FIXTURE/context-smoke.txt"
[[ ! -e "$FIXTURE/context-smoke_toc.md" ]]
[[ ! -e "$FIXTURE/context-smoke_symbols.csv" ]]
[[ ! -e "$FIXTURE/context-smoke_diff.txt" ]]
[[ -f "$PREFIX/share/mktxt/versions/5.2.0/docs/examples/mktctx-v5-exact.mktctx" ]]
[[ -f "$PREFIX/share/mktxt/versions/5.2.0/docs/examples/mktctx-v5-numbered.mktctx" ]]
[[ -f "$PREFIX/share/mktxt/versions/5.2.0/docs/examples/mktctx-v5-adversarial.mktctx" ]]
[[ -f "$PREFIX/share/mktxt/versions/5.2.0/docs/examples/mktctx-v5-symbol-1000.mktctx" ]]
[[ -f "$PREFIX/share/mktxt/versions/5.2.0/docs/explain.md" ]]

printf 'selected.md\n' | (
  cd "$FIXTURE"
  "$PREFIX/bin/mktxt" --out=piped-smoke
)

grep -q 'SELECTED' "$FIXTURE/piped-smoke.txt"
grep -q '^MKTCTX/5$' "$FIXTURE/piped-smoke.txt"
if grep -q 'OMITTED' "$FIXTURE/piped-smoke.txt"; then
  printf 'Error: installed mktxt ignored the piped path manifest\n' >&2
  exit 1
fi

printf 'Installed-copy smoke test passed\n'
