#!/bin/zsh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_NAME="OFD预览"
VERSION="${1:-1.0.0}"
ARCH="$(uname -m)"
case "$ARCH" in
  arm64|aarch64) ARCH_TAG="arm64" ;;
  x86_64) ARCH_TAG="x86_64" ;;
  *) ARCH_TAG="$ARCH" ;;
esac

cd "$ROOT"
./scripts/package-mac-app.sh

SRC="$ROOT/dist/${APP_NAME}.app"
OUT_DIR="$ROOT/release"
ZIP_NAME="OFD-Preview-macOS-${ARCH_TAG}.zip"
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

echo "==> Zip $ZIP_NAME"
ditto -c -k --sequesterRsrc --keepParent "$SRC" "$OUT_DIR/$ZIP_NAME"

SHA256="$(shasum -a 256 "$OUT_DIR/$ZIP_NAME" | awk '{print $1}')"
printf "%s  %s\n" "$SHA256" "$ZIP_NAME" > "$OUT_DIR/${ZIP_NAME}.sha256"

ls -lh "$OUT_DIR"
echo ""
echo "Release assets ready:"
echo "  $OUT_DIR/$ZIP_NAME"
echo "  sha256: $SHA256"
echo "  version tag suggestion: v$VERSION"
echo ""
echo "After uploading the GitHub Release, update the Homebrew cask:"
echo "  repo: https://github.com/ChengRui24/homebrew-ofd"
echo "  file: Casks/ofd-preview.rb  (version + sha256)"
