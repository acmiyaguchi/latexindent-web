#!/usr/bin/env bash
# Fetch latexindent.pl + YAML::Tiny, apply our patches, and assemble
# public/app/ — the directory the browser fetches at runtime to populate
# zeroperl's MemoryFileSystem.
set -euo pipefail

cd "$(dirname "$0")/.."

LATEXINDENT_REF="${LATEXINDENT_REF:-main}"
LATEXINDENT_REPO="https://github.com/cmhughes/latexindent.pl.git"
YAML_TINY_URL="https://raw.githubusercontent.com/Perl-Toolchain-Gang/YAML-Tiny/master/lib/YAML/Tiny.pm"

VENDOR_DIR="vendored"
OUT_DIR="public/app"

rm -rf "$VENDOR_DIR" "$OUT_DIR"
mkdir -p "$VENDOR_DIR" "$OUT_DIR/LatexIndent" "$OUT_DIR/YAML" "$OUT_DIR/File"

echo ">> cloning latexindent.pl@$LATEXINDENT_REF"
git clone --depth 1 --branch "$LATEXINDENT_REF" "$LATEXINDENT_REPO" "$VENDOR_DIR/latexindent" >/dev/null

echo ">> applying patches/latexindent.patch"
( cd "$VENDOR_DIR/latexindent" && git apply "$PWD/../../patches/latexindent.patch" )

echo ">> downloading YAML::Tiny"
curl -sL -o "$VENDOR_DIR/YAML-Tiny.pm" "$YAML_TINY_URL"

echo ">> applying patches/yaml-tiny.patch"
mkdir -p "$VENDOR_DIR/yaml-tiny/YAML"
cp "$VENDOR_DIR/YAML-Tiny.pm" "$VENDOR_DIR/yaml-tiny/YAML/Tiny.pm"
( cd "$VENDOR_DIR/yaml-tiny" && git apply --unsafe-paths --directory="$PWD" "$PWD/../../patches/yaml-tiny.patch" )

echo ">> populating $OUT_DIR"
cp "$VENDOR_DIR/latexindent/latexindent.pl"          "$OUT_DIR/"
cp "$VENDOR_DIR/latexindent/defaultSettings.yaml"    "$OUT_DIR/"
cp "$VENDOR_DIR/latexindent/LatexIndent/"*.pm        "$OUT_DIR/LatexIndent/"
cp "$VENDOR_DIR/yaml-tiny/YAML/Tiny.pm"              "$OUT_DIR/YAML/"

# Full-rewrite files (too large to keep as patches against upstream)
cp overrides/LatexIndent/UTF8CmdLineArgsFileOperation.pm "$OUT_DIR/LatexIndent/"
cp overrides/File/HomeDir.pm                             "$OUT_DIR/File/"

echo ">> writing manifest"
( cd "$OUT_DIR" && find . -type f \( -name '*.pm' -o -name '*.pl' -o -name '*.yaml' \) -printf '%P\n' | sort > files.txt )

echo "ok — $(wc -l < "$OUT_DIR/files.txt") files in $OUT_DIR"
