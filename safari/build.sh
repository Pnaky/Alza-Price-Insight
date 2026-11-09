#!/bin/bash
# Sestaví „Alza Price Insight.app“ s rozšířením pro Safari. Nepotřebuje Xcode – stačí Command Line Tools
# (xcode-select --install): swiftc, codesign, iconutil a python3 z macOS.
#
# Odkaz na postup: README.md
set -euo pipefail

usage() {
  cat <<'EOF'
Použití: safari/build.sh [--install]

  (bez parametrů)  sestaví safari/build/Alza Price Insight.app
  --install        sestaví, nainstaluje do ~/Applications, zaregistruje rozšíření v Safari a aplikaci spustí

Proměnné prostředí:
  UPSTREAM=<složka>     složka rozšíření s manifest.json (výchozí: kořen tohoto repozitáře)
  SIGN_IDENTITY=<název> podpisová identita, např. "Apple Development: Jan Novák (ABCDE12345)"
                        (seznam: security find-identity -v -p codesigning). Výchozí: jediný platný certifikát
                        Apple Development v klíčence, bez něj "-" = bez certifikátu (ad hoc)
  BUNDLE_ID=<id>        identifikátor aplikace (výchozí local.AlzaPriceInsight)
  INSTALL_DIR=<složka>  kam instalovat (výchozí ~/Applications)
  BUILD_DIR=<složka>    kam sestavit (výchozí safari/build)
EOF
}

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UPSTREAM="${UPSTREAM:-$(cd "$ROOT/.." && pwd)}"
BUILD="${BUILD_DIR:-$ROOT/build}"
SIGN_IDENTITY="${SIGN_IDENTITY:-}"
BUNDLE_ID="${BUNDLE_ID:-local.AlzaPriceInsight}"
EXT_ID="$BUNDLE_ID.Extension"
INSTALL_DIR="${INSTALL_DIR:-$HOME/Applications}"
APP_NAME="Alza Price Insight"
EXT_NAME="Alza Price Insight Extension"
MIN_MACOS="13.0"
JSC=/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc
LSREGISTER=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister

INSTALL=0
for arg in "$@"; do
  case "$arg" in
    --install) INSTALL=1 ;;
    -h | --help) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done

step() { printf '\n==> %s\n' "$*"; }
die() { printf '\nChyba: %s\n' "$*" >&2; exit 1; }

command -v swiftc >/dev/null || die "chybí swiftc – nainstalujte Command Line Tools: xcode-select --install"
SDK="$(xcrun --sdk macosx --show-sdk-path 2>/dev/null)" || die "nenašel jsem macOS SDK – nainstalujte Command Line Tools: xcode-select --install"
[ -f "$UPSTREAM/manifest.json" ] || die "v $UPSTREAM není manifest.json původního rozšíření"
ARCH="$(uname -m)"
VERSION="$(/usr/bin/python3 -I -c 'import json, sys; print(json.load(open(sys.argv[1], encoding="utf-8"))["version"])' "$UPSTREAM/manifest.json")"
BUILD_NUMBER="$(date +%Y%m%d.%H%M)" # CFBundleVersion – každé sestavení vyšší, Safari pak načte nové soubory

# Bez SIGN_IDENTITY: jediný platný certifikát Apple Development v klíčence, jinak ad hoc. Jinak podepsanou verzi
# Safari bere jako jiné rozšíření (s jinými daty) – aktualizace se proto musí podepisovat stejně jako instalace
if [ -z "$SIGN_IDENTITY" ]; then
  IDENTITIES="$(security find-identity -v -p codesigning 2>/dev/null \
    | /usr/bin/sed -n 's/^ *[0-9][0-9]*) [0-9A-F]\{40\} "\(Apple Development: .*\)"$/\1/p' || true)"
  case "$(printf '%s' "$IDENTITIES" | /usr/bin/grep -c . || true)" in
    0) SIGN_IDENTITY="-" ;;
    1) SIGN_IDENTITY="$IDENTITIES" ;;
    *) die "v klíčence je víc certifikátů Apple Development – vyberte ten, kterým je podepsaná nainstalovaná verze:
SIGN_IDENTITY=\"…\" ./build.sh
$IDENTITIES" ;;
  esac
fi
if [ "$SIGN_IDENTITY" = "-" ]; then AD_HOC=true; else AD_HOC=false; fi

