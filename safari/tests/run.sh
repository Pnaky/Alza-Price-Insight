#!/bin/bash
# Testy Safari vrstvy ve WebKitu (WKWebView – stejný engine jako Safari) a nativní části, bez Safari a bez instalace:
#   safari/tests/run.sh
# Stránka na pozadí a průvodce běží s napodobeným API Safari (tests/mock-safari.js) – bez chrome.notifications,
# nativní aplikaci zastupuje mock. Ceny ze stránek Alzy test nestahuje (parser je stejný jako v Chrome / Firefoxu).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UPSTREAM="${UPSTREAM:-$(cd "$ROOT/.." && pwd)}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/alza-safari-tests.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

/usr/bin/python3 -I "$ROOT/tools/prepare.py" "$UPSTREAM" "$ROOT" "$WORK/ext" >/dev/null
cp "$ROOT/tests/mock-safari.js" "$ROOT/tests/background.test.js" "$ROOT/tests/welcome.test.js" "$WORK/"
/usr/bin/python3 -I "$ROOT/tests/make-pages.py" "$WORK"
SDK="$(xcrun --sdk macosx --show-sdk-path)"
swiftc -O -sdk "$SDK" "$ROOT/tests/WebHarness.swift" -o "$WORK/WebHarness"
swiftc -sdk "$SDK" -swift-version 5 "$ROOT/tests/NativeTests/main.swift" \
  "$ROOT/macos/Extension/SafariWebExtensionHandler.swift" "$ROOT/macos/Shared/AlzaNotifications.swift" -o "$WORK/NativeTests"

status=0
echo "== Stránka na pozadí"
"$WORK/WebHarness" "$WORK/background.html" "$WORK" || status=1
echo
echo "== Průvodce nastavením"
"$WORK/WebHarness" "$WORK/ext/src/welcome/welcome-test.html" "$WORK" || status=1
echo
echo "== Nativní část (SafariWebExtensionHandler)"
"$WORK/NativeTests" || status=1
exit $status
