#!/usr/bin/env bash
# Build a clean Chrome Web Store release zip.
# Includes only the files the extension needs at runtime; excludes git,
# agent tooling, docs site, store listing, and the build artifacts themselves.
set -euo pipefail

cd "$(dirname "$0")"

VERSION=$(grep -m1 '"version"' manifest.json | sed -E 's/.*"version" *: *"([^"]+)".*/\1/')
OUT="K-downloader-v${VERSION}.zip"

rm -f "$OUT"

zip -r "$OUT" \
  manifest.json \
  background \
  lib \
  offscreen \
  popup \
  icons \
  -x '*.DS_Store' \
  -x 'icons/icon.svg'

echo
echo "Built ${OUT}"
unzip -l "$OUT"
