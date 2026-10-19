#!/bin/zsh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17}"
export PATH="$JAVA_HOME/bin:$PATH"

APP_NAME="OFD预览"
APP_VERSION="1.0.0"
IDENTIFIER="com.local.ofdtool"
JAR_NAME="ofdrw-tool-1.0.0.jar"

cd "$ROOT"
echo "==> Maven package"
mvn -q clean package -DskipTests

INPUT="$ROOT/target/jpackage-input"
DIST="$ROOT/dist"
rm -rf "$INPUT" "$DIST"
mkdir -p "$INPUT" "$DIST"
cp "$ROOT/target/$JAR_NAME" "$INPUT/"

echo "==> jpackage → $DIST/$APP_NAME.app"
jpackage \
  --type app-image \
  --name "$APP_NAME" \
  --app-version "$APP_VERSION" \
  --dest "$DIST" \
  --input "$INPUT" \
  --main-jar "$JAR_NAME" \
  --main-class com.local.ofdtool.AppLauncher \
  --java-options "-Dfile.encoding=UTF-8" \
  --java-options "-Dapple.awt.application.name=OFD预览" \
  --java-options "-Dapple.laf.useScreenMenuBar=true" \
  --file-associations "$ROOT/package/ofd-association.properties" \
  --mac-package-identifier "$IDENTIFIER" \
  --mac-package-name "$APP_NAME"

# macOS system UTI for OFD is public.ofd; jpackage only exports a custom UTI.
# Claim both so Finder double-click / Open With / "Change All" work.
patch_ofd_uti() {
  local PLIST="$1/Contents/Info.plist"
  /usr/libexec/PlistBuddy -c 'Delete :CFBundleDocumentTypes:0:LSItemContentTypes' "$PLIST" 2>/dev/null || true
  /usr/libexec/PlistBuddy -c 'Add :CFBundleDocumentTypes:0:LSItemContentTypes array' "$PLIST"
  /usr/libexec/PlistBuddy -c 'Add :CFBundleDocumentTypes:0:LSItemContentTypes:0 string public.ofd' "$PLIST"
  /usr/libexec/PlistBuddy -c 'Add :CFBundleDocumentTypes:0:LSItemContentTypes:1 string com.local.ofdtool.ofd' "$PLIST"
  /usr/libexec/PlistBuddy -c 'Delete :CFBundleDocumentTypes:0:CFBundleTypeExtensions' "$PLIST" 2>/dev/null || true
  /usr/libexec/PlistBuddy -c 'Add :CFBundleDocumentTypes:0:CFBundleTypeExtensions array' "$PLIST"
  /usr/libexec/PlistBuddy -c 'Add :CFBundleDocumentTypes:0:CFBundleTypeExtensions:0 string ofd' "$PLIST"
}
patch_ofd_uti "$DIST/${APP_NAME}.app"

echo "==> Install to /Applications (replace existing)"
rm -rf "/Applications/${APP_NAME}.app"
cp -R "$DIST/${APP_NAME}.app" /Applications/
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "/Applications/${APP_NAME}.app" >/dev/null

echo ""
echo "已生成: $DIST/${APP_NAME}.app"
echo "已安装: /Applications/${APP_NAME}.app"
echo ""
echo "设为 .ofd 默认打开方式（一次即可）："
echo "  1. Finder 右键任意 .ofd → 显示简介"
echo "  2.「打开方式」选「OFD预览」→「全部更改…」"
echo ""
echo "之后：双击 .ofd 会打开本 App 并预览；右键「打开方式」里也能选到。"
echo "重新打包: ./scripts/package-mac-app.sh"
