#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

swift_sources=(App Models Networking Persistence Services Views)

if command -v rg >/dev/null; then
  forbidden_matches="$(rg -n 'WKWebView|import WebKit|https?://[^" ]+.*(load|open)' "${swift_sources[@]}" --glob '*.swift' || true)"
else
  forbidden_matches="$(grep -RInE --include='*.swift' 'WKWebView|import WebKit|https?://[^" ]+.*(load|open)' "${swift_sources[@]}" || true)"
fi

if [[ -n "$forbidden_matches" ]]; then
  printf '%s\n' "$forbidden_matches"
  echo "Native validation failed: web-view or remote-page code found."
  exit 1
fi

required_frameworks=(SwiftUI SwiftData PencilKit PDFKit Vision Speech AVFoundation)
for framework in "${required_frameworks[@]}"; do
  if command -v rg >/dev/null; then
    framework_found="$(rg -l "import ${framework}" "${swift_sources[@]}" | head -n 1)"
  else
    framework_found="$(grep -RIl --include='*.swift' "import ${framework}" "${swift_sources[@]}" | head -n 1)"
  fi
  if [[ -z "$framework_found" ]]; then
    echo "Native validation failed: missing ${framework} integration."
    exit 1
  fi
done

bash -n bootstrap-mac.sh validate-native-ios.sh
echo "Static native iPad checks passed."

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Apple SDK build skipped: run this script again on the Mac."
  exit 0
fi

command -v plutil >/dev/null
command -v xcodebuild >/dev/null
command -v xcodegen >/dev/null || {
  echo "Install XcodeGen first: brew install xcodegen"
  exit 1
}

plutil -lint Resources/Info.plist Resources/BinGO.entitlements
xcodegen generate
xcodebuild build \
  -project BinGO.xcodeproj \
  -scheme BinGO \
  -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=NO

ipad_udid="$(xcrun simctl list devices available | sed -nE '/iPad/{s/.*\(([0-9A-Fa-f-]{36})\) \((Booted|Shutdown)\).*/\1/p;q;}')"
if [[ -n "$ipad_udid" ]]; then
  xcodebuild test \
    -project BinGO.xcodeproj \
    -scheme BinGO \
    -destination "platform=iOS Simulator,id=${ipad_udid}" \
    CODE_SIGNING_ALLOWED=NO
else
  echo "No iPad Simulator is installed; build passed and tests were skipped."
fi
