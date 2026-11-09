#!/usr/bin/env python3
"""Testovací stránky pro WebHarness (tests/run.sh): <work>/background.html a <work>/ext/src/welcome/welcome-test.html.

Stránka na pozadí načte skripty v pořadí z manifestu pro Safari, průvodce je kopie welcome.html z rozšíření
pro Safari. Před skripty rozšíření jde vždy napodobenina API Safari (mock-safari.js), na konec test.
"""

import html
import json
import sys
from pathlib import Path

work = Path(sys.argv[1]).resolve()
ext = work / "ext"
manifest = json.loads((ext / "manifest.json").read_text(encoding="utf-8"))
manifest_script = f"<script>window.__MANIFEST__ = {json.dumps(manifest, ensure_ascii=False)};</script>"


def tag(src):
    return f'<script src="{html.escape(src)}"></script>'


background = "\n".join(
    [
        "<!doctype html>",
        '<meta charset="utf-8">',
        "<title>Safari background test</title>",
        "<script>window.__FAKE_TIMERS__ = true;</script>",
        manifest_script,
        tag("mock-safari.js"),
        *(tag(f"ext/{script}") for script in manifest["background"]["scripts"]),
        tag("background.test.js"),
        "",
    ]
)
(work / "background.html").write_text(background, encoding="utf-8")

welcome = (ext / "src/welcome/welcome.html").read_text(encoding="utf-8")
first_script = welcome.index("<script src=")
welcome = welcome[:first_script] + manifest_script + "\n    " + tag("../../../mock-safari.js") + "\n    " + welcome[first_script:]
end = welcome.rindex("</body>")
welcome = welcome[:end] + "  " + tag("../../../welcome.test.js") + "\n  " + welcome[end:]
(ext / "src/welcome/welcome-test.html").write_text(welcome, encoding="utf-8")
