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
EXAMPLES_DIR="public/examples"

rm -rf "$VENDOR_DIR" "$OUT_DIR" "$EXAMPLES_DIR"
mkdir -p "$VENDOR_DIR" "$OUT_DIR/LatexIndent" "$OUT_DIR/YAML" "$OUT_DIR/File" "$EXAMPLES_DIR"

echo ">> cloning latexindent.pl@$LATEXINDENT_REF"
git clone --depth 1 --branch "$LATEXINDENT_REF" "$LATEXINDENT_REPO" "$VENDOR_DIR/latexindent" >/dev/null

LATEXINDENT_SHA=$(git -C "$VENDOR_DIR/latexindent" rev-parse HEAD)
LATEXINDENT_DESCRIBE=$(git -C "$VENDOR_DIR/latexindent" describe --tags --always)

PATCHES_DIR="$PWD/patches"

echo ">> applying patches/latexindent.patch"
( cd "$VENDOR_DIR/latexindent" && patch -p1 --no-backup-if-mismatch < "$PATCHES_DIR/latexindent.patch" )

echo ">> downloading YAML::Tiny"
curl -sL -o "$VENDOR_DIR/YAML-Tiny.pm" "$YAML_TINY_URL"

echo ">> applying patches/yaml-tiny.patch"
mkdir -p "$VENDOR_DIR/yaml-tiny/YAML"
cp "$VENDOR_DIR/YAML-Tiny.pm" "$VENDOR_DIR/yaml-tiny/YAML/Tiny.pm"
( cd "$VENDOR_DIR/yaml-tiny" && patch -p1 --no-backup-if-mismatch < "$PATCHES_DIR/yaml-tiny.patch" )

echo ">> populating $OUT_DIR"
cp "$VENDOR_DIR/latexindent/latexindent.pl"          "$OUT_DIR/"
cp "$VENDOR_DIR/latexindent/defaultSettings.yaml"    "$OUT_DIR/"
cp "$VENDOR_DIR/latexindent/LatexIndent/"*.pm        "$OUT_DIR/LatexIndent/"
cp "$VENDOR_DIR/yaml-tiny/YAML/Tiny.pm"              "$OUT_DIR/YAML/"

# Full-rewrite files (too large to keep as patches against upstream)
cp overrides/LatexIndent/UTF8CmdLineArgsFileOperation.pm "$OUT_DIR/LatexIndent/"
cp overrides/File/HomeDir.pm                             "$OUT_DIR/File/"

echo ">> copying curated examples"
DEMO_SRC="$VENDOR_DIR/latexindent/documentation/demonstrations"
for f in items1.tex align1.tex align1.yaml headings1.tex \
         multiple-sentences1.tex manipulate-sentences.yaml \
         textwrap1.tex textwrap1.yaml \
         env-mlb1.tex env-mlb12.yaml; do
  cp "$DEMO_SRC/$f" "$EXAMPLES_DIR/$f"
done

echo ">> writing manifest"
( cd "$OUT_DIR" && find . -type f \( -name '*.pm' -o -name '*.pl' -o -name '*.yaml' \) -printf '%P\n' | sort > files.txt )

echo ">> writing version.json (latexindent $LATEXINDENT_DESCRIBE @ $LATEXINDENT_SHA)"
cat > "$OUT_DIR/version.json" <<EOF
{
  "ref": "$LATEXINDENT_REF",
  "describe": "$LATEXINDENT_DESCRIBE",
  "sha": "$LATEXINDENT_SHA",
  "repo": "https://github.com/cmhughes/latexindent.pl"
}
EOF

echo "ok — $(wc -l < "$OUT_DIR/files.txt") files in $OUT_DIR"
