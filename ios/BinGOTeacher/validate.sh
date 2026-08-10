#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
test -f project.yml
test -f Sources/TeacherApp.swift
test -f Sources/APIClient.swift
test -f Sources/TeacherViews.swift
grep -R "WKWebView\|WebView" Sources && { echo "WebView is not allowed" >&2; exit 1; } || true
echo "BinGO Teacher native Apple source checks passed."