# Certifikát v klíčence nestačí – macOS ho musí umět ověřit až ke kořenové autoritě Apple
if [ "$AD_HOC" = false ] && ! security find-identity -v -p codesigning | /usr/bin/grep -qF "$SIGN_IDENTITY"; then
  if security find-identity -p codesigning | /usr/bin/grep -qF "$SIGN_IDENTITY"; then
    die "certifikát \"$SIGN_IDENTITY\" je v klíčence, ale macOS ho neumí ověřit – nejspíš chybí mezicertifikát Apple WWDR G3.
Otevřete https://www.apple.com/certificateauthority/AppleWWDRCAG3.cer, stažený soubor otevřete dvojklikem (přidá se do klíčenky
Přihlášení) a sestavení spusťte znovu. Kontrola: security find-identity -v -p codesigning"
  fi
  die "podpisová identita \"$SIGN_IDENTITY\" nenalezena – seznam: security find-identity -v -p codesigning"
fi

APP="$BUILD/$APP_NAME.app"
APPEX="$APP/Contents/PlugIns/$EXT_NAME.appex"
OBJ="$BUILD/obj"

# --- 1. Soubory rozšíření ---------------------------------------------------------------------------------------
step "Rozšíření $VERSION pro Safari"
rm -rf "$BUILD"
mkdir -p "$OBJ"
/usr/bin/python3 -I "$ROOT/tools/prepare.py" "$UPSTREAM" "$ROOT" "$BUILD/web-extension"

if [ -x "$JSC" ]; then
  step "Kontrola syntaxe JavaScriptu"
  count=0
  while IFS= read -r -d '' file; do
    "$JSC" -e 'checkSyntax(arguments[0])' -- "$file" >/dev/null || die "chyba syntaxe v ${file#"$BUILD/web-extension/"}"
    count=$((count + 1))
  done < <(find "$BUILD/web-extension" -name '*.js' -print0)
  echo "$count souborů v pořádku"
fi

# --- 2. Překlad -------------------------------------------------------------------------------------------------
step "Překlad Swiftu ($ARCH, macOS $MIN_MACOS+)"
SWIFT_FLAGS=(-sdk "$SDK" -target "$ARCH-apple-macos$MIN_MACOS" -swift-version 5 -O -whole-module-optimization)

swiftc "${SWIFT_FLAGS[@]}" -module-name AlzaPriceInsightExtension -parse-as-library -application-extension \
  "$ROOT/macos/Extension/SafariWebExtensionHandler.swift" "$ROOT/macos/Shared/AlzaNotifications.swift" \
  -Xlinker -e -Xlinker _NSExtensionMain -o "$OBJ/extension"

swiftc "${SWIFT_FLAGS[@]}" -module-name AlzaPriceInsight \
  "$ROOT/macos/App/main.swift" "$ROOT/macos/App/AppDelegate.swift" "$ROOT/macos/App/MainWindowController.swift" \
  "$ROOT/macos/Shared/AlzaNotifications.swift" -o "$OBJ/app"

swiftc -sdk "$SDK" -target "$ARCH-apple-macos$MIN_MACOS" -swift-version 5 "$ROOT/macos/Tools/MakeIcon.swift" -o "$OBJ/make-icon"
"$OBJ/make-icon" "$OBJ/AppIcon.iconset"

# --- 3. Balíček -------------------------------------------------------------------------------------------------
step "Balíček $APP_NAME.app"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources" "$APPEX/Contents/MacOS"
cp "$OBJ/app" "$APP/Contents/MacOS/$APP_NAME"
cp "$OBJ/extension" "$APPEX/Contents/MacOS/$EXT_NAME"
iconutil -c icns "$OBJ/AppIcon.iconset" -o "$APP/Contents/Resources/AppIcon.icns"
# Rozšíření pro Safari = složka Resources rozšíření (manifest.json v ní)
ditto "$BUILD/web-extension" "$APPEX/Contents/Resources"

COPYRIGHT="Alza Price Insight © Jan Pňakovič, GNU GPL v3.0. Bez vztahu k Alza.cz a.s."

