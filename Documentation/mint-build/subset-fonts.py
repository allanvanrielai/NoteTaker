"""Regenerates the four embedded font files (Light, Regular, Bold, Italic .woff2) from the official Lato 2.015 TTFs.
Usage:  python subset-fonts.py <folder with the Lato2OFL TTFs> <output folder>
Needs fonttools and brotli (made with fonttools 4.66.1 and the brotli wheel current on 2026-10-13; use a throwaway virtual environment).
Source: https://www.latofonts.com/files/Lato2OFL.zip (SHA-256 of each source file is in Documentation/Phase1_Build_Notes.md).

What it does to each font (an OFL "Modified Version", so it is renamed: condition 3 forbids the Reserved Font Name "Lato"):
  1. Subset to Google's "latin" range (below); all OpenType layout features kept (layout_features = ["*"]); .notdef outline kept; glyph names dropped; hinting kept.
  2. Save as WOFF2.
  3. Rename: family (name IDs 1 and 16) = "NT Brand Sans"; full name (4) = "NT Brand Sans <style>"; PostScript name (6) = "NTBrandSans-<style>";
     unique ID (3) = "NTBrandSans-<style>;subset of Lato 2.015". Copyright (0) and licence (13, 14) entries are untouched.
"""
import os, sys
from fontTools import subset
from fontTools.ttLib import TTFont

SRC, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
RANGE = "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+2074,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD"
FAMILY = "NT Brand Sans"
for style, wt in [("Light", 300), ("Regular", 400), ("Bold", 700), ("Italic", 400)]:
    opts = subset.Options(); opts.flavor = "woff2"; opts.layout_features = ["*"]; opts.name_IDs = ["*"]; opts.notdef_outline = True; opts.glyph_names = False
    f = TTFont(os.path.join(SRC, f"Lato-{style}.ttf"))
    sub = subset.Subsetter(opts); sub.populate(unicodes=subset.parse_unicodes(RANGE)); sub.subset(f)
    for rec in list(f["name"].names):
        if rec.nameID in (1, 16): rec.string = FAMILY
        elif rec.nameID == 4: rec.string = f"{FAMILY} {style}"
        elif rec.nameID == 6: rec.string = f"NTBrandSans-{style}"
        elif rec.nameID == 3: rec.string = f"NTBrandSans-{style};subset of Lato 2.015"
    f.flavor = "woff2"; target = os.path.join(OUT, f"{style}.woff2"); f.save(target)
    g = TTFont(target)
    print(style, wt, os.path.getsize(target), "bytes;", len(g.getGlyphOrder()), "glyphs;", len(g.getBestCmap()), "codepoints; family:", g["name"].getDebugName(1))
