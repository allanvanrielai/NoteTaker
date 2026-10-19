# NoteTaker - project close-out summary

**Built:** 9-10 October 2026 | **Status:** complete, accepted, in daily use | **Browser:** Chrome 155.0.8059.40 (Windows 11) | **Address:** `http://localhost:47613/`

This file is a self-contained summary for upload into a Claude chat. The full running log, with every decision and every change, is `Documentation/Phase1_Build_Notes.md` (about 490 lines; the name is historical, it covers all four phases).

---

## 1. What it is and why

A personal, single-user notes app that runs in Chrome. It exists because the user works with several AI chat tools and other text sources at once, and kept losing track of which browser tab held what. Instead of tabs, text lives in **containers** on one page, each optionally linked to a real text file on disk. There is a sticky list of container headers beside them, so every container is one click away.

Constraints: one HTML file, no framework, no backend, no build step, Chrome only, runs from a local folder. The user wanted it usable by Sunday 11 Oct and tested before Monday 12 Oct; it was finished and accepted on Saturday 10 Oct.

## 2. What it does (final state)

**Containers**
- Editable title, scrollable plain-text area, word and character counts (characters include spaces), a "last edited" time (separate from the file's modified time).
- Buttons: **Save, Save As, Copy, Pin, Collapse, Delete**, plus **New container** and **Open file...** in the header.
- Copy copies that container's text. Delete asks first and removes the container only; it **never touches the file on disk**.

**Saving**
- First Save on a new container is a Save As. Default file name is the sanitised title + `.txt` (or `User_Text_yyyymmdd_hhmmss.txt` if the title is empty). Dialog accepts `.txt` and `.md`.
- After the dialog, the title becomes the file name (without extension) and **locks** (read-only, lock icon). Later Saves overwrite the linked file silently, after safety checks (section 5).
- Save As is always available: it makes a new file, relinks the container, and the title follows.
- The saved file holds the text only, not the title.

**Opening** (added in phase 4)
- Open one or several `.txt` / `.md` files into new linked containers. An already-open file is not opened twice (that container is shown instead).
- Opened files keep their **byte-order mark and Windows (CRLF) line endings**; opening and saving without editing returns identical bytes. Mixed or old-style line endings open with a warning and are saved consistently.
- Files that are not valid UTF-8 text (Latin-1/Windows-1252, UTF-16, Word `.docx`/`.doc`, other binary) are **refused, never guessed at**. Limit 10 MB.

**Organising**
- **Pin** (one at a time; the pinned container is first in both sort modes), **Collapse** (title and buttons only; failure panels still show).
- **Search** (header column): filters containers and header entries as you type, by title and text, case-insensitive; collapsed matches stay visible.
- **Order:** "Manual order" (default; drag handle plus up/down arrows; remembered across restarts) or "Sort by last edited" (a container never moves under your cursor; it moves once you click away).
- **Header column:** title, word count, time, "no file"/"unsaved" marks, lock/pin/collapsed symbols; click to scroll to a container.
- **Dark mode button:** follows the Windows setting until used; the choice is then remembered.

**Never losing text**
- Every change is written to the browser's database within a few milliseconds ("crash backup"). Closing the tab immediately after typing was tested. The header shows "Backup: up to date", or in red "BACKUP FAILED".
- Unsaved containers (no file) survive a closed tab or a crash until deleted.
- A warning appears if NoteTaker is open in two tabs (they would overwrite each other's backup).

**Layout** (agreed from mockups, built around the user's 1920 x 1080 monitor at 100% zoom): containers column 1060 px, header column 528 px, text area 400 px high, 14 px text, centred; shrinks to fit at 1366 px.

## 3. How it runs

| Item | Detail |
|---|---|
| Address | **`http://localhost:47613/`** exactly. Containers and file permissions belong to this origin (including the port); another port or `127.0.0.1` would look empty. |
| Server | `Launcher/serve.py` - serves **only** `NoteTaker/app` on 127.0.0.1, with `Cache-Control: no-cache` so Chrome re-checks for updates every load. |
| Start at sign-in | Shortcut `NoteTaker server.lnk` in the Windows Startup folder runs `Launcher/start-notetaker-hidden.vbs` -> `start-notetaker-server.bat` (waits for the F: drive, does nothing if already running). **Remove it by deleting that one shortcut.** |
| Bookmark | The user adds `http://localhost:47613/` themselves (a browser cannot start a server). |
| Where the data is | Containers: the browser's IndexedDB for that origin (`notetaker`: `cards`, `handles`, `meta`). Theme: `localStorage`. Files: wherever the user saved them (a OneDrive folder is fine). |
| After an app update | If a page looks stale, Ctrl+F5. (The server now sends no-cache; the live server was restarted onto it.) |

Folder layout (`F:\OneDrive\AI\NoteTaker`): `app/index.html` (the whole app, ~59 KB) (updated 2026-10-14: `app/index.html` is now 67,827 bytes, about 68 KB, and is still the whole app; `app/` also holds `mint-profile.js`, 272,918 bytes, the optional Mint look) | `Launcher/` (3 files) | `Documentation/` (build notes, this summary, snapshots of the app as accepted after each phase) | `Testing/` (all tests, the original handle test harness, `TEST-PLAN.md`) (updated 2026-10-14: the early mockups and the Snipaste screenshots that used to be here were moved to `_to_delete/` on 14 Oct) | `DATA/` (the user's own saved note files; not part of the app) | a stray copy of the original `handle-test.html` in the project root (safe to delete; the app does not use it) (updated 2026-10-14: that root copy was moved to `_to_delete/` on 14 Oct; the copy in `Testing/` stays).

## 4. Key findings about the File System Access API (Chrome 155)

These drove the design and are reusable for any similar project. Full tables are in `Testing/TEST-PLAN.md`.

- **Handles persist** in IndexedDB across tab close and full browser restart, on both `file://` and `localhost`.
- **Permission:** on `http://localhost:47613` write permission stays granted after a full restart (Chrome shows "allowed to edit" in site settings), so Save is silent. On `file://` Chrome asks again for every file after every restart, with no "allow on every visit" option. **That is why the app is served from localhost.**
- **A handle is path-based.** Saving to a handle whose file was renamed, moved or deleted **silently re-creates the file**; saving over an externally edited file **silently overwrites it** (size can even stay the same). Chrome gives no error for either.
- `getFile()` before writing throws `NotFoundError` for rename/move/delete, so it is a usable detector. An external edit is only visible as a changed `lastModified`.
- A locked or concurrently changed file makes the *write* fail with `InvalidStateError` (nothing overwritten).
- Cancelling a dialog gives `AbortError`. The Windows dialog's file-type filter cannot be enforced (typing `*.*` shows everything), so the **content check is the real safeguard**.
- **`startIn` with the stored handle of the last saved file reopens the dialog in that folder even after a restart** (the `id` option alone did not).
- A file chosen with the *Open* dialog starts read-only; the first Save asks for permission (accepted).
- OneDrive sync did not change `lastModified` on untouched files over a 4 minute test (see limits).

## 5. The save routine (the safety core)

For a container linked to a file, every Save does, in order:
1. **Permission:** check; ask inside the click if needed.
2. **Does the file still exist?** (`getFile()`); if not -> panel "renamed, moved or deleted".
3. **Is it unchanged since our last save/open?** (`lastModified` compared with the stored value); if not -> panel "changed outside NoteTaker".
4. **Write**, with the file's original BOM and line endings. A failure -> panel "could not write (locked or changed while saving)".
5. **Remember** the new `lastModified`.

Failure panels appear inside the container, the text is never lost, and they offer: *Save As new file*, *Overwrite anyway* / *Re-create file here* / *Try again* / *Allow saving*, *Dismiss*. If two containers link to the same file, both show a warning.

## 6. Decisions the user confirmed (highlights)

Layout: stacked containers + header column (sidebar chosen over a card grid after mockups). Search in v1; **Open button only** (no recent-files list); Delete never touches files. Default order is Manual; last-edited order never moves a container under the cursor; failure panels stay visible on collapsed containers; search does not re-run while typing in a container and moving is off during a search; the pinned container cannot be dragged. Reserved Windows names get a leading underscore; a title already ending `.txt`/`.md` is not given a second extension; opened files keep BOM/CRLF; non-UTF-8 and over-10 MB files are refused. Auto-start by Startup-folder shortcut. Longevity of the localhost permission over days was **deliberately not tested** (files are normally discarded within a day).

## 7. Testing

| | Unit (pure logic) | Real Chrome (CDP) |
|---|---|---|
| Phase 1 containers, counts, backup, layout | 18 | 72 |
| Phase 2 saving, title lock, safety routine | 69 | 73 |
| Phase 3 pin, collapse, search, order, drag, dark mode | 47 | 78 |
| Phase 4 opening files | 48 | 54 |
| **Total** | **182** | **277** |

All 459 pass. Run with `node Testing/phaseN-unit.mjs` and `node Testing/phaseN-browser.mjs` (needs Node and Chrome; the browser tests start their own throwaway Chrome profile and server on port 47614, never touching real data). (updated 2026-10-14: the project now also has the profiles suites `Testing/profiles-phase2-browser.mjs`, `Testing/profiles-phase3-unit.mjs`, `Testing/profiles-phase3-browser.mjs` and `Testing/profiles-phase4-browser.mjs`; the last full run was 732 checks, all passing: unit 202 and browser 530, which include the original 459 (profiles checks: Phase 2 browser 62, Phase 3 unit 20, Phase 3 browser 135, Phase 4 browser 56). The counts are from the 2026-10-14 entry in the Build Notes and the suite names from the files in `Testing/`.)

- The browser tests drive **real Chrome** with real mouse events (including drags with auto-scroll) and real file handles from Chrome's private file system, which uses the same API as disk files, so rename, delete, external edit, permission and write-failure cases are genuine. Files are written as raw bytes for the BOM/CRLF/binary tests.
- **Mutation checks:** several times a safety feature was deliberately switched off (the pre-write check, pin uniqueness, UTF-8 refusal, BOM write-back) and the matching tests failed, then the app was restored.
- **Manual only (user's own Chrome):** the real Windows file dialog, real file locks held by other programs, how drag feels, how dark mode looks, OneDrive "online only" files.

**Bugs found by testing and fixed:** backup lost text typed within 150 ms of closing the tab (write now starts on the next tick); header highlight went to the wrong container after a long scroll (twice: first the "reading line" rule, then a lock dropped mid-scroll; now uses `scrollend`); drag handlers relied on pointer capture; the Copy button label changed width and resized the card; a test-runner crash from an unread fetch response; contrast of three colours (light-theme orange, dark-mode primary button text and the red backup error) raised to at least 4.5:1.

## 8. Known limits and things not built

- **Not built (not requested):** reloading a file from disk into an open container; dragging files onto the page; other extensions (`.log`, `.csv`, `.json`) or encodings (Word's "Plain Text" in the Windows encoding is refused); dragging from the header column; remembering the search; a warning when closing the tab with unsaved changes (the crash backup keeps the text); a recent-files list.
- **Chrome only.** The data is in the browser profile: clearing site data for `localhost:47613` deletes unsaved containers and the file links (containers whose text was saved to a file can be reopened with Open).
- **Untested:** a real Windows sign-in starting the server (the shortcut was run by hand and works); OneDrive sync over hours, or a file edited on another device and synced down (that would correctly raise the "changed outside" warning); permission expiry over days.
- **Opened mixed-line-ending files** are the one case where open-then-save is not byte-identical (flagged to the user when opened).
- `Testing/README.md` described the original throwaway handle-test harness, not the app. (updated 2026-10-14: that file was moved to `_to_delete/` on 14 Oct, so `Testing/` no longer has a README.)

## 9. Maintenance notes

- **Change the app:** edit `app/index.html` (pure logic is between the `<pure-logic>` markers so the unit tests can load it), run all eight suites, then Ctrl+F5.
- **Roll back:** `Documentation/index.phase1.accepted.html`, `index.phase2.accepted.html`, `index.phase3.accepted.html` (and `index.phase3.before-darkmode.html`) are snapshots of the app as accepted after each phase.
- **Never change the port** (47613) or the address form without accepting that the saved containers will not appear there.
- **Stop or remove:** end the `python ... serve.py 47613` process and delete the Startup shortcut; delete the `NoteTaker` folder; clear site data for `localhost:47613`.

## 10. How the project was run (what worked)

Requirements were confirmed before any code ("Step 0": list what was added, ask the open decisions, give a plan). Work was split into four phases with a stop for the user's testing after each. Layout questions were settled with **rendered mockups** (screenshots checked at 1920 and 1366 px) before building. Every phase was verified in real Chrome, not only by reading code, and every report separated "verified directly" from "needs manual testing". Anything decided without being asked was listed for confirmation and logged. All changes and deviations are recorded in the build notes under headings of the form `CHANGE: description - date`.
