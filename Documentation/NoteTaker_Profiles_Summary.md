# NoteTaker profiles - close-out summary

**Built:** 13-14 October 2026 | **Status:** complete, accepted | **Browser:** Chrome (Windows 11) | **Address:** `http://localhost:47613/` (unchanged)

This file is a self-contained summary of the "profiles" work (a new look for the app, and an optional second look). The summary of the app itself is `Documentation/NoteTaker_Project_Summary.md`; the full running log, with every decision and change, is `Documentation/Phase1_Build_Notes.md` (the "Profiles" sections at the end).

---

## 1. What it is and why

The app's look was replaced by the user's **personal brand** (the **Default** profile), and an **optional Mint profile** (Mint Group's brand) was added behind a switch. The aim was a branded look in light and dark without touching how the app saves, backs up or organises text. The save routine, title lock, IndexedDB data, crash backup, Open, search, pin, collapse, order, drag, the server, the launcher and port 47613 were not changed. Chrome only; the app is still one HTML file (`index.html`), plus one optional file (`mint-profile.js`).

## 2. What it does (final state)

**Default profile** (always available): Arial; palette Midnight #253D52, Warm gray #525254, Mist #EEF2F7, Muted blue #4880AE, Soft sky #A0C2DB, Muted Blue Dark #325A7A, white. White cards on a Mist canvas, a low-opacity circle fixed at the top right of the window, no shadows, no accent stripes. Dark mode is the user's proposal (the brand defines none). Headings 18 px bold. Text area stays monospace (Consolas) and 400 px high.

**Mint profile** (only if `mint-profile.js` is present): Mint's palette, Lato (embedded, renamed "NT Brand Sans"), rounded cards (20 px) and pill buttons, heading 24 px Lato Light, orange call-to-action button with a bold #243C7A label, the Mint logo (190 px, official artwork, never recoloured; on a light plate #CFD8DB in dark) at the top of the container-list column, left-aligned and pinned with it.

**Switch and themes:** a "Profile" label and a **Default | Mint** control in the second header row, beside the dark/light button (labels unchanged: "☾ Dark" / "☀ Light"). Profile and light/dark are independent, so there are four looks. Both choices are remembered in the browser (`notetaker-profile`, `notetaker-theme`). With no manual theme the system setting decides, live.

**Header:** two rows, the whole header sticky, 76 px high in all four looks (row 1 heading; row 2 backup line, New container, Open file..., count, Profile control, theme button).

**When Mint is missing:** the Profile control is not shown. If Mint was the stored choice the app shows Default, says so once per page load in the usual dismissible banner, and keeps the stored choice so Mint returns when the file does.

## 3. How it is built

| Item | Detail |
|---|---|
| Tokens | Every colour, radius, font, weight and heading size is a CSS variable (52 in all). Default tokens are on `:root` (light) and in two dark blocks; Mint overrides them with `:root[data-profile="mint"]` selectors (profile x system dark x manual theme). Reference table: end of `Phase1_Build_Notes.md`. |
| Loading | `index.html` loads `mint-profile.js` as a **blocking script in `<head>`** with an `onerror` flag; the file adds its `<style>` before the first paint, and a small inline script sets `data-profile="mint"` on `<html>` when chosen. No flash of Default, no font swap (tested frame by frame). |
| Missing file | One 404 line in the server log and one in the browser console on every load; nothing is thrown. Accepted. |
| Mint file | `mint-profile.js` (about 273 KB): Mint tokens, four embedded Latin font faces (Light, Regular, Bold, Italic; 41-44 KB each), the logo, and the font's licence notice. Built by `Documentation/mint-build/build-mint-profile.py`. |
| Font licence | Lato 2.015, SIL Open Font License 1.1, Reserved Font Name "Lato". A Latin subset is a "modified version", so it is renamed internally to **NT Brand Sans** (the user approved this). Source URL, SHA-256 of each source file and the exact subset steps are in the build notes, so the fonts can be regenerated. |
| Network | Nothing leaves localhost: no Google Fonts, no external request (asserted by a test). |
| Header height | `--hdr` is kept equal to the header's real height by a ResizeObserver, and `headerPx()` reads it for scroll logic. |

## 4. Decisions the user made (highlights)

- Default = personal brand, replacing the old look; Mint optional, in a separate file; the app works fully without it.
- Colours from the approved mockup (`Documentation/NoteTaker-Profiles-mockup.html`); Mint hexes never altered. Fixes for contrast failures use other palette colours and were approved one by one (list in the build notes).
- Semantic colours (backup ok / failed, warnings, panels) are the app's own, with a value per look; never Mint's wine.
- Logo placement: after comparing five options (a to e), **option (d)**: top of the list column. Heading: 24 px in Mint, 18 px in Default. (updated 2026-10-14: the option screenshots and the prototype script were moved to `_to_delete/` on 14 Oct (manifest: `Documentation/MANIFEST.txt`, a copy of `_to_delete/MANIFEST.txt`) and may have been deleted since.)
- "New container" in Mint stays orange with a bold #243C7A label and no outline, although its fill is 2.62:1 on white (its label is 4.01:1, which passes as large bold text).
- A real Lato Italic was added because the app's "untitled" header entries are italic.
- The mockup's extras (tagline, green rule, saved-check badge, "Linked to..." line, SVG icons, search in the toolbar) were **not** added.

## 5. Testing

| | Unit | Real Chrome |
|---|---|---|
| Original suites (phases 1-4: containers, saving, organising, opening) | 182 | 277 |
| Profiles Phase 2: Default look, header, contrast | - | 62 |
| Profiles Phase 3: switch, Mint, loading, no flash, logo, rules, contrast and hover in all four looks, radios, network | 20 | 135 |
| Profiles Phase 4: real header height, ensureVisible, `--hdr` in step | - | 56 |
| **Total** | **202** | **530** |

All pass: 732 checks. Run with `node Testing/<name>.mjs` (Node and Chrome; each browser test starts its own throwaway Chrome profile and server and never touches real data). The Phase 3 browser test takes about 25 minutes (`QUICK=1` runs only its contrast section).

- **Contrast is measured from the rendered page**, not from token values: every kind of text, every border, ring and icon, keyboard focus rings, and hover and pressed states (Chrome's forced pseudo-states), in all four looks at 1920 and 1366 px, including the corner circle's tint and see-through borders. Targets: text 4.5:1 (large text 3:1), borders, rings and focus 3:1. **One item is below target: the Mint orange button's fill on white (2.62:1), accepted.** Lowest figures per look are in the build notes.
- **Mutation checks:** a Mint token changed by one unit fails 4 checks; a Mist-gray border fails the contrast tests; the old constant 52 for the header height fails the new header tests and the tightened Phase 1 test.
- **Evidence tools:** computed-style fingerprints (195 elements x 20 properties) and screenshots for all four looks (`Documentation/four-looks-final/`), `Testing/profiles-visual.mjs`, `Testing/png-diff.mjs`, `Testing/profiles-glyph-audit.mjs` (every use of Mint orange or green).
- **Bug found by the work and fixed:** the app's scroll logic used a hard-coded header height of 52 px that went stale when the header grew; containers brought into view could end up partly behind the header (24-64 px). It now reads the real height. Existing tests that hard-coded 52 were tightened (list in the build notes).
- **Manual only:** how the looks feel in the user's own Chrome (hover, press, the thin Lato Light heading, the logo), a real missing-file case, the real Windows file dialogs (unchanged).

## 6. Known limits and things not done

- Mint is the only extra profile; no other profiles were added.
- The Mint orange button's fill is below the 3:1 boundary target on white (accepted); every other pair is at or above target.
- The corner circle is fixed to the window (it does not scroll away): the sticky header is opaque, so a page-anchored circle would be hidden under it. Kept by decision.
- Lato Light at 24 px is thin by design; the logo's tagline is small at 190 px.
- The missing-file 404 (server log and console) appears on every load of any copy without `mint-profile.js`.
- The font subset is Latin only (the app's own text is Latin; characters outside it fall back to Arial). The theme button's moon and sun, the lock emoji and the list symbols are drawn by the fallback font.

## 7. Maintenance notes

- **Change a colour or size:** Default values are in `app/index.html` (`<style>`, top); Mint values are in `Documentation/mint-build/mint-values.json` and `mint-profile.template.css`, then run `python Documentation/mint-build/build-mint-profile.py`. Re-run the suites and Ctrl+F5.
- **Remove Mint:** delete `app/mint-profile.js` (the Mint option disappears; a stored Mint choice falls back to Default with one banner).
- **Roll back:** `Documentation/index.profiles-final.html` and `mint-profile.profiles-final.js` (final), `index.profiles-phase3.html` / `mint-profile.profiles-phase3.js` (logo option (a) in the header), `index.profiles-phase2.html` (Default look, no switch), `index.before-profiles.html` (before any profile work).
- **Regenerate the fonts:** see "REFERENCE: the Mint profile and how it is made" in the build notes (needs a throwaway virtual environment with fonttools and brotli, and a fresh download of the official Lato zip).
- **After an app update:** Ctrl+F5 (the server sends no-cache, but a hard refresh is safest).

## 8. Share package (rebuilt 14 Oct 2026)

(updated 2026-10-14: this section used to say the package had not been rebuilt; it was rebuilt, and the text below replaces that.) The package was **rebuilt on 14 Oct 2026**: `Share/NoteTaker-share-20261014.zip` (27,056 bytes, SHA-256 `adcb5a1379a6982cb740b8fe68fee9cc278e7e317216b46c6f321265b855cb24`). It holds five files in a `NoteTaker/` folder: `app/index.html` (the final app, SHA-256 `d95081162cfb8a603a1790f7f832adaf3ead2f01a1f0b8afca40e8eeef5d986c`), `Launcher/serve.py` and `Start NoteTaker.bat` (both unchanged from the 13 Oct package), and `README.txt` and `VERSION.txt` (both updated). **It does not include `mint-profile.js`**, so Mint is not offered and the friend's copy shows the user's personal brand as the Default look. The README gained a short paragraph about the light and dark look and a plain-words note that each time the page opens it asks for the optional `mint-profile.js`, is told "not found" (a 404) and simply uses its normal look; that line is expected and harmless, and it can be seen only in Chrome's developer tools (F12, Console), never in the black server window (the package's `serve.py` prints no request lines). `VERSION.txt` has the new build date, the new `index.html` hash and a line about the look and the expected 404.

**How it was verified:** from a clean extraction in a new empty folder. The zip tests clean and holds exactly those five files. A personal-reference check found no drive paths, OneDrive, user name, email or test ports, and no Mint colours, Lato or logo. The package's own `serve.py` was run on a test port: 200 with the no-cache and marker headers; 404 for `mint-profile.js`, the README, `VERSION.txt`, `serve.py`, the `.bat` and path-escape attempts; reachable on 127.0.0.1 only; a second start says it is already running; nothing is printed to the black window. The packaged app was opened in real Chrome: Default look, no Profile control, exactly one 404 for `mint-profile.js` per page load, no other errors, only localhost requests, containers and the dark/light button working, and a copy that once had Mint chosen shows Default with one dismissible banner. The existing suites were run against the packaged `index.html`: existing unit 182 and browser 277, profiles Phase 3 unit 20, profiles Phase 2 browser 62 and profiles Phase 4 browser 56, all passing (the profiles Phase 3 browser suite does not apply to a package without `mint-profile.js`).

Sending the package to the friend is a separate step and is not covered here.
## 9. How the work was run (what worked)

A "Step 0" first (what the app already has, how colours were defined, the open decisions), then four phases with a stop after each: (1) tokens only, proven by computed-style fingerprints identical before and after; (2) the Default look and two-row header; (3) the switch, the Mint file, the logo, fonts and persistence; (4) the real header height, final audit and documentation. Every contrast figure was measured from the rendered page; every failure was shown with its ratio and a palette-based alternative and approved before it stayed; evidence was kept for each phase (fingerprints, screenshots, snapshots of the app).
