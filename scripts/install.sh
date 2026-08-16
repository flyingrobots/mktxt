#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
PROJECT_ROOT=$(CDPATH='' cd -- "$SCRIPT_DIR/.." && pwd)

PREFIX=""
INSTALL_ROOT=""
BIN_DIR=""

usage() {
  printf '%s\n' \
    "Usage: scripts/install.sh [options]" \
    "" \
    "Install a versioned, self-contained mktxt payload for the current user." \
    "" \
    "Options:" \
    "  --prefix=DIR        Install under DIR/share/mktxt and DIR/bin" \
    "  --install-root=DIR  Override the versioned application root" \
    "  --bin-dir=DIR       Override the command directory" \
    "  -h, --help          Show this help"
}

for arg in "$@"; do
  case "$arg" in
    --prefix=*)
      PREFIX=${arg#*=}
      ;;
    --install-root=*)
      INSTALL_ROOT=${arg#*=}
      ;;
    --bin-dir=*)
      BIN_DIR=${arg#*=}
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'Error: Unknown option: %s\n' "$arg" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -n "$PREFIX" ]]; then
  INSTALL_ROOT=${INSTALL_ROOT:-"$PREFIX/share/mktxt"}
  BIN_DIR=${BIN_DIR:-"$PREFIX/bin"}
else
  : "${HOME:?HOME must be set when --prefix is omitted}"
  INSTALL_ROOT=${INSTALL_ROOT:-"${XDG_DATA_HOME:-$HOME/.local/share}/mktxt"}
  BIN_DIR=${BIN_DIR:-"${XDG_BIN_HOME:-$HOME/.local/bin}"}
fi

for required_command in node pnpm; do
  if ! command -v "$required_command" >/dev/null 2>&1; then
    printf 'Error: Required command not found: %s\n' "$required_command" >&2
    exit 1
  fi
done

node -e '
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 20 || (major === 20 && minor < 11)) process.exit(1);
' || {
  printf 'Error: mktxt requires Node.js 20.11.0 or newer\n' >&2
  exit 1
}

VERSION=$(node -p "require(process.argv[1]).version" "$PROJECT_ROOT/package.json")
if [[ ! "$VERSION" =~ ^[0-9A-Za-z][0-9A-Za-z.+-]*$ ]]; then
  printf 'Error: Unsafe package version: %s\n' "$VERSION" >&2
  exit 1
fi

VERSIONS_DIR="$INSTALL_ROOT/versions"
RELEASE_DIR="$VERSIONS_DIR/$VERSION"
RELEASE_STAGE=""
BACKUP_DIR=""

