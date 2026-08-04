#!/usr/bin/env bash
# Package validation gate for @paykernel/core (Phase 0 / monorepo).
# Builds, packs packages/core, runs publint/attw, and consumer smoke (Node + Bun).
# Does not publish or require provider secrets.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CORE="${ROOT}/packages/core"
cd "$ROOT"

PACK_DIR=""
TGZ=""
cleanup() {
  if [[ -n "${PACK_DIR}" && -d "${PACK_DIR}" ]]; then
    rm -rf "${PACK_DIR}"
  fi
  # Drop any leftover pack artifacts from attw/npm pack (root or core)
  shopt -s nullglob
  for f in "${ROOT}"/*.tgz "${CORE}"/*.tgz; do
    rm -f "$f"
  done
  shopt -u nullglob
}
trap cleanup EXIT

echo "==> typecheck"
bun run typecheck

echo "==> typecheck public API type tests"
bun run typecheck:types

echo "==> test"
bun test packages/core

echo "==> build"
bun run build

echo "==> verify dist entrypoints"
test -f "${CORE}/dist/index.js"
test -f "${CORE}/dist/index.d.ts"

echo "==> runtime portability (src + dist node: scan; optional Deno smoke)"
bun run check:runtime-portability

echo "==> npm pack (tarball for consumer smoke)"
PACK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/paykernel-pack.XXXXXX")"
# npm pack must run with cwd=packages/core (publishable package). Do not use
# --prefix from the monorepo root — it packs the private workspace root.
# npm pack prints the filename of the created tarball as the last line
TGZ_NAME="$(cd "${CORE}" && npm pack --pack-destination "${PACK_DIR}" | tail -n 1)"
TGZ="${PACK_DIR}/${TGZ_NAME}"
test -f "${TGZ}"
echo "    packed: ${TGZ}"
# Guard against accidentally packing the private monorepo root
case "${TGZ_NAME}" in
  *monorepo*)
    echo "error: packed monorepo root instead of @paykernel/core" >&2
    exit 1
    ;;
esac

echo "==> publint"
bun run publint

echo "==> attw (are the types wrong)"
bun run attw

echo "==> consumer smoke (Bun + Node against packed tarball)"
bun run scripts/consumer-smoke.mjs "${TGZ}"

echo "==> package validation OK"