cat >"$APP/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleDevelopmentRegion</key>
	<string>en</string>
	<key>CFBundleAllowMixedLocalizations</key>
	<true/>
	<key>CFBundleDisplayName</key>
	<string>$APP_NAME</string>
	<key>CFBundleExecutable</key>
	<string>$APP_NAME</string>
	<key>CFBundleIconFile</key>
	<string>AppIcon</string>
	<key>CFBundleIdentifier</key>
	<string>$BUNDLE_ID</string>
	<key>CFBundleInfoDictionaryVersion</key>
	<string>6.0</string>
	<key>CFBundleName</key>
	<string>$APP_NAME</string>
	<key>CFBundlePackageType</key>
	<string>APPL</string>
	<key>CFBundleShortVersionString</key>
	<string>$VERSION</string>
	<key>CFBundleVersion</key>
	<string>$BUILD_NUMBER</string>
	<key>CFBundleSupportedPlatforms</key>
	<array>
		<string>MacOSX</string>
	</array>
	<key>LSApplicationCategoryType</key>
	<string>public.app-category.utilities</string>
	<key>LSMinimumSystemVersion</key>
	<string>$MIN_MACOS</string>
	<key>NSHighResolutionCapable</key>
	<true/>
	<key>NSHumanReadableCopyright</key>
	<string>$COPYRIGHT</string>
	<key>NSPrincipalClass</key>
	<string>NSApplication</string>
	<key>AlzaExtensionBundleIdentifier</key>
	<string>$EXT_ID</string>
	<key>AlzaAdHocSigned</key>
	<$AD_HOC/>
</dict>
</plist>
EOF

cat >"$APPEX/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleDevelopmentRegion</key>
	<string>en</string>
	<key>CFBundleDisplayName</key>
	<string>$APP_NAME</string>
	<key>CFBundleExecutable</key>
	<string>$EXT_NAME</string>
	<key>CFBundleIdentifier</key>
	<string>$EXT_ID</string>
	<key>CFBundleInfoDictionaryVersion</key>
	<string>6.0</string>
	<key>CFBundleName</key>
	<string>$EXT_NAME</string>
	<key>CFBundlePackageType</key>
	<string>XPC!</string>
	<key>CFBundleShortVersionString</key>
	<string>$VERSION</string>
	<key>CFBundleVersion</key>
	<string>$BUILD_NUMBER</string>
	<key>CFBundleSupportedPlatforms</key>
	<array>
		<string>MacOSX</string>
	</array>
	<key>LSMinimumSystemVersion</key>
	<string>$MIN_MACOS</string>
	<key>NSHumanReadableCopyright</key>
	<string>$COPYRIGHT</string>
	<key>NSExtension</key>
	<dict>
		<key>NSExtensionPointIdentifier</key>
		<string>com.apple.Safari.web-extension</string>
		<key>NSExtensionPrincipalClass</key>
		<string>SafariWebExtensionHandler</string>
	</dict>
</dict>
</plist>
EOF
plutil -lint -s "$APP/Contents/Info.plist" "$APPEX/Contents/Info.plist"

# --- 4. Podpis --------------------------------------------------------------------------------------------------
if [ "$AD_HOC" = true ]; then step "Podpis ad hoc (bez certifikátu)"; else step "Podpis: $SIGN_IDENTITY"; fi
# Nejdřív vnořené rozšíření, pak aplikace. Obojí v sandboxu (Safari rozšíření bez sandboxu nenačte)
codesign --force --sign "$SIGN_IDENTITY" --options runtime --timestamp=none \
  --entitlements "$ROOT/macos/Extension/Extension.entitlements" "$APPEX"
codesign --force --sign "$SIGN_IDENTITY" --options runtime --timestamp=none \
  --entitlements "$ROOT/macos/App/App.entitlements" "$APP"
codesign --verify --deep --strict "$APP" || die "podpis aplikace neprošel kontrolou"
echo "Podpis v pořádku"

printf '\nHotovo: %s\n' "$APP"

# --- 5. Instalace -----------------------------------------------------------------------------------------------
if [ "$INSTALL" = 1 ]; then
  TARGET="$INSTALL_DIR/$APP_NAME.app"
  step "Instalace do $INSTALL_DIR"
  pkill -x "$APP_NAME" 2>/dev/null && sleep 1 || true # Běžící starší verze aplikace
  mkdir -p "$INSTALL_DIR"
  rm -rf "$TARGET"
  ditto "$APP" "$TARGET"
  # Safari má znát jen nainstalovanou kopii – sestavenou v build/ odregistrovat
  "$LSREGISTER" -u "$APP" >/dev/null 2>&1 || true
  pluginkit -r "$APPEX" >/dev/null 2>&1 || true
  "$LSREGISTER" -f -R "$TARGET"
  pluginkit -a "$TARGET/Contents/PlugIns/$EXT_NAME.appex" || true
  [ "${NO_OPEN:-0}" = 1 ] || open "$TARGET"
  printf '\nNainstalováno: %s\nDalší kroky jsou v okně aplikace a v README.md.\n' "$TARGET"
fi
