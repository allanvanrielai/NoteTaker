# NoteTaker: icon, manifest and profile-pinned launcher

Date: 2026-10-18 16:16

## What you asked for
Give NoteTaker the same icon approach as Image Keeper, and open it in the Chrome profile "APPS". You confirmed: option 2 (Notepad), the same icon in Default and Mint, `Profile 5`, permission to edit NoteTaker, and to ignore the `Share` folder and `The_Share.zip` for now.

## What I changed in NoteTaker (`F:\OneDrive\AI\NoteTaker`)
**Existing file edited: `app\index.html`, two lines added after the viewport meta tag, nothing else.**
```html
<link rel="icon" href="favicon.ico" sizes="16x16 24x24 32x32 48x48 64x64">
<link rel="manifest" href="manifest.webmanifest">
```
A `diff` against the snapshot confirms these are the only two differences.

**Snapshot taken first:** `Documentation\index.before-icon.html` (byte-identical to the original `index.html`).

**New files in `app\` (served on port 47613):** `favicon.ico` (16, 24, 32, 48, 64 px, bold art only), `icon-32/48/64/192/512.png`, `manifest.webmanifest` (name "NoteTaker", installable).

**New files in `Launcher\` (not served):**
- `notetaker.ico` (16 to 256 px, for shortcuts)
- `open-notetaker-app.bat` (starts the server if needed, then opens the app window in `Profile 5`)
- `NoteTaker.lnk`, a ready shortcut to copy or pin

Shortcut target line:
`"C:\Program Files\Google\Chrome\Application\chrome.exe" --profile-directory="Profile 5" --app=http://localhost:47613/`

**Not touched:** `mint-profile.js`, `serve.py`, the start scripts, `Share`, `The_Share.zip`, the `Testing` folder, the `DATA` folder. The server did not need a restart; it already serves the new files.

## Icon
Option 2 (notepad with binding rings and ruled lines). The art is detailed for 96 px and above, and simplified for 64 px and below, with `favicon.ico` holding only the bold small frames (Chrome scales the largest frame down for the window icon). The icon options image is at `Documentation\Images\NoteTakerIconOptions_01.png` (in the Image Keeper folder).

## Tests I ran
**Icon and page (real Chrome, throwaway profile, `--app` window):**
- No console or network errors on load. No favicon 404.
- Manifest parses with no errors; Chrome reports no installability errors. The page, its h1, and the Mint Profile control still work.
- **Window icon (what the taskbar and Alt+Tab draw):** our notepad icon. It stayed stable at 3, 8 and 15 seconds, with and without the manifest. I identified the test window by process ID.
- Shortcut: the `.lnk` target, arguments and icon path read back correctly.
- Chrome's installed-app case was not measured (installing would change your profile).

**NoteTaker's own test suite (`Testing\`):**

| Test | Result |
|---|---|
| phase1-4 unit tests, profiles-phase3 unit | 18 + 69 + 47 + 48 + 20 passed, 0 failed |
| profiles-phase2 browser | 62 passed, 0 failed |
| profiles-phase3 browser | 135 passed, 0 failed |
| profiles-phase4 browser | 56 passed, 0 failed |
| phase1, phase2, phase3, phase4 browser | **abort at the start (see below)** |

**The four old browser tests fail the same way before my change.** I ran them against a copy with the snapshot `index.html` and none of the new files, and got identical failures (for example `Cannot read properties of null (reading 'hidden')`, and `FAIL O1 an Open file button is in the header next to New container`). So they are not caused by this change. They appear to be written for an earlier version of the page. I did not touch them.

## Things you should know or check
- **Please run `open-notetaker-app.bat` or the `.lnk` once** and confirm it opens in APPS. I did not launch it in your real profile.
- **A measurement mistake I made, and fixed:** my first icon check found a window by its title, and for a while it read a different window titled "NoteTaker" (a grey "N" tile). Re-measuring by process ID showed the real window uses our icon. The same method re-confirmed the Image Keeper result (stable at 3, 8 and 15 seconds).
- **Share package:** `Share` and `The_Share.zip` are unchanged, so they do not include the icon or manifest. The launcher files contain `Profile 5` and `F:\OneDrive\...` paths, which would not suit another person's machine.
- **Mint:** the icon is the same in both looks, as you chose.
- OneDrive may show the new files as syncing.
