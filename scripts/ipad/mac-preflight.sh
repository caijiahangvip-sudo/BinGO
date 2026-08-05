#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "BinGO iPad preflight must run on macOS." >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

command -v xcodebuild >/dev/null || {
  echo "Xcode command-line tools are required." >&2
  exit 1
}
command -v rustup >/dev/null || {
  echo "rustup is required." >&2
  exit 1
}
command -v corepack >/dev/null || {
  echo "Corepack is required." >&2
  exit 1
}

echo "--- Xcode ---"
xcodebuild -version
echo "--- Apple SDK ---"
xcrun --sdk iphoneos --show-sdk-version
echo "--- Rust iOS targets ---"
rustup target list --installed | grep -E 'aarch64-apple-ios($|-sim)' || {
  echo "Install iOS Rust targets before building:"
  echo "  rustup target add aarch64-apple-ios aarch64-apple-ios-sim"
  exit 1
}
echo "--- BinGO platform configuration ---"
node scripts/validate-platform-builds.mjs
echo "iPad build preflight passed."
