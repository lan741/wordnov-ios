#!/usr/bin/env bash
# 本地 macOS 构建脚本（与 GitHub Actions 流程等价，方便在 Mac 上调试）
# 用法：bash scripts/build-ios.sh [unsigned|signed]
set -euo pipefail
cd "$(dirname "$0")/.."

MODE="${1:-unsigned}"
BUNDLE_ID="${BUNDLE_ID:-com.hangci.app}"
DISPLAY_NAME="${DISPLAY_NAME:-WordNov}"
APP_VERSION="${APP_VERSION:-2.1.0}"

command -v xcodebuild >/dev/null || { echo "需要 macOS + Xcode"; exit 1; }

echo "==> npm install"
npm install --no-audit --no-fund --loglevel=error

echo "==> cap add ios"
[ -d ios/App ] || npx cap add ios

echo "==> 去广告补丁"
node scripts/apply-adblock.mjs

echo "==> cap sync"
npx cap sync ios

echo "==> 图标 / 启动图"
ICON_DIR="ios/App/App/Assets.xcassets/AppIcon.appiconset"
if [ -d ios-overlay/AppIcon ] && [ -d "$ICON_DIR" ]; then
  rm -f "$ICON_DIR"/*.png
  cp -f ios-overlay/AppIcon/*.png "$ICON_DIR"/
  cp -f ios-overlay/AppIcon/Contents.json "$ICON_DIR/Contents.json"
fi
SPLASH_DIR="ios/App/App/Assets.xcassets/Splash.imageset"
if [ -d ios-overlay/Splash ] && [ -d "$SPLASH_DIR" ]; then
  cp -f ios-overlay/Splash/*.png "$SPLASH_DIR"/
fi

echo "==> Info.plist"
PLIST="ios/App/App/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier ${BUNDLE_ID}" "$PLIST"
/usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName ${DISPLAY_NAME}" "$PLIST" || \
  /usr/libexec/PlistBuddy -c "Add :CFBundleDisplayName string ${DISPLAY_NAME}" "$PLIST"
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString ${APP_VERSION}" "$PLIST" || true

echo "==> xcodebuild ($MODE)"
cd ios/App
rm -rf build Payload *.ipa
if [ "$MODE" = "signed" ]; then
  xcodebuild -workspace App.xcworkspace -scheme App -configuration Release -sdk iphoneos \
    -archivePath build/App.xcarchive archive -allowProvisioningUpdates | tail -n 60
  xcodebuild -exportArchive -archivePath build/App.xcarchive -exportPath build/export \
    -exportOptionsPlist ExportOptions.plist -allowProvisioningUpdates | tail -n 40
  cp build/export/*.ipa "WordNov-${APP_VERSION}-signed.ipa"
else
  xcodebuild -workspace App.xcworkspace -scheme App -configuration Release -sdk iphoneos \
    -derivedDataPath build CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO \
    CODE_SIGN_IDENTITY="" EXPANDED_CODE_SIGN_IDENTITY="" | tail -n 60
  mkdir -p Payload
  cp -R build/Build/Products/Release-iphoneos/App.app Payload/
  zip -qry "WordNov-${APP_VERSION}-unsigned.ipa" Payload
fi
ls -lh ./*.ipa
shasum -a 256 ./*.ipa