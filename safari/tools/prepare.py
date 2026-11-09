#!/usr/bin/env python3
"""Sestaví soubory rozšíření pro Safari ze společného zdroje (Chrome / Firefox) a Safari vrstvy (safari/src/safari/).

    python3 -I prepare.py <kořen repozitáře> <složka safari> <výstup>

- zkopíruje z <upstream> jen to, co rozšíření potřebuje (bez testů, dokumentace a kódu jen pro Chrome / Firefox),
- přidá soubory Safari vrstvy (src/safari/),
- vytvoří manifest pro Safari (stránka na pozadí místo service workeru, bez offscreen, s nativeMessaging),
- vloží do průvodce náhradu notifikací a texty pro Safari.

Každá úprava hledá přesný text původního souboru. Když ho nová verze rozšíření změní, skript skončí chybou,
místo aby tiše sestavil nefunkční rozšíření.
"""

import json
import shutil
import sys
from pathlib import Path

COPY = ["_locales", "css", "img", "src", "LICENSE"]
SKIP_DIRS = {"src/chrome", "src/firefox"}  # offscreen dokument / stránka na pozadí jen pro Firefox

PRODUCT_PAGES = {"src/chrome/product-pages.js", "src/firefox/product-pages.js"}
SAFARI_PRODUCT_PAGES = "src/safari/product-pages.js"
SAFARI_NOTIFICATIONS = "src/safari/notifications.js"

# (soubor, původní text, nový text) – původní text se musí v souboru najít právě jednou
PATCHES = [
    (
        "src/welcome/welcome.html",
        '    <script src="../shared/core.js"></script>\n',
        '    <script src="../safari/notifications.js"></script>\n    <script src="../shared/core.js"></script>\n',
    ),
    (
        "src/welcome/welcome.html",
        '    <script src="welcome-texts.js"></script>\n',
        '    <script src="welcome-texts.js"></script>\n    <script src="../safari/welcome-safari.js"></script>\n',
    ),
]


def fail(message):
    print(f"prepare.py: {message}", file=sys.stderr)
    sys.exit(1)


def copy_upstream(upstream, out):
    for name in COPY:
        source = upstream / name
        if not source.exists():
            fail(f"v původním rozšíření chybí {name}")
        if source.is_dir():
            shutil.copytree(
                source,
                out / name,
                ignore=lambda directory, names: [
                    n for n in names
                    if n.startswith(".") or (Path(directory) / n).relative_to(upstream).as_posix() in SKIP_DIRS
                ],
            )
        else:
            shutil.copy2(source, out / name)


def make_manifest(upstream, out):
    manifest = json.loads((upstream / "manifest.json").read_text(encoding="utf-8"))
    if manifest.get("manifest_version") != 3:
        fail("očekávám manifest_version 3")

    manifest.pop("minimum_chrome_version", None)
    settings = manifest.get("browser_specific_settings") or {}
    settings.pop("gecko", None)
    settings["safari"] = {"strict_min_version": "18.0"}
    manifest["browser_specific_settings"] = settings

    permissions = [p for p in manifest.get("permissions", []) if p != "offscreen"]
    if "nativeMessaging" not in permissions:
        permissions.append("nativeMessaging")  # notifikace přes aplikaci (src/safari/notifications.js)
    manifest["permissions"] = permissions

    background = manifest.get("background") or {}
    scripts = background.get("scripts")
    if not scripts:
        fail("manifest nemá background.scripts (seznam skriptů stránky na pozadí)")
    scripts = [SAFARI_PRODUCT_PAGES if s in PRODUCT_PAGES else s for s in scripts]
    if SAFARI_PRODUCT_PAGES not in scripts:
        fail("v background.scripts chybí product-pages.js pro Firefox / Chrome")
    # Safari: nestálá stránka na pozadí (service worker by potřeboval offscreen dokument pro DOMParser)
    manifest["background"] = {"scripts": [SAFARI_NOTIFICATIONS, *scripts], "persistent": False}

    (out / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return manifest


def apply_patches(out):
    for relative, old, new in PATCHES:
        path = out / relative
        text = path.read_text(encoding="utf-8")
        count = text.count(old)
        if count != 1:
            fail(f"úprava {relative}: původní text nalezen {count}× (čekám 1×) – změnila se nová verze rozšíření?\n{old}")
        path.write_text(text.replace(old, new), encoding="utf-8")


def check_references(manifest, out):
    files = list(manifest["background"]["scripts"])
    for script in manifest.get("content_scripts", []):
        files += script.get("js", []) + script.get("css", [])
    files += list((manifest.get("icons") or {}).values())
    files.append((manifest.get("action") or {}).get("default_popup"))
    files.append((manifest.get("options_ui") or {}).get("page"))
    missing = [f for f in files if f and not (out / f).is_file()]
    if missing:
        fail("manifest odkazuje na chybějící soubory: " + ", ".join(missing))


def main():
    if len(sys.argv) != 4:
        fail("použití: prepare.py <upstream> <safari-overlay> <out>")
    upstream, overlay, out = (Path(arg).resolve() for arg in sys.argv[1:])
    if not (upstream / "manifest.json").is_file():
        fail(f"{upstream} neobsahuje manifest.json")
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)

    copy_upstream(upstream, out)
    shutil.copytree(overlay / "src" / "safari", out / "src" / "safari")
    manifest = make_manifest(upstream, out)
    apply_patches(out)
    check_references(manifest, out)
    print(f"Rozšíření pro Safari {manifest['version']} připraveno v {out}")


if __name__ == "__main__":
    main()