check_command_target() {
  local command_path="$1"
  if [[ -e "$command_path" && ! -L "$command_path" ]]; then
    printf 'Error: Refusing to replace non-symlink command: %s\n' "$command_path" >&2
    exit 1
  fi
  if [[ -L "$command_path" ]]; then
    local target
    target=$(readlink "$command_path")
    case "$target" in
      "$INSTALL_ROOT"/*) ;;
      *)
        printf 'Error: Refusing to replace unmanaged symlink: %s -> %s\n' "$command_path" "$target" >&2
        exit 1
        ;;
    esac
  fi
}

check_command_target "$BIN_DIR/mktxt"
check_command_target "$BIN_DIR/mktxtx"
if [[ -e "$INSTALL_ROOT/current" && ! -L "$INSTALL_ROOT/current" ]]; then
  printf 'Error: Refusing to replace non-symlink current selector: %s\n' "$INSTALL_ROOT/current" >&2
  exit 1
fi

cleanup() {
  if [[ -n "$RELEASE_STAGE" && -d "$RELEASE_STAGE" ]]; then
    rm -rf -- "$RELEASE_STAGE"
  fi
}
trap cleanup EXIT

printf 'Building mktxt %s...\n' "$VERSION"
pnpm --dir "$PROJECT_ROOT" install --frozen-lockfile
pnpm --dir "$PROJECT_ROOT" run build

mkdir -p "$VERSIONS_DIR" "$BIN_DIR"
RELEASE_STAGE=$(mktemp -d "$VERSIONS_DIR/.${VERSION}.install.XXXXXX")
mkdir -p "$RELEASE_STAGE/bin" "$RELEASE_STAGE/dist" "$RELEASE_STAGE/docs/examples"

install -m 0644 "$PROJECT_ROOT/package.json" "$RELEASE_STAGE/package.json"
install -m 0644 "$PROJECT_ROOT/pnpm-lock.yaml" "$RELEASE_STAGE/pnpm-lock.yaml"
install -m 0644 "$PROJECT_ROOT/README.md" "$RELEASE_STAGE/README.md"
install -m 0644 "$PROJECT_ROOT/docs/context-format-v3.md" "$RELEASE_STAGE/docs/context-format-v3.md"
install -m 0644 "$PROJECT_ROOT/docs/context-format-v4.md" "$RELEASE_STAGE/docs/context-format-v4.md"
install -m 0644 "$PROJECT_ROOT/docs/context-format-v5.md" "$RELEASE_STAGE/docs/context-format-v5.md"
install -m 0644 "$PROJECT_ROOT/docs/explain.md" "$RELEASE_STAGE/docs/explain.md"
install -m 0644 "$PROJECT_ROOT/docs/examples/mktctx-v3-exact.txt" "$RELEASE_STAGE/docs/examples/mktctx-v3-exact.txt"
install -m 0644 "$PROJECT_ROOT/docs/examples/mktctx-v3-numbered.txt" "$RELEASE_STAGE/docs/examples/mktctx-v3-numbered.txt"
install -m 0644 "$PROJECT_ROOT/docs/examples/mktctx-v3-adversarial.txt" "$RELEASE_STAGE/docs/examples/mktctx-v3-adversarial.txt"
install -m 0644 "$PROJECT_ROOT/docs/examples/mktctx-v4-exact.mktctx" "$RELEASE_STAGE/docs/examples/mktctx-v4-exact.mktctx"
install -m 0644 "$PROJECT_ROOT/docs/examples/mktctx-v4-numbered.mktctx" "$RELEASE_STAGE/docs/examples/mktctx-v4-numbered.mktctx"
install -m 0644 "$PROJECT_ROOT/docs/examples/mktctx-v4-adversarial.mktctx" "$RELEASE_STAGE/docs/examples/mktctx-v4-adversarial.mktctx"
install -m 0644 "$PROJECT_ROOT/docs/examples/mktctx-v5-exact.mktctx" "$RELEASE_STAGE/docs/examples/mktctx-v5-exact.mktctx"
install -m 0644 "$PROJECT_ROOT/docs/examples/mktctx-v5-numbered.mktctx" "$RELEASE_STAGE/docs/examples/mktctx-v5-numbered.mktctx"
install -m 0644 "$PROJECT_ROOT/docs/examples/mktctx-v5-adversarial.mktctx" "$RELEASE_STAGE/docs/examples/mktctx-v5-adversarial.mktctx"
install -m 0644 "$PROJECT_ROOT/docs/examples/mktctx-v5-symbol-1000.mktctx" "$RELEASE_STAGE/docs/examples/mktctx-v5-symbol-1000.mktctx"
install -m 0644 "$PROJECT_ROOT/dist/analysis-v4.js" "$RELEASE_STAGE/dist/analysis-v4.js"
install -m 0644 "$PROJECT_ROOT/dist/context.js" "$RELEASE_STAGE/dist/context.js"
install -m 0644 "$PROJECT_ROOT/dist/context-v4.js" "$RELEASE_STAGE/dist/context-v4.js"
install -m 0644 "$PROJECT_ROOT/dist/context-v5.js" "$RELEASE_STAGE/dist/context-v5.js"
install -m 0644 "$PROJECT_ROOT/dist/diff.js" "$RELEASE_STAGE/dist/diff.js"
install -m 0644 "$PROJECT_ROOT/dist/index.js" "$RELEASE_STAGE/dist/index.js"
install -m 0644 "$PROJECT_ROOT/dist/manifest.js" "$RELEASE_STAGE/dist/manifest.js"
install -m 0644 "$PROJECT_ROOT/dist/vcs-v4.js" "$RELEASE_STAGE/dist/vcs-v4.js"
install -m 0755 "$PROJECT_ROOT/bin/mktxt.js" "$RELEASE_STAGE/bin/mktxt"
ln -s mktxt "$RELEASE_STAGE/bin/mktxtx"

printf 'Materializing production dependencies...\n'
pnpm --dir "$RELEASE_STAGE" install --prod --frozen-lockfile --ignore-scripts
node "$PROJECT_ROOT/scripts/verify-install.mjs" "$RELEASE_STAGE" "$VERSION"

if [[ -e "$RELEASE_DIR" || -L "$RELEASE_DIR" ]]; then
  BACKUP_DIR="$VERSIONS_DIR/.${VERSION}.backup.$$"
  mv "$RELEASE_DIR" "$BACKUP_DIR"
fi

mv "$RELEASE_STAGE" "$RELEASE_DIR"
RELEASE_STAGE=""

replace_path() {
  local source_path="$1"
  local destination_path="$2"
  node -e 'require("node:fs").renameSync(process.argv[1], process.argv[2])' \
    "$source_path" "$destination_path"
}

current_stage="$INSTALL_ROOT/.current.$$"
ln -s "versions/$VERSION" "$current_stage"
replace_path "$current_stage" "$INSTALL_ROOT/current"

link_command() {
  local name="$1"
  local command_path="$BIN_DIR/$name"
  local command_stage="$BIN_DIR/.${name}.install.$$"
  ln -s "$INSTALL_ROOT/current/bin/$name" "$command_stage"
  replace_path "$command_stage" "$command_path"
}

link_command mktxt
link_command mktxtx

if [[ -n "$BACKUP_DIR" && -d "$BACKUP_DIR" ]]; then
  rm -rf -- "$BACKUP_DIR"
fi

printf 'Installed mktxt %s\n' "$VERSION"
printf '  payload: %s\n' "$RELEASE_DIR"
printf '  command: %s\n' "$BIN_DIR/mktxt"

case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) printf 'Add %s to PATH to run mktxt directly.\n' "$BIN_DIR" ;;
esac
