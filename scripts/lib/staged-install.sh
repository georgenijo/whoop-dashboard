#!/usr/bin/env bash
# Staged dependency install for scripts/deploy (issue #524).
#
# `npm ci` deletes node_modules before repopulating it, so running it in
# apps/web rewrites the tree whoop-web.service is lazily `require()`-ing from
# for the whole install, and a failed install leaves the service on a
# half-populated tree. This helper installs into a staging tree instead and
# only touches the live node_modules with a rename once the staged tree is
# complete, mirroring the .next / .next.prev pattern the build uses.
#
# Usage:
#   staged-install.sh install <web_dir> <state_dir>
#   staged-install.sh restore <web_dir> <state_dir>
#
# install:
#   1. Clears any staging left by an earlier failed or killed run
#      (<state_dir>/install-staging), then copies package.json,
#      package-lock.json and .npmrc into it.
#   2. Runs `npm ci` there. The live <web_dir>/node_modules is not read or
#      written. If npm fails, exits with npm's code and leaves the live tree
#      exactly as it was. The staging tree stays for inspection, and the next
#      run clears it.
#   3. Writes the lockfile marker (.deploy-lockfile-sha) into the STAGED tree,
#      so a live tree with a marker is always a complete one.
#   4. Swaps the trees: the old live tree becomes <state_dir>/node_modules.prev
#      (the previous .prev is deleted first, so only one is kept) and the
#      staged tree becomes <web_dir>/node_modules. It uses `mv --exchange`
#      (renameat2 RENAME_EXCHANGE, coreutils >= 9.5) when available, which
#      makes the swap atomic. Otherwise it does two renames, leaving the live
#      path missing for the microseconds between them.
#
# restore:
#   Swaps <state_dir>/node_modules.prev back into place. scripts/deploy calls it
#   when the build that follows a swap fails, so a failed deploy leaves both
#   .next and node_modules as they were. It refuses to run if there is no .prev.
#
# Why <state_dir> lives outside apps/web: apps/web/tsconfig.json includes
# "**/*.ts" and excludes only "node_modules", so a node_modules.prev or a
# staging tree inside apps/web would be type-checked by `next build`. The state
# dir must be on the same filesystem as <web_dir> so the swap is a rename, not a
# copy. scripts/deploy uses <repo>/.deploy-state, which is gitignored.
#
# Test hooks (see tests/test_staged_install.py):
#   STAGED_INSTALL_NPM          npm binary to run (default: npm)
#   STAGED_INSTALL_NO_EXCHANGE  1 = always use the two-rename swap
set -euo pipefail

die() { echo "staged-install: $*" >&2; exit 1; }

[ $# -eq 3 ] || die "usage: $0 install|restore <web_dir> <state_dir>"
MODE=$1
WEB_DIR=$2
STATE_DIR=$3

# These paths get `rm -rf`'d below. Same shape check scripts/deploy applies to
# DEPLOY_LOCK_DIR: absolute, and nothing that could break quoting.
for p in "$WEB_DIR" "$STATE_DIR"; do
  [[ "$p" =~ ^/[A-Za-z0-9._/-]+$ ]] || die "path must be a safe absolute path, got: $p"
done
case "$STATE_DIR/" in
  "$WEB_DIR"/*) die "state dir $STATE_DIR must not be inside $WEB_DIR (tsconfig would type-check it)" ;;
esac
[ -d "$WEB_DIR" ] || die "web dir $WEB_DIR not found"

LIVE="$WEB_DIR/node_modules"
STAGE="$STATE_DIR/install-staging"
STAGED="$STAGE/node_modules"
PREV="$STATE_DIR/node_modules.prev"
NPM=${STAGED_INSTALL_NPM:-npm}

have_exchange() {
  [ "${STAGED_INSTALL_NO_EXCHANGE:-0}" != "1" ] && mv --help 2>/dev/null | grep -q -- '--exchange'
}

# Moves tree $1 into the live path, moving the current live tree (if any) to
# $PREV. Prints which method it used.
swap_in() {
  local src=$1
  rm -rf "$PREV"
  if [ -e "$LIVE" ] && have_exchange; then
    mv -T --exchange "$src" "$LIVE" || die "mv --exchange $src <-> $LIVE failed; live tree unchanged"
    # $src now holds the old live tree.
    mv -T "$src" "$PREV" || echo "staged-install: WARNING: could not move the old tree to $PREV; no rollback copy is kept" >&2
    echo "swapped (atomic exchange)"
    return 0
  fi
  if [ -e "$LIVE" ]; then
    mv -T "$LIVE" "$PREV" || die "could not move $LIVE aside; live tree unchanged"
  fi
  if ! mv -T "$src" "$LIVE"; then
    # Put the old tree back rather than leave the service without one.
    [ -e "$PREV" ] && mv -T "$PREV" "$LIVE"
    die "could not move $src into $LIVE; the old tree was put back"
  fi
  echo "swapped (two renames)"
}

case "$MODE" in
  install)
    mkdir -p "$STATE_DIR"
    rm -rf "$STAGE"
    mkdir -p "$STAGE"
    for f in package.json package-lock.json; do
      [ -f "$WEB_DIR/$f" ] || die "$WEB_DIR/$f missing"
      cp "$WEB_DIR/$f" "$STAGE/$f"
    done
    # .npmrc carries engine-strict=true; without it a wrong Node would install
    # in staging where it would fail in apps/web.
    if [ -f "$WEB_DIR/.npmrc" ]; then cp "$WEB_DIR/.npmrc" "$STAGE/.npmrc"; fi

    echo "--- npm ci (staging: $STAGE) ---"
    rc=0
    (cd "$STAGE" && "$NPM" ci) || rc=$?
    if [ "$rc" -ne 0 ]; then
      echo "staged-install: npm ci exited $rc; live $LIVE was not touched" >&2
      exit "$rc"
    fi
    [ -d "$STAGED" ] || die "npm ci succeeded but produced no $STAGED; live tree not touched"

    # The lockfile was copied above, so hashing the staged copy hashes exactly
    # what was installed even if apps/web changes underneath us.
    shasum -a 256 "$STAGE/package-lock.json" | awk '{print $1}' > "$STAGED/.deploy-lockfile-sha"

    echo "--- swapping staged node_modules into $LIVE ---"
    swap_in "$STAGED"
    rm -rf "$STAGE"
    echo "previous tree kept at $PREV"
    ;;
  restore)
    [ -d "$PREV" ] || die "no $PREV to restore"
    # Reuse swap_in by moving .prev to a scratch name first; swap_in deletes
    # $PREV before swapping, and the tree being removed from live is the one
    # that just failed to build, so dropping it is correct.
    scratch="$STATE_DIR/node_modules.restore"
    rm -rf "$scratch"
    mv -T "$PREV" "$scratch"
    swap_in "$scratch"
    rm -rf "$PREV"
    echo "restored previous node_modules into $LIVE"
    ;;
  *) die "unknown mode: $MODE (want install or restore)" ;;
esac
