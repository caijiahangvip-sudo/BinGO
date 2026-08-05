#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This script must run on macOS with Xcode installed." >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
node scripts/validate-platform-builds.mjs
corepack enable
pnpm install --frozen-lockfile

if [[ ! -d src-tauri/gen/apple ]]; then
  pnpm tauri ios init
fi

PROJECT="$(find src-tauri/gen/apple -maxdepth 2 -name '*.xcodeproj' -print -quit)"
if [[ -z "$PROJECT" ]]; then
  echo "Tauri did not generate an Xcode project." >&2
  exit 1
fi

SCHEME="$(xcodebuild -project "$PROJECT" -list -json | python3 -c 'import json,sys; data=json.load(sys.stdin); schemes=data.get("project",{}).get("schemes",[]); print(next((s for s in schemes if "ios" in s.lower()), schemes[0] if schemes else ""))')"
if [[ -z "$SCHEME" ]]; then
  echo "No iOS Xcode scheme was found." >&2
  exit 1
fi

DERIVED="$ROOT/.ipad-build"
rm -rf "$DERIVED"
xcodebuild \
  -project "$PROJECT" \
  -scheme "$SCHEME" \
  -configuration release \
  -sdk iphoneos \
  -derivedDataPath "$DERIVED" \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  build

APP="$(find "$DERIVED/Build/Products" -path '*iphoneos/*.app' -print -quit)"
if [[ -z "$APP" ]]; then
  echo "Unsigned iPad app was not produced." >&2
  exit 1
fi

ARTIFACTS="$ROOT/artifacts/ipad"
PAYLOAD="$DERIVED/Payload"
rm -rf "$PAYLOAD"
mkdir -p "$PAYLOAD" "$ARTIFACTS"
cp -R "$APP" "$PAYLOAD/"
(
  cd "$DERIVED"
  /usr/bin/zip -qry "$ARTIFACTS/BinGO-iPad-unsigned.ipa" Payload
)
echo "$ARTIFACTS/BinGO-iPad-unsigned.ipa"
