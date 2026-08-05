#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "BinGO native iPad build must run on macOS."
  exit 1
fi

command -v xcodebuild >/dev/null || { echo "Install Xcode first."; exit 1; }
if ! command -v xcodegen >/dev/null; then
  command -v brew >/dev/null || { echo "Install Homebrew, then run: brew install xcodegen"; exit 1; }
  brew install xcodegen
fi

cd "$(dirname "$0")"
xcodegen generate
xcodebuild -project BinGO.xcodeproj -scheme BinGO -showdestinations
echo "Generated ios/BinGO/BinGO.xcodeproj. Open it in Xcode and select your iPad signing team."
