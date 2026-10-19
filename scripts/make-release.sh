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
ZIP_NAME="${APP_NAME}-macOS-${ARCH_TAG}.zip"
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

echo "==> Zip $ZIP_NAME"
ditto -c -k --sequesterRsrc --keepParent "$SRC" "$OUT_DIR/$ZIP_NAME"

# checksum
(cd "$OUT_DIR" && shasum -a 256 "$ZIP_NAME" > "${ZIP_NAME}.sha256")

ls -lh "$OUT_DIR"
echo ""
echo "Release assets ready:"
echo "  $OUT_DIR/$ZIP_NAME"
echo "  version tag suggestion: v$VERSION"
