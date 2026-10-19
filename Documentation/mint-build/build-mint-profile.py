"""Builds app/mint-profile.js from this folder's parts. Run: python build-mint-profile.py   (plain Python 3, no packages needed)
Parts: mint-profile.template.css (tokens + rules), Light/Regular/Bold.woff2 (made by subset-fonts.py from the official Lato 2.015 TTFs),
mint-logo-primary.svg (official logo from the Mint brand skill), Lato-OFL.txt (the licence that comes with the font).
Values that depend on measurement are in VALUES below."""
import base64, json, os, re, sys
here = os.path.dirname(os.path.abspath(__file__))
app = os.path.join(here, "..", "..", "app", "mint-profile.js")

VALUES = json.load(open(os.path.join(here, "mint-values.json"), encoding="utf-8"))

def datauri(path, mime):
    return "data:" + mime + ";base64," + base64.b64encode(open(os.path.join(here, path), "rb").read()).decode()

dark = VALUES["dark_block"]
css = open(os.path.join(here, "mint-profile.template.css"), encoding="utf-8").read()
css = css.replace("{{DARK}}", dark)
for k, v in VALUES["light"].items():
    css = css.replace("{{" + k + "}}", str(v))
css = css.replace("{{FONT_LIGHT}}", datauri("Light.woff2", "font/woff2")).replace("{{FONT_REGULAR}}", datauri("Regular.woff2", "font/woff2")).replace("{{FONT_BOLD}}", datauri("Bold.woff2", "font/woff2")).replace("{{FONT_ITALIC}}", datauri("Italic.woff2", "font/woff2"))
css = css.replace("{{LOGO}}", datauri("mint-logo-primary.svg", "image/svg+xml"))
left = re.findall(r"\{\{[A-Z_]+\}\}", css)
if left: sys.exit("unfilled placeholders: " + ", ".join(sorted(set(left))))
ofl = open(os.path.join(here, "Lato-OFL.txt"), encoding="utf-8").read().replace("*/", "* /")

js = f"""/* NoteTaker optional profile: Mint. Delete this file and the app runs in Default (the Mint choice is not offered).
   Contains: the Mint tokens (light and dark), a Latin subset of the Lato typeface, and the Mint Group logo. Built by Documentation/mint-build/build-mint-profile.py.

   FONT NOTICE (SIL Open Font License 1.1, condition 2): the embedded font is a modified version (Latin subset, WOFF2) of Lato 2.015,
   Copyright (c) 2010-2015 by tyPoland Lukasz Dziedzic (dziedzic@typoland.com) with Reserved Font Name "Lato".
   Because it is modified it carries a different name ("NT Brand Sans"), as condition 3 requires. Original: http://www.latofonts.com/ . The licence follows.

{ofl}
*/
(function () {{
  var css = {json.dumps(css)};
  var el = document.createElement("style"); el.id = "mint-profile-css"; el.textContent = css;
  document.head.appendChild(el);
  window.NoteTakerMint = {{ available: true }};
  document.addEventListener("DOMContentLoaded", function () {{
    var slot = document.getElementById("logoSlot");
    if (slot) {{ slot.setAttribute("role", "img"); slot.setAttribute("aria-label", "Mint Group - Create tomorrow"); }}
  }});
}})();
"""
open(app, "w", encoding="utf-8", newline="\n").write(js)
print("wrote", os.path.normpath(app), os.path.getsize(app), "bytes")
for f in ("Light", "Regular", "Bold", "Italic"):
    print(" ", f + ".woff2", os.path.getsize(os.path.join(here, f + ".woff2")), "bytes ->", len(datauri(f + ".woff2", "font/woff2")), "chars as base64")
print("  logo svg", os.path.getsize(os.path.join(here, "mint-logo-primary.svg")), "bytes ->", len(datauri("mint-logo-primary.svg", "image/svg+xml")), "chars as base64")
