# Build decisions - 2026/10/09

NoteTaker v1: a personal, single-user notes app built from "cards" that open and save local text files. This file records what was asked, what was agreed before building, and (at the bottom) every change made along the way. A colleague should be able to read it top to bottom and understand what is happening and why.

---

## 1. Background

**What it is.** A single-file HTML app, Chrome only, no framework, no backend, no build step. It uses the File System Access API to save text to local files. Target: usable Sunday 2026/10/11, tested before Monday 2026/10/12.

**Why it exists.** The author works with several AI chat tools and other text sources at once, and loses track of which browser tab holds what. Cards on one page, with pin, collapse and search, replace the tabs.

**Typical use**
1. Ask an AI a question, edit the answer, resubmit, edit again, and save only what is worth keeping.
2. Open another card, paste text from other sources, edit it, and copy it out into other apps.

### Hosting (decided, not to be changed)
- Served from `http://localhost:<obscure port>` (not 8000), bound to 127.0.0.1 only.
- The server starts automatically at Windows login. A Chrome bookmark opens the app.
- App files live in a subfolder of `F:\OneDrive\AI\NoteTaker` (for example `app`). The throwaway test harness `handle-test.html` is in `NoteTaker\Testing`.
- localhost is used rather than `file://` because write permission only persists across browser restarts on localhost.
- The permission is per origin, so the port is part of it. A new port needs a quick check that Save stays silent after a full Chrome restart.

### Verified findings (Chrome 155.0.8059.40, see `TEST-PLAN.md`)
- File handles persist in IndexedDB across restarts on both origins.
- localhost: write permission stays granted across a full restart (a stored site setting, "allowed to edit"). No prompts. The grant is per site, not per file or folder.
- file://: prompts "Allow this site to edit `<file>`?" for each file after every restart.
- Save with no pre-check silently re-creates a renamed, moved or deleted file, and silently overwrites an external edit.
- `getFile()` before writing throws `NotFoundError` after rename, move or delete.
- An external edit shows only as a changed `lastModified` (size can stay the same).
- A locked or changed file makes the write fail with `InvalidStateError`; nothing is overwritten.
- Cancelling a dialog gives `AbortError`.
- Save As reopens the last folder within a session; on localhost it fell back to Documents after a restart.

### Required save routine (five steps, unchanged)
1. Call `getFile()`. On `NotFoundError` (renamed, moved or deleted), stop and ask the user. Do not re-create the file.
2. Compare `lastModified` to the value stored at the last save or load. If different, warn instead of overwriting.
3. Write. On `InvalidStateError`, treat it as "locked or changed on disk" and offer Save As.
4. Store the new `lastModified` after every successful write.
5. Check `queryPermission` on load. If it is not granted, show a "click to allow" button that calls `requestPermission`.

Text must never be lost on a failed check. The user chooses "Save As new file" or "Overwrite anyway".

---

## 2. The prompt as submitted

> TASK: Build NoteTaker v1 from the existing project context plus the
> requirements below. These were agreed in a design discussion in Claude chat.
>
> RULES
> - Do not assume or guess. Where anything is unclear or conflicts with your
>   existing project context, STOP and ask me. Do not resolve it silently.
> - Hosting, constraints, verified findings (Chrome 155, TEST-PLAN.md), and the
>   five-step save routine are unchanged from your project context. Do not
>   change them.
>
> STEP 0 - BEFORE WRITING CODE
> a) Compare the list in section A with your current requirements list. Add every
>    item that is missing, and show me exactly what you added.
> b) Raise the four decisions in section B and wait for my answers.
> c) Then give me a short build plan using the phases in section C.
>
> A. REQUIREMENTS TO CONFIRM OR ADD
> Cards
> - Each card has an editable title, a scrollable plain-text area, word count,
>   character count (character count INCLUDES spaces), and these buttons:
>   Save, Save As, Copy, Pin, Collapse, Delete.
> - "New container" button creates a new card.
> - Each card stores a last-edited timestamp, updated on any title or text change.
>   This is separate from the file's lastModified.
>
> Save and title
> - First Save on an unbound card opens the Save dialog. Default name is the
>   sanitised title + ".txt". If the sanitised title is empty, use
>   User_Text_yyyymmdd_hhmmss.txt. The user can change the name in the dialog.
> - Sanitise: trim leading/trailing spaces; remove \ / : * ? " < > | and control
>   characters; remove trailing dots; handle Windows reserved names (CON, PRN,
>   AUX, NUL, COM1-9, LPT1-9); cap the length at 100 characters.
> - After the dialog completes, the title becomes the actual saved name (from
>   handle.name) minus the extension, and the title LOCKS. Cancelling changes
>   nothing and the title stays editable.
> - Show small print under the title: "Title locks to the file name on first
>   save", and a lock icon once locked.
> - Later Save on a bound card overwrites silently, using the five-step routine.
>   Save As is always available, creates a new file, rebinds the card, and the
>   title adopts the new name.
> - The saved file contains the text only, not the title.
> - If two cards end up bound to the same file (use isSameEntry), warn me.
> - Save As should open in the last folder used. Per your findings this works
>   within a session only. Investigate whether passing a stored handle as
>   startIn restores the folder after a restart, and report. Do not assume.
>
> Copy
> - Copies the text of that card to the clipboard.
>
> Delete
> - Confirmation prompt, then the card is removed completely, including its
>   IndexedDB state and stored handle. (Scope of the disk file: see B4.)
>
> Pin
> - Only one card pinned at a time. Pinning a card automatically unpins the
>   previous one. The pinned card always appears first.
>
> Collapse
> - A collapsed card shows only the title and its buttons.
>
> Search
> - Filters by title and content as you type. Collapsed cards that match stay
>   visible. (Scope: see B2.)
>
> Ordering
> - A toggle between "Sort by last edited" (newest first, pinned card above all)
>   and "Manual order".
> - Manual order supports BOTH drag and drop and move arrows on each card.
> - Manual order is remembered across browser restarts.
>
> Persistence
> - Every card's text, title, bound handle, last-edited time, pin state, collapse
>   state and manual order persist in IndexedDB. Pin and collapse persistence is
>   my assumption: confirm with me.
> - Unsaved text must never be lost on a failed check, as per your project
>   context.
>
> B. DECISIONS I MUST MAKE BEFORE YOU BUILD
> B1. Layout: card grid (as in my sketch) versus tabs or a list. Ask me. Note
>     that my original problem was not knowing which of many tabs to go to.
> B2. Search: your context lists it as out of scope for v1. I agreed it as a
>     requirement. Ask me.
> B3. Open and recent files: your context lists "Open existing files" as out of
>     scope but also describes an Open button and a recent-files list. Ask me
>     which is in v1.
> B4. Delete: confirm with me that Delete removes the card only and never
>     deletes or touches the file on disk.
>
> C. PHASES (deadline: usable Sunday 11 Oct, tested before Mon 12 Oct)
> Phase 1 (must work first): cards, new/delete with confirm, title, text, counts,
>   copy, IndexedDB persistence, unsaved-text crash backup.
> Phase 2: Save/Save As with title lock and sanitising, the five-step save
>   routine, permission check on load, the failure choices ("Save As new file"
>   or "Overwrite anyway").
> Phase 3: pin, collapse, search (if B2 allows), sort/manual toggle, drag and
>   drop, move arrows.
> Phase 4: Open and recent files (if B3 allows).
> Stop and report after each phase so I can test before you continue.
>
> D. OPEN ITEMS FROM YOUR CONTEXT
> - OneDrive: lastModified may change under sync and cause false warnings. Test
>   this early in Phase 2, with the notes folder in OneDrive, and report.
> - Port and launcher setup stays as per project context.
>
> REPORTING
> After each phase, state what you verified directly (with evidence) versus
> what needs my manual testing. If you are unsure of anything, say so and tell
> me what to check.

---

## 3. Agreed before building (Step 0 outcome)

### 3.1 Decisions (section B)
| | Decision |
|---|---|
| B1 Layout | **Card grid** (responsive). Collapse, Pin and Search address the original "which tab?" problem. |
| B2 Search | **In v1**, built in Phase 3. |
| B3 Open / recent | **Open button only** (Phase 4). No recent-files list: cards already persist their file handles across restarts, so a separate list is largely redundant. |
| B4 Delete | **Removes the card only.** Never deletes or touches the file on disk. |

### 3.2 Rulings on points raised during Step 0 (all "defaults OK")
1. **Copy** is a per-card button, copying that card's text. (This replaces the earlier "copy the selected session only" idea. There is no "selected" card.)
2. **File types:** dialogs default to `.txt` and also accept `.md`. Plain text only.
3. **Reordering while typing:** in "Sort by last edited" a card is not moved while its text or title is focused. It reorders when focus leaves it, or when the sort is toggled.
4. **Pin in Manual order:** the pinned card is first in both sort modes.
5. **Unsaved indicator:** each card shows a small "unsaved changes" mark when its text differs from what was last saved.
6. **Persistence:** pin state, collapse state and manual order persist in IndexedDB across restarts.
7. **Word count:** a word is a run of non-whitespace characters. Character count includes spaces.

### 3.3 Items added to the requirements list during Step 0
Everything in section A that was missing from the earlier list: per-card title, counts and the six buttons; the "New container" button; per-card last-edited time; title sanitising, default naming, and title lock with small print and lock icon; the `isSameEntry` duplicate-binding warning; the investigation of a stored handle as `startIn`; Delete with confirmation including IndexedDB cleanup; Pin, Collapse, Search; the sort toggle with drag and drop and move arrows; persistence of pin, collapse and manual order.

### 3.4 Build phases
| Phase | Scope |
|---|---|
| 1 | Cards, New/Delete with confirm, title, text, counts, Copy, IndexedDB persistence, unsaved-text crash backup, unsaved indicator. |
| 2 | Save / Save As, title lock and sanitising, the five-step save routine, permission check on load, failure choices ("Save As new file" / "Overwrite anyway"), `isSameEntry` warning, `startIn` investigation, port and launcher, OneDrive `lastModified` check. |
| 3 | Pin, Collapse, Search, sort / manual toggle, drag and drop, move arrows. |
| 4 | Open button. |

The work stops after each phase for manual testing before continuing.

### 3.5 Verification approach
- Pure logic (sanitising, counts, ordering, save-routine decisions) is verified directly with scripts.
- File pickers, permission prompts, drag and drop and real-browser behaviour need manual testing in Chrome. Each phase report states which is which, with a checklist.

### 3.6 Open items
- **Port.** A high port, checked to be unused, to be chosen and stated before the launcher is written (Phase 2).
- **OneDrive.** `lastModified` may change under sync and cause false "file changed" warnings. Test early in Phase 2 with the notes folder in OneDrive.
- **Save As folder.** On localhost the folder falls back to Documents after a restart. Phase 2 tests whether a stored handle as `startIn` fixes this.

---

## 4. Changes, deviations and additions

Entries are added below as the build proceeds, each under a heading of the form `CHANGE: {description} - yyyy/mm/dd`.

### CHANGE: Production port chosen now (47613), not in Phase 2 - 2026/10/09
The plan said the port would be chosen in Phase 2. It is chosen now because IndexedDB data and the file permission are tied to the origin (including the port). Testing Phase 1 on a temporary port would have meant losing the test cards when the final port was set.
- **Production origin: `http://localhost:47613`.** Checked free with `netstat` on 2026/10/09.
- The automated tests use a **different** throwaway origin (`http://127.0.0.1:47614`, fresh Chrome profile), so they never touch production data.
- The auto-start at login, the bookmark and the launcher are still Phase 2.

### CHANGE: Phase 1 file layout - 2026/10/09
- `app/index.html` : the app (single file, no dependencies). Only this folder is meant to be served.
- `Testing/phase1-unit.mjs` : unit tests for the pure logic (counts, timestamp, unsaved state, ordering). Run with `node Testing/phase1-unit.mjs`.
- `Testing/phase1-browser.mjs` : drives real Chrome over the DevTools protocol against the throwaway origin. Run with `node Testing/phase1-browser.mjs`.

### CHANGE: IndexedDB layout created now for later phases - 2026/10/09
Database `notetaker`, version 1, three stores: `cards` (key = card id), `handles` (key = card id, used from Phase 2 for file handles), `meta`. Each card record already has the fields for later phases (`savedText`, `pinned`, `collapsed`). Delete removes the card record and any handle entry in one transaction.

### CHANGE: Buttons for later phases shown disabled - 2026/10/09
Save, Save As, Pin and Collapse are visible but disabled in Phase 1 (hover text says which phase enables them), so the card layout is final from the start. Only Copy and Delete work in Phase 1.

### CHANGE: Display order in Phase 1 - 2026/10/09
Cards show newest-created first, and the order survives reload. The sort toggle, manual order and pin ordering are Phase 3.

### CHANGE: "Unsaved" indicator definition - 2026/10/09
- A card with text that has never been saved to a file shows **"Not saved to a file"**.
- A card bound to a file whose text differs from what was last saved shows **"Unsaved changes"** (Phase 2 onwards).
- An empty card, or one matching its saved text, shows nothing.
In Phase 1 every card is unbound, so only the first form can appear.

### CHANGE: Backup write timing shortened from 250 ms to next event-loop turn - 2026/10/09
**Found by testing (T8).** The first version wrote to IndexedDB 250 ms after the first change. A browser test that left the page at different delays after typing showed text typed within about 150 ms of leaving was lost, and the `pagehide` flush did not rescue it (survived: 300 ms and 600 ms; lost: 0, 50 and 150 ms).
- Fix: `FLUSH_MS = 0`. Changes made in the same event-loop turn are still written as one batch, but the write now starts almost at once.
- Result: text typed 0, 50, 150, 300 and 600 ms before leaving the page all survived, on three consecutive runs.
- The `pagehide` and `visibilitychange` flushes are kept as a backstop, but they should not be relied on.
- Not measured: the effect on very large cards (each change re-saves that card's whole text). Fine for normal notes; watch for lag with very large pastes.

### CHANGE: Backup status shown in the header - 2026/10/09
The header shows "Backup: writing…", "Backup: up to date" or, in red, "BACKUP FAILED: text is not protected". A failed write is retried every 2 seconds and the card stays marked as changed. Not in the original requirements; added so a failing backup is never silent.

### CHANGE: Warning when NoteTaker is open in two tabs - 2026/10/09
**Not in the agreed requirements. Added to protect against silent data loss; remove it if you do not want it.** Two open copies would each hold their own list of cards and overwrite each other's backup. The second tab shows a yellow banner ("already open in another tab or window") and keeps working. It does not block. Implemented with the Web Locks API; verified in a real browser.

### CHANGE: Request for persistent browser storage - 2026/10/09
On load the app asks Chrome not to evict its data under storage pressure (`navigator.storage.persist()`). Chrome may grant or refuse this on its own heuristics; the result is only shown as a tooltip on the backup indicator. Not verified: whether Chrome grants it for this origin.

### CHANGE: Copy uses CRLF on Windows - 2026/10/09 (not a bug)
Chrome on Windows writes line breaks to the clipboard as CRLF, so text copied from a card and read back has `\r\n`, not `\n`. This is normal Windows behaviour and is correct for pasting into other Windows apps. The test normalises line endings when comparing, and separately checks that CRLF is present. The card text itself and any file saved later keep `\n`.

### CHANGE: Phase 1 test results - 2026/10/09
- Unit tests: 18 of 18 pass.
- Real-browser tests (Chrome 155.0.8059.40, throwaway origin): 42 of 42 pass, on three consecutive runs.
- Covered: first-load empty state, New container, typing, word and character counts (including spaces and newline), timestamp format, last-edited update on a title change, IndexedDB contents, reload restore, newest-first order across reload, leaving the page straight after typing, Copy (including the empty case), the two-tab warning, Delete (cancel, confirm text, removal from IndexedDB including the handles store, no reappearance after reload), and a simulated storage failure showing the red backup message.
- **Not covered by the automated tests, needing manual testing in your own Chrome:** the production origin on port 47613, a full browser restart, tab-crash and process-kill behaviour, pasting large text, drag selection and real mouse use, and appearance.


### CHANGE: Copy feedback no longer resizes the card - 2026/10/09
**Reported in manual testing** (`Testing/Snipaste_2026-10-09_21-01-04.Png`): on Copy the button label changed from "Copy" to "Copied". The longer label pushed the Delete button onto a second row, so the card grew and then shrank back.
- Fix: the button label never changes. A small floating note ("Copied", "Nothing to copy", "Copy failed") appears under the button for 1.2 seconds and is removed afterwards.
- New automated check (T9b): the card's width, height and number of button rows are identical before and while the note shows. Browser tests are now 45 of 45.
- Side finding: in a 370 px wide card the six buttons already wrap to two rows even without any note. The wider cards below remove this.

### CHANGE: Card size mockup, awaiting a decision - 2026/10/09
**Request:** expanded cards about 2.25 times wider and about twice as tall, so two sit side by side.
- Current size was estimated from the screenshot at about 395 x 320 px (the screenshot may have been scaled). Proposal: about 890 px wide, about 640 px tall (text area about 520 px).
- `Testing/mockup-card-size.html` is a static, throwaway mockup with sliders for card width, text area height and text size, a "fixed width" option, and a live readout of cards per row and characters per line. Open it by double-clicking. It is not connected to the app.
- Findings from rendering it in Chrome at two window sizes:
  - **1920 px wide window:** two cards per row, each 937 x 636 px when stretched to fill the row, about 125 characters per line at 13 px text.
  - **1366 px wide window:** only one card fits (890 + gaps is over 683), and it stretches to 1334 px, about 181 characters per line, which is too long to read comfortably.
- **Open decision:** what screen width and browser zoom you use, whether the layout should be fixed width (cards cannot stretch), and the text size. The app has NOT been changed yet; the grid still uses the Phase 1 sizes.

### CHANGE: Alternative layout under consideration (reopens B1) - 2026/10/09
**Idea:** one column of stacked containers on the left (about two-thirds of the page width) and a second column on the right listing the container headers. B1 was decided as a card grid; this is not adopted yet. The app is unchanged.
- `Testing/mockup-layout-sidebar.html` is a static mockup: a sticky index on the right (title, word count, last-edited time, "no file" / "unsaved" marks, lock and pin icons); clicking a header scrolls to and flashes that container; the search box filters both columns; sliders for the left-column share, maximum card width, text area height and text size.
- Rendered in Chrome:
  - **1366 px wide window:** works well. Card 880 px (about 109 characters per line), index 438 px.
  - **1920 px wide window:** a strict 66% split leaves a 346 px empty gap between the 900 px card and the index, and the index is a stretched 626 px. Percent splits do not suit wide screens; fixed column widths (card about 900 px, index about 380 px) look better.
- **Trade-off:** only one to two containers are visible at once, instead of two side by side. The index makes any container one click away, but two containers cannot be compared on screen at the same time.
- **Open decision:** grid (B1 as decided) or this sidebar layout.

### CHANGE: Layout decision - sidebar chosen, B1 revised - 2026/10/09
**Decision (user):** the sidebar layout "feels more natural" than the card grid. B1 is revised from "card grid" to "stacked containers with a header list on the right". Primary screen: 1920 x 1080 monitor, browser zoom 100% (measured viewport in the user's Chrome: 1920 x 911). The app itself has not yet been changed to this layout.
- **Requested adjustment (from `Testing/Snipaste_2026-10-09_21-56-34.Png`):** make the container wider; make the header column about 15% narrower. The screenshot showed a 900 px container and a 621 px header column with a large gap between them.
- **Interpretation (confirm):** "Title container" means the right-hand header column. 15% narrower than 621 px is about 528 px.
- **Mockup updated** (`Testing/mockup-layout-sidebar.html`): fixed pixel widths instead of a percentage split, so the layout does not depend on the window width. Proposed defaults: **container 1060 px, header column 528 px**, text size 14 px, text area height 380 px (about 132 characters per line). Rendered at 1920 x 911: the pair is centred with about 141 px unused each side. The sliders step in 10 px, so 528 shows as 530.
- **Still to confirm:** container width (1060 is a proposal; "a bit more" than 900 was the only guidance), text area height, text size, and whether the pair should be centred or left-aligned.

### CHANGE: Sidebar layout built into the app - 2026/10/09
The real app now uses the agreed layout (B1 revised, see the layout decision above).
- **Container column:** containers stacked, **1060 px** wide, text area **400 px** high (user's value), text **14 px**.
- **Header column:** **528 px**, sticky (stays in view while scrolling). Each entry shows the title ("Untitled" in italics if empty), word count, last-edited time and a "no file" mark (or "unsaved" from Phase 2). Entries update as you type.
- Clicking a header scrolls to that container and flashes it. The entry for the container being read is highlighted.
- The pair is **centred**. At 1366 px wide the columns shrink to fit (no horizontal scrollbar; container at least 700 px, header column at least 240 px). Below 900 px the header column drops below the containers.
- **Assumptions to confirm:** 14 px text size and centring were not explicitly answered; they are as shown in the mockup the user approved the widths of.
- **Not yet in the header column (later phases):** search box and sort toggle (Phase 3), pin and collapse icons (Phase 3), lock icon (Phase 2). The disabled Save, Save As, Pin and Collapse buttons are unchanged.

### CHANGE: Header highlight logic fixed (found by testing) - 2026/10/09
Two problems found while testing the header column:
1. **Clicking the last header highlighted a different entry.** The first version highlighted whichever container crossed a fixed reading line near the top of the screen; the end of the page cannot scroll a short last container up that far. Fix: a clicked header stays highlighted while its container is on screen, and the last entry is highlighted when the page is scrolled to the very bottom.
2. **The clicked highlight stuck when dragging the scrollbar.** Wheel, touch and keys released it, but a scrollbar drag does not fire those events. Fix: once the click's own scroll has settled (250 ms with no movement), any later scrolling of more than 4 px releases the highlight, however it was caused.

### CHANGE: Test runner fix (not an app bug) - 2026/10/09
After the layout code was added, the browser test runner crashed at startup with a Node internal assertion (`assert(!this.paused)`). Cause: the runner's start-up check fetched the page without reading the response, and Node's fetch fails on responses it never consumes once the page grew. Fix: the check now reads the response. Also fixed two test mistakes of mine (the page scrollbar skewed the centring check; one check inspected an empty container).

### CHANGE: Phase 1 tests after the layout change - 2026/10/09
- Unit tests: 18 of 18.
- Real-browser tests: **64 of 64**, three consecutive runs. New checks cover: container 1060 px, header column 528 px, text area 400 px, text 14 px, pair centred, no horizontal scrollbar at 1920 x 911; index matches the containers in order; title typing updates the index at once; clicking last and middle headers scrolls and highlights correctly; highlight releases when scrolled by hand; header column stays in view; layout fits at 1366 x 768; deleting a container removes its header.
- `Testing/phase1-screenshot.mjs` renders the app with sample containers at 1920 x 911 into a PNG (used to check the look).
- **Needs manual testing in your own Chrome:** how it looks and feels on your monitor, the scrollbar drag behaviour, long pastes, and everything listed in the earlier manual test list.

### CHANGE: Clicking a container brings all of it into view - 2026/10/09
**Reported in manual testing** (`Testing/Snipaste_2026-10-09_22-22-27.png`): a container at the top or bottom of the screen stayed partly hidden (title and buttons under the header, or the bottom running off the screen) even after the user clicked in it. Phase 1 otherwise accepted.
- **Interpretation:** "click on a container" means a click anywhere inside it except its buttons (text area, title, edges), or keyboard focus moving into it.
- **Behaviour:** the page scrolls only as far as needed, smoothly, to show the whole container, with a 12 px margin below the header and above the bottom edge. If the container is already fully visible nothing moves. If a container is taller than the screen, its top is shown and the page is not fought further.
- **Buttons are excluded on purpose:** moving the page between mouse-down and mouse-up can swallow the click, so Copy, Delete and the other buttons never scroll the page.
- **Timing:** for mouse use it scrolls after the click completes (so text selection and caret placement are not disturbed); for keyboard focus (Tab) it scrolls on focus.
- **Tests (T9d, real mouse clicks at 1920 x 911):** a container cut off at the bottom, one cut off at the top, one already visible (page must not move), keyboard focus, and a button click (page must not move). Checked that the three scroll tests fail with the fix switched off and pass with it on. Browser tests now **72 of 72**; unit tests 18 of 18.
- **Observation, not changed:** the highlighted header follows the scroll position, not where the cursor is, so the highlighted entry can differ from the container being edited (visible in the screenshot above, where the cursor was in "Subject 02" and "Subject 03" was highlighted). Awaiting a decision.

---

## 5. Phase 2 (Save, title lock, save routine) - built 2026/10/09

### CHANGE: Phase 2 built into the app - 2026/10/09
`app/index.html` now saves to files. A copy of the accepted Phase 1 app is kept at `Documentation/index.phase1.accepted.html` in case a roll back is needed.

**What it does**
- **Save** on a container never saved before opens the Save dialog (Save As). Default name = the sanitised title + `.txt`; if the sanitised title is empty, `User_Text_yyyymmdd_hhmmss.txt`. The dialog accepts `.txt` and `.md`.
- **Title lock:** after the dialog completes, the title becomes the saved file name without its extension and locks (read-only, lock icon in the card and in the header column). The small print "Title locks to the file name on first save" shows until then. Cancelling changes nothing and the title stays editable.
- **Later Save on a linked container** runs the five-step routine, silently when all is well: permission check (asked inside the click if needed); `getFile()`; `NotFoundError` means renamed/moved/deleted; `lastModified` compared with the value stored at the last save; write; store the new `lastModified`.
- **Save As** is always available; it creates a new file, relinks the container, and the title adopts the new name. The old file is left as it was.
- The saved file holds the text only, not the title. Text is written as typed (`\n` line breaks, UTF-8).
- **Failure panels** appear inside the container (red, with the message and buttons). The text is never lost:
  - file renamed, moved or deleted: **Save As new file** / **Re-create file here** / Dismiss
  - file changed outside NoteTaker since the last save: **Save As new file** / **Overwrite anyway** / Dismiss
  - write failed (locked, or changed while saving): **Save As new file** / **Try again** / Dismiss
  - no permission: **Allow saving** / Save As new file / Dismiss
  - any other error: Save As new file / Try again / Dismiss
- **On load:** a linked container whose permission is not granted shows "needs your permission" with **Allow saving** (the browser only allows that request from a click). A container whose stored link is missing shows "the link to the file was lost" with Save As.
- **Same file in two containers** (`isSameEntry`): both show a yellow warning naming the other. The save is not blocked (the dialog has already asked about replacing the file).
- **Meta line** shows "Saved hh:mm:ss"; "Unsaved changes" appears when a linked container differs from its file.
- **Save As starting folder:** the dialog starts in the folder of the last saved file, using that file's stored handle as `startIn` (and Documents the first time). Whether this survives a Chrome restart is **not verified** - see the manual checklist.
- Containers stored by Phase 1 load normally and gain the new fields.

### CHANGE: Phase 2 decisions made without being asked (please confirm or change) - 2026/10/09
1. **Reserved Windows names** (CON, PRN, AUX, NUL, COM1-9, LPT1-9, with or without an extension) get a leading underscore: `CON` becomes `_CON.txt`. COM10 and CONSOLE are not reserved.
2. **A title that already ends in `.txt` or `.md`** is not given a second extension (`notes.md` stays `notes.md`, not `notes.md.txt`). Other dotted titles do get `.txt` (`report.v2` becomes `report.v2.txt`).
3. **"Title minus extension"** removes only the last extension: `a.b.txt` becomes `a.b`.
4. **"Overwrite anyway" for a missing file** is labelled **"Re-create file here"** because nothing exists to overwrite.
5. **Unknown baseline:** if a container is linked but its last-known `lastModified` is missing, Save treats the file as "changed" (cannot verify) and asks, rather than overwriting.
6. **Failed write after the dialog:** the container stays linked and locked. The baseline is the file's `lastModified` read just before the write, so a retry works with no false alarm.
7. **Two tabs:** unchanged from Phase 1 (warning only).
8. **Not added (not requested):** "reload the file's content into the container", a warning when closing the tab with unsaved changes (the crash backup keeps the text), and Open (Phase 4).
9. The "Saved" note appears on the button for about a second and briefly covers the first line of text. Cosmetic; can be moved.

### CHANGE: Phase 2 tests - 2026/10/09
- **Unit tests** `Testing/phase2-unit.mjs`: 69 of 69 (sanitising incl. all reserved names, the 100-character cap, control characters, unicode; default names; extension handling; the before-write decision; write-error classification; messages; Phase 1 data migration). Phase 1 unit tests: 18 of 18.
- **Real-browser tests** `Testing/phase2-browser.mjs`: **73 of 73**. They use Chrome's private file system, which uses the same file handle API as disk files, so these cases are real: first Save/dialog options, title lock, cancel, silent repeat Saves (four in a row, no false alarm), double click writes once, Save As relinks and leaves the old file, **external edit refused (file and text both kept) then Overwrite anyway**, **deleted file not re-created** then Re-create, **renamed file not re-created**, write failure with Try again, permission denied/allowed, same-file warning, reload keeps links and baselines, permission prompt on load, lost link, failed write right after the dialog, Phase 1 data, Delete leaves the file alone, 1,000,000 characters saved exactly. Phase 1 browser tests: 72 of 72.
- **The tests can fail:** with the pre-write check switched off the first external-edit test failed immediately. The app was restored afterwards.
- **What these tests cannot cover:** the real Windows file dialog (stubbed), and real file locks by other programs. A lock was simulated by making the write throw `InvalidStateError`, the error observed in the earlier lock test. These are on the manual checklist.

### CHANGE: OneDrive `lastModified` check - result - 2026/10/09
**Question (open item D):** does OneDrive sync change a file's modified time by itself, which would make the "changed outside NoteTaker" check fire falsely?
- **Method:** `Testing/phase2-onedrive-mtime.mjs` wrote three small files into a folder inside `F:\OneDrive` and watched their modified time and size every 3 seconds for 240 seconds without touching them. As a control, it edited one file itself and confirmed the change was visible.
- **Result:** **0 unexpected changes** on the untouched files over 240 seconds, including the period when the new files would be uploaded. The control edit was seen. The probe files were removed afterwards.
- **What this does not cover (so keep an eye on it):** sync over hours; a file edited on another device and then synced down (that is a genuine external change, and the warning would be correct); files that OneDrive has set to "online only" (not tested); and sync clients other than the one on this PC. If a false "changed outside NoteTaker" warning ever appears on a file you have not touched elsewhere, note the file and the time.

### CHANGE: Launcher files created, NOT installed - 2026/10/09
In `Launcher/`:
- `start-notetaker-server.bat`: serves only `F:\OneDrive\AI\NoteTaker\app` on `127.0.0.1:47613` (this computer only). It waits up to about 5 minutes for the F: drive and folder to be available, and does nothing if something is already answering on the port.
- `start-notetaker-hidden.vbs`: runs the .bat with no window.
- **Tested on a spare port (47616):** up in about 4 seconds; serves the app; `Documentation` and `Testing` files return 404; listens on 127.0.0.1 only; a second start does nothing. The test copy was stopped. The server already running on 47613 was not touched.
- **Not done, needs the user's decision:** starting it automatically at Windows sign-in (a shortcut in the Startup folder, or a Task Scheduler task), and the Chrome bookmark (`http://localhost:47613/`). A browser cannot start programs, so the bookmark only works when the server is already running.

### CHANGE: Server auto-start installed (Startup folder shortcut) - 2026/10/09
**Decision (user):** start the server at Windows sign-in with a Startup folder shortcut.
- **Installed:** `C:\Users\allan.vanriel\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup\NoteTaker server.lnk`, which runs `wscript.exe "F:\OneDrive\AI\NoteTaker\Launcher\start-notetaker-hidden.vbs"` (no window). Nothing else on the system was changed. The other items in that folder (MEGAsync, Send to OneNote, TickTick) were not touched.
- **To remove it:** delete that one `.lnk` file. The server keeps running until it is stopped or Windows restarts.
- **Tested:** running the shortcut while the server was already up changed nothing (still one listener, PID 27772, page served 200). The earlier spare-port test showed a cold start works.
- **Not yet tested:** an actual Windows sign-in. Next sign-in: open `http://localhost:47613/` and confirm the page loads without starting anything by hand. If the F: drive is slow to appear, the launcher waits up to about 5 minutes.
- **Bookmark (user to add):** `http://localhost:47613/`. It must be exactly `localhost:47613`, not `127.0.0.1` and not another port, because the saved containers belong to that exact address. A browser cannot start the server, which is why the shortcut is needed.

### CHANGE: Phase 2 accepted; manual test results - 2026/10/09
**Accepted by the user.** Manual checklist items 1-7 passed in the user's own Chrome (real file dialog, silent repeat Save, external edit refused, deleted/renamed file not re-created, locked file refused, full Chrome restart, OneDrive folder).
- **Save As starting folder (the investigation):** after a full Chrome restart the Save As dialog **opens in the folder of the last saved file**. Passing the stored handle of the last saved file as `startIn` works across a restart (it replaces the earlier finding that localhost fell back to Documents). Result reported by the user.
- The five decisions listed at the end of Phase 2 (reserved-name underscore, no double extension, "Re-create file here" label, ask when the baseline is unknown, "Saved" note position) were accepted.
- Auto-start shortcut installed (see above). The bookmark `http://localhost:47613/` is the user's to add.

---

## 6. Phase 3 (pin, collapse, search, sort, move) and dark mode - built 2026/10/10

Backups for roll back: `Documentation/index.phase2.accepted.html` (Phase 2 as accepted) and `Documentation/index.phase3.before-darkmode.html` (Phase 3 before the dark mode button).

### CHANGE: Phase 3 built into the app - 2026/10/10
- **Pin / Unpin:** only one container pinned at a time; pinning another unpins the first. The pinned container is first in **both** sort modes. The header column shows a pin symbol (▲). Pinning scrolls to the container at the top; unpinning returns it to its place in the manual order and scrolls to it. Persisted.
- **Collapse / Expand:** a collapsed container shows only its title and its buttons (Save, Save As, Copy, Pin, Expand, Delete all work). The header column shows a collapsed symbol (▸). Persisted.
- **Search** (box at the top of the header column): filters containers and header entries as you type, by title and by text; case-insensitive; part of a word is enough; spaces only means no filter. A collapsed container that matches stays visible. The count reads "N of M containers". Escape clears the search. A "No containers match" message shows when nothing matches.
- **Sort toggle** (header column): **Manual order** or **Sort by last edited** (newest edit first, pinned first). The choice is remembered.
- **Manual order:** each container has a drag handle (⠿) and ↑ ↓ arrows (only in Manual order). Drag and drop is pointer based, with a drop line, automatic scrolling near the top and bottom of the window, and Escape to cancel. The manual order is remembered across restarts. New containers go to the top (below the pinned one). Containers stored before Phase 3 keep their newest-created-first order.

### CHANGE: Phase 3 decisions made without being asked (please confirm or change) - 2026/10/10
1. **Default order is Manual order**, not "last edited". It looks the same as Phase 1 (newest created first) until you move something, so nothing changes under you. Switch with the toggle; it is remembered.
2. **Last-edited order never moves a container under your cursor.** While focus is inside any container (text, title or a button), the new order waits. It is applied when you click somewhere outside the containers (blank space, header column, search box). Saving a container counts as editing it (the title lock updates its last-edited time).
3. **Collapsed containers still show a failure panel** (for example "file changed outside NoteTaker"), although the requirement says only title and buttons. Reason: an error that must be answered should not be hidden. Say if you would rather hide it.
4. **Search does not re-run while you type inside a container**, so a container does not vanish while you edit it. It is re-checked on the next search keystroke. The search is not remembered after a reload. A new container clears the search so it is visible.
5. **Moving is switched off while a search is active** (arrows and handle show a reason). Moving within a filtered list would be ambiguous.
6. **The pinned container cannot be dragged or moved**, and cannot be dropped onto (it stays first). Unpin it to move it.
7. **Not added:** dragging from the header column entries; moving by keyboard shortcut; remembering the search; matching on file name separately from the title (the title is the file name once saved).

### CHANGE: Dark mode button - 2026/10/10
**Requested by the user** ("a dark mode button").
- **Button** at the top right of the header: "☾ Dark" in light mode, "☀ Light" in dark mode.
- **Default:** follows the Windows / Chrome light-dark setting, including live changes while the page is open.
- **After you click it,** your choice is remembered in this browser and wins over the Windows setting. It is applied before the page paints (no flash of the wrong colours). If the browser blocks storage, the button still works for that page.
- **Scrollbars and form controls** follow the theme.
- **Fixed while doing this (a small visible change in the light theme too):** the blue "New container" button text (white on light blue was poor in dark), the red "BACKUP FAILED" text (too dim on dark), and the orange "Not saved to a file" mark (4.24:1 in light mode, below the 4.5:1 guideline; darkened from #b26a00 to #9a5b00).
- **Measured:** text contrast on 19 kinds of text in both themes; lowest is 5.04:1 dark and 4.92:1 light. Container and header column sizes and position are identical in both themes.

### CHANGE: Phase 3 and dark mode tests - 2026/10/10
- **Unit tests:** Phase 1 18, Phase 2 69, **Phase 3 47** (display order in both modes with pinning, tie-breaks, legacy order, manual moves, arrows, pin rules, search matching incl. characters that are special in patterns and unicode): all pass.
- **Real-browser tests:** Phase 1 72, Phase 2 73, **Phase 3 78** (pin, collapse including Save/Copy while collapsed and a failure panel while collapsed, search, arrows, sort modes and the "never under your cursor" rule, real-mouse drag and drop with the drop line, Escape, a pinned container, search active, auto-scroll on a page taller than the window, pre-Phase-3 data, and the dark mode tests): all pass, three consecutive runs for the Phase 3 suite before dark mode was added.
- **The tests can fail:** with "pinning unpins the previous card" removed, the pin tests failed.
- **Bugs found by testing and fixed:** (1) drag handlers were attached to the drag handle and relied on pointer capture; moves and the release did not reach them in the test browser. They now listen on the document. (2) A typo in the first dark mode patch (an invalid assignment) was caught by the syntax check.
- **Test mistakes of mine, not app bugs:** a real confirm box blocked a run; one test dropped on the wrong half of a container; one assumed a container was not already first.
- **Needs manual testing in your own Chrome:** how drag feels with a real mouse (speed of the automatic scrolling in particular), the look and feel of dark mode on your monitor, and behaviour over hours of use.

### CHANGE: Phase 3 decisions confirmed - 2026/10/10
The user confirmed all five Phase 3 decisions as written (Manual order as the default; last-edited order never moves a container under the cursor; failure panels stay visible on collapsed containers; search not re-run while editing and moving disabled during a search; the pinned container cannot be dragged or dropped onto). Phase 3 and dark mode now await the user's manual testing and feedback. Phase 4 (Open button) has not been started.

---

## 7. Phase 4 (Open button) - built 2026/10/10

Phase 3 and dark mode accepted by the user ("Everything looks good"). Backup for roll back: `Documentation/index.phase3.accepted.html`.

### CHANGE: Phase 4 built into the app - 2026/10/10
- **Open file...** button in the header, next to New container. Decision B3 stands: an Open button only, no recent-files list (containers already remember their files).
- Opens one or several `.txt` / `.md` files at once. Each becomes a new container at the top (below a pinned one): title = file name without extension, locked; linked to the file; the text is the file's content; **no "unsaved" mark** until you edit it. Save then goes straight to the file using the existing five-step routine, including the "changed outside NoteTaker" check (its baseline is the file's modified time at the moment it was opened).
- The dialog starts in the folder of the last file used (stored handle), as Save As does.
- If the file is **already open** in a container (including one linked by Save As), no second container is made: that container is scrolled into view and highlighted, and a note says "Already open". Open also clears an active search so the opened container is visible.
- The link, lock and baseline survive reloads and restarts like any other linked container.

### CHANGE: Phase 4 decisions made without being asked (please confirm or change) - 2026/10/10
1. **Opened files keep their format when saved.** A leading byte-order mark (BOM) is remembered and written back; Windows (CRLF) line endings are remembered and every line break is written back as CRLF. Opening a file and saving it without editing gives back the identical bytes. Without this, saving would have silently changed a Windows file to Unix line endings.
2. **Mixed or old-style line endings** (some CRLF, some LF; or lone CR) open with a yellow warning, and are saved with one style throughout (the majority style, LF on a tie). Dismissible. This is the only case where an open-then-save is not byte-for-byte.
3. **Files that are not valid UTF-8 text are refused, never opened:** Latin-1 / Windows-1252 text, UTF-16, and binary files. A yellow message names the file and the reason. Reason: guessing an encoding and saving back would damage the file.
4. **Size limit: 10 MB.** A larger file is refused with its size. (1,000,000 characters were already tested in Phase 2.)
5. **Several files at once:** the good ones open; a single message names only the ones that were refused.
6. **Save As from an opened container** writes the new file in the same style (BOM, CRLF) as the original.
7. **Messages (banners) now have a Dismiss button** (all of them, not only the Open ones).
8. **The first Save on an opened file may ask for permission.** A file chosen with the Open dialog starts read-only; the save routine asks for write permission inside the Save click (as for any linked file), and the "needs permission" panel appears after a restart if it is not granted. See the manual checklist.
9. **Not added:** reloading a file's contents from disk into an open container; dragging files onto the page; other file extensions; a UTF-16 option.

### CHANGE: Header highlight bug found and fixed (from Phase 1/3 behaviour) - 2026/10/10
Found while testing Open: clicking a header entry (or opening a file that is already open) for a container **far down the page** highlighted the neighbouring container.
- **Cause:** the highlight is held while the page scrolls to the container. The first version dropped the hold when the container was "not on screen", which is true at the start of any long scroll. Earlier tests only used nearby containers.
- **Fix:** the hold now lasts until the browser reports the scroll has finished (`scrollend`), with a 3-second safety limit and a fallback for browsers without that event. After that, scrolling by hand releases it as before.
- **Regression tests:** O11 in the Phase 4 browser tests (open an already-open file far down; click the last header from the top).

### CHANGE: Phase 4 tests - 2026/10/10
- **Unit tests** `Testing/phase4-unit.mjs`: **48 of 48**. Decoding and refusing (UTF-8 accents, CJK, emoji; BOM; CRLF, LF, mixed, lone CR; Latin-1, UTF-16, broken sequences, binary), putting files back **byte for byte** (plain, CRLF, BOM+CRLF, BOM+LF, no trailing newline, empty, BOM only, unicode, blank lines), encoding defaults, messages.
- **Real-browser tests** `Testing/phase4-browser.mjs`: **54 of 54**, three consecutive runs. Real file handles (Chrome's private file system), files written as raw bytes: the button and dialog options, opening a plain file, edit + Save with no dialog and no false alarm, BOM + CRLF kept, LF kept, mixed / lone-CR warning, Latin-1 and UTF-16 refused and untouched, over-10-MB refused, empty file, unicode, several files with one bad, already-open detection (including a Save As link), cancel, outside change / deletion after opening, reload then Save keeps BOM and CRLF, Save As keeps the style, dialog start folder, search cleared, opened container at the top in both sort modes, data stored before Phase 4.
- **The tests can fail:** with bad UTF-8 no longer refused, both the unit test and O7 failed; with the BOM no longer written back, 3 unit tests and O4 / O9 failed. The app was restored after each.
- **All suites after Phase 4:** unit 18 + 69 + 47 + 48 = 182, browser 72 + 73 + 78 + 54 = 277, all pass.
- **Needs manual testing in the user's own Chrome:** the real Windows file dialog; real files from the OneDrive notes folder (including "online only" files, which OneDrive must download to open); whether the first Save on an opened file asks for permission; and files made by other programs (Notepad, Word "save as text", Excel "CSV UTF-8") to see which are accepted or refused.

### CHANGE: Phase 4 manual test results (first report) - 2026/10/10
- Items 1, 2, 4, 5 and 6 of the checklist: correct (user).
- **Item 7:** the first Save on a file chosen with the Open dialog **does ask for permission**. Accepted by the user ("not overly concerned"). Behaviour unchanged.
- **Item 3 (non-text files): open question.** The user reports that choosing `*.*` in the Windows dialog lists Word files, and that they were able to edit a Word document. The dialog's file-type filter cannot be enforced (Windows lets you type `*.*`, and Chrome does not check the extension), so the safety net is the content check, not the extension.
  - **Checked here with Word-style files** (generated, not the user's file): `.docx` (deflated), `.docx` stored uncompressed, and old `.doc` are all **refused** as "not UTF-8 text". Word "Plain Text" saved as UTF-8, `.rtf` and `.htm` **open** (they are valid text; RTF and HTML show their markup). Word "Plain Text" saved in the default Windows encoding (smart quotes as single bytes) is **refused**.
  - **Not yet known:** what exactly the user opened and saw (extension, and whether a container opened). Waiting for the user's answer before changing anything.

### CHANGE: Word-file report resolved - it was a stale cached page - 2026/10/10
The user refreshed the browser and the Word file is now correctly rejected, so the earlier result was Chrome showing an old cached copy of the app. The content check works as designed (binary Word files refused). No change to the Open logic.

### CHANGE: Server now tells the browser to re-check for updates - 2026/10/10
**Why:** the plain `python -m http.server` sends no caching instructions, so Chrome may reuse an old copy of the app after an update. That is risky here because the safety checks are in the app code.
- **New:** `Launcher/serve.py`, a small server that serves one folder on 127.0.0.1 only and adds `Cache-Control: no-cache` (the browser asks "has this changed?" on every load; unchanged files answer 304, so it stays fast).
- **Changed:** `Launcher/start-notetaker-server.bat` now runs `serve.py` instead of `python -m http.server`. Everything else in the launcher is the same (waits for the F: drive, does nothing if the port already answers, default port 47613).
- **Tested on a spare port (47617):** 200 with `Cache-Control: no-cache`; a conditional request returns 304; `Testing` and `Documentation` still return 404; listens on 127.0.0.1 only. The test server was stopped.
- **Not yet active on the live server:** the server already running on 47613 (PID 27772) is the old kind and keeps running until it is restarted or Windows signs in again. Until then, a hard refresh (Ctrl+F5) after an app update gets the new version.

### CHANGE: Live server restarted on the new server - 2026/10/10
At the user's request the old server (PID 27772, `python -m http.server 47613 ...`, confirmed to be NoteTaker's before stopping it) was stopped and the new one was started through the Startup shortcut, the same path Windows uses at sign-in.
- **Verified on `http://localhost:47613`:** 200; `Cache-Control: no-cache`; a conditional request returns **304**; the page is the current one (Open and dark mode buttons present); `Testing` and `Documentation` return 404; listening on 127.0.0.1 only; exactly one NoteTaker server process (`python serve.py 47613 ...`, PID 14484).
- **Note:** the start took longer than 15 seconds this time (the launcher's port check). It had started when checked a little later.
- **Still untested:** an actual Windows sign-in starting the server by itself.

### CHANGE: Share package for a second person (Windows 11, Chrome, Python) - 2026/10/13
Built in `Share\` (nothing existing was modified): `NoteTaker-share-20261013.zip` plus the unzipped `Share\NoteTaker\` folder. Contents: `app\index.html` (byte-identical to the accepted version, SHA-256 d09bd9e6...5553905c), `Launcher\serve.py` (new, not a copy of the live one), `Start NoteTaker.bat`, `README.txt`, `VERSION.txt`. Decisions (confirmed): Python server, manual start only (no .vbs, no Startup shortcut), port 47613. Script types: .bat and .py only.
New server behaviour: finds its own folder (no drive wait), checks the port itself (replaces the PowerShell probe), says "already running" if a NoteTaker server answers (marker header X-NoteTaker), plain-English message if another program holds the port, if app/index.html is missing, or if Python is missing/only the Store stub.
Verified: unzipped to `D:\NT verify test\` (path with a space) and run on test port 47620; 127.0.0.1-only bind; no-cache header; only app\ served (README/serve.py/.. paths all 404); app loads, container survives reload, Save/Save As (stubbed picker) work; failure paths (port taken, no Python, Store stub only, server not running); all 8 existing suites (459 checks) pass against the packaged index.html; grep of the package finds no F:\, OneDrive, user name or note content; test ports absent from shipped files. Live server on 47613 untouched.
Not verified (needs a real second machine): real Windows Save dialog, SmartScreen/antivirus behaviour, python.org installer wording, Chrome settings page wording for clearing site data, behaviour of the Store stub on his machine.

### CHANGE: Share package README/launcher wording corrected against official sources - 2026/10/13
Python install steps rewritten for the "Python install manager" (docs.python.org/3/using/windows.html, section 4.1); the unverified "Add python.exe to PATH" instruction removed from README.txt and from the .bat message, and the wrong claim that the Store version "is not the real Python" removed (the docs say the Store and python.org versions are identical). Chrome clear-site-data steps replaced by Google's published steps (support.google.com/chrome/answer/95647). Other README clarity fixes after a literal walk-through. The .bat's Python check now reads empty input so a first-run prompt cannot hang it. Rebuilt ZIP: SHA-256 4C69B991...87C6E45B6EE; app\index.html unchanged (d09bd9e6...5553905c). Not re-run: browser tests and suites (server and app untouched); re-tested: start, already-running, port-busy, no-Python and Store-stub-only paths, personal-reference grep.

## Profiles work (Default personal brand / optional Mint profile)

### CHANGE: Profiles Step 0 baseline - 2026/10/13
Baseline before any change: all eight suites pass (unit 18+69+47+48 = 182, browser 72+73+78+54 = 277, total 459). Snapshot `Documentation/index.before-profiles.html`, SHA-256 d09bd9e6f7c1d04156ef47e374104fc4e297f428caf43cda8589c6ab5553905c. Mockup copied (not moved) from Downloads to `Documentation/NoteTaker-Profiles-mockup.html`.

### CHANGE: Profiles Phase 1 - theme layer, no visual change - 2026/10/13
- `app/index.html` `<style>` only. New tokens in `:root`: `--radius-card` (6px), `--radius-ctl` (4px), `--radius-line` (2px), `--font-ui`, `--font-mono`, `--fw-normal` (400), `--fw-strong` (600), `--fw-head` (700), `--field-locked` (the locked-title tint, was an inline color-mix). All colours were already variables (10 per theme); they are unchanged. No JS, no markup, no layout change.
- Text area font stack kept exactly: `Consolas, "Courier New", monospace`. UI font stack: `system-ui, "Segoe UI", sans-serif`.
- Evidence: `Testing/profiles-visual.mjs` captures 195 elements x 20 computed properties (colours, borders, radii, fonts, weights, sizes, display, height, width) at 1920x1080 and 1366x768, light and dark, normal and failure states (warning/error banners, failure panels, backup failed). All 8 before/after fingerprints are byte-identical. Screenshots in `Documentation/phase1-screenshots/`. Pixel diffs are timestamps (the app formats times from stored values) and a 2 px scroll offset in the failure-state shots; run-to-run noise on the unchanged file is the same size.
- Tools added: `Testing/profiles-visual.mjs`, `Testing/png-diff.mjs`.
- All eight suites after Phase 1: 459 of 459.

### CHANGE: Profiles Phase 2 - Default = personal brand, two-row header - 2026/10/13
- **Tokens** (`app/index.html` `<style>`): Default light on `:root`; dark in the two existing dark blocks (system setting, and `data-theme="dark"`). A profile can override them with `:root[data-profile="..."]` blocks (Phase 3). New tokens: `--field`, `--field-locked`, `--heading`, `--card-line` (transparent: cards have no outline), `--focus`, `--cta-bg/--cta-text`, `--btn-bg/--btn-text`, `--sig` (corner circle), `--circle`, `--radius-field`, `--radius-area`. `--on-accent` removed (replaced by `--cta-text`).
- **Radii mapping (mockup -> tokens):** cards, side box, header-list entries 14 -> `--radius-card`; buttons, search, banners, panels, toast 8 -> `--radius-ctl`; title field 10 -> `--radius-field` (new); text area 12 -> `--radius-area` (new); drop line 2 -> `--radius-line`.
- **Fonts/weights:** Arial for the UI (`--font-ui`); text area stack unchanged (`Consolas, "Courier New", monospace`). `--fw-strong` is now 700 (Arial has no 600).
- **Header:** two rows, whole header sticky, 76 px (`--hdr`, was 52). Row 1 heading; row 2 backup line, New container, Open file..., count, theme button (right). The backup line has `min-width: 10em` so the buttons beside it do not shift as its text changes. Heading kept at 18 px (the mockup's 28-40 px was not taken: it would cost more height).
- **Corner circle:** drawn as a fixed-position background gradient on `body` and `header` (circle centre 110 px in from the right, 70 px down, radius 220, as in the mockup), so it is decorative, cannot be clicked, sits behind everything, and joins up with the sticky header. It stays at the top right of the window while scrolling (it does not scroll away with the page). Only the theme button lies over it; measured 8.56 (light) and 8.81 (dark).
- **Filled buttons from the mockup:** Open file... and Save use `--btn-bg` (Muted Blue Dark #325A7A with white text in light; Mist #EEF2F7 with Midnight text in dark). New container uses `--cta-bg` (Midnight / Soft sky). Other buttons are outlined.
- **Radio buttons (sort row):** now drawn by the app (ring = `--line`, dot = `--accent`) because the browser's own grey ring measured 1.98:1 in Default dark.
- **Focus ring and placeholder:** `:focus-visible` 3 px ring in `--focus`; placeholder text uses `--muted`.
- **Existing test changed (deliberate):** `phase3-browser.mjs` P10 decided "the page is dark" with a brightness threshold of 0.2; the approved Default dark background (#253D52) measures 0.225, so the threshold is now 0.3 (light is still above 0.8). No other existing test was changed.
- **New tests:** `Testing/profiles-phase2-browser.mjs` (62 checks): Default tokens as rendered, fonts, radii, no shadows/stripes, circle, header layout/sticky/overflow at 1920x1080 and 1366x768 (including BACKUP FAILED), Copy toast does not resize the card, contrast of 28 kinds of text and 15 borders/rings/icons plus focus rings, measured from the rendered page (corner-circle tint included), light and dark at both sizes; system-setting behaviour. Mutation check: Mist gray #9A9AA4 borders make 3 checks fail (2.79); restored.
- **Baseline for Phase 3:** `Documentation/default-baseline/` (8 style fingerprints of 195 elements x 20 properties + 16 screenshots; names `default-p2-<width>-<theme>[-states]`).
- **All eight existing suites after Phase 2:** 459 of 459; plus 62 new.

### CHANGE: Profiles Phase 3 - profile switch, optional Mint profile, embedded font and logo - 2026/10/14
**Files:** `app/index.html` (switch, loader, tokens; no Mint content), `app/mint-profile.js` (new, optional), `Documentation/mint-build/` (parts and build script), `Documentation/index.profiles-phase2.html` (Phase 2 rollback, SHA-256 db14ba63...cffa1, rebuilt by reversing the Phase 3 edits and checked against the hash reported at the end of Phase 2).
- **Loading:** `index.html` has `<script src="mint-profile.js" onerror=...>` in `<head>`, blocking, after the styles. The file adds a `<style>` before first paint and sets `window.NoteTakerMint`. A small inline script then reads `notetaker-profile` from localStorage and sets `data-profile="mint"` on `<html>` before first paint. No flash of Default and no font swap (tested frame by frame: Mint tokens in every frame; the Light face is already loaded in the first frame with text).
- **File absent:** the Profile control (label and group) is not shown. If the stored choice is `mint`, Default is shown, the existing dismissible banner says so once per page load, and the stored choice stays `mint`. **The missing file costs one 404 line in the server log and one "Failed to load resource" line in the browser console on every load** (a network message, not a code error; nothing is thrown). This is accepted. Any copy of the app without `mint-profile.js` (such as the share package) will show it.
- **Switch:** Default | Mint group with a visible "Profile" label in row 2 beside the theme button; profile and light/dark are independent (four looks). It fits at 1366 px (no label dropped). Key `notetaker-profile`.
- **Selectors:** Mint uses the mockup's structure (profile x prefers-color-scheme dark x manual dark/light). Tested all six OS/manual combinations for both profiles, including OS dark + no choice, OS dark + manual light, OS light + manual dark, and a live OS change.
- **Font:** SIL OFL 1.1, Lato 2.015 (latofonts.com, Lato2OFL.zip), copyright 2010-2015 tyPoland Lukasz Dziedzic, Reserved Font Name "Lato". A Latin subset is a Modified Version (OFL FAQ 2.6), so it is renamed internally to "NT Brand Sans" and `mint-profile.js` carries the copyright notice and the full licence text. Subset: Latin (Google's "latin" range), WOFF2, layout features kept. Sizes: Light 41,228 B; Regular 42,344 B; Bold 42,000 B; Italic 43,792 B (Regular Italic, added at the user's request because "untitled" header entries are italic; tested as the real face, not synthesised). `mint-profile.js` total 272,876 B. Weight 600 (`--fw-strong` is 700 anyway) renders as Bold. Tools: fonttools and brotli in a throwaway venv outside the project (deleted afterwards).
- **Logo:** the official Mint primary logo (SVG, from the Mint brand skill; identical to the mockup's), drawn as a CSS background of `#logoSlot` (width set, height from its proportions 111.22:54.6; never recoloured, rotated, cropped or split from its tagline). Dark: light plate #CFD8DB, padding 14px 22px. Only shown in Mint. **Placement is provisional: option (a), small, in row 1 at the right. See `Documentation/phase3-logo-options/` and the report; the user decides.** Header heights: Default 76 px; Mint light 88 px; Mint dark 116 px (the plate adds height; the orange CTA at 19 px bold adds some in Mint). Options (measured, header px light/dark): (a) 88/116, (b) 84/101, (c) 155/183.
- **Deviations from the mockup's Mint tokens** (Mint hexes are never altered; each fix picks a different Mint palette colour): control borders light #CFD8DB -> #626E73 (1.25 -> 4.53 on the grey panels); control borders dark rgba(255,255,255,.3) -> #85C4EB (2.11 -> 8.36 / 4.4 on cards); light highlight (pinned ring, hover and active borders, radio dot) orange #F15927 -> Mint blue #184B9A (2.92 on grey -> 7.2); header-list symbols (text glyphs) blue/sky instead of orange (`--icon`); active header entry fill (new `--active-bg`) white in light and #243C7A in dark (the mockup's tints took muted text to 3.63 and the badge to 3.75-3.82). The orange CTA (#F48130 fill, bold #243C7A at 19 px) is 4.01:1 for its label (large text) but its fill on white is 2.62:1 (3:1 boundary): accepted because the label identifies the button; decision pending.
- **Mint semantic colours (not wine):** the app's own: light ok #217a3c, bad #c62828, warn #9a5b00; dark ok #6fcf8a, bad #ff8a80, warn #ffc766 (as Default). All measured, none failed.
- **Audit of orange and green** (`Testing/profiles-glyph-audit.mjs`): Mint light: only the CTA (orange fill and border) and the backup-ok text (the app's own green on the white page). Mint dark: CTA, the pinned ring and active-entry border (thin orange lines on dark, 3.2-4.0:1), the selected radio's dot, backup-ok text. No orange or green text on grey panels; no orange text below large/bold; no white text on orange; the pin, lock, badges, grip and arrows use text, muted, icon or warn colours only.
- **Tests added:** `Testing/profiles-phase3-unit.mjs` (resolution, key, unavailable Mint, label, page-start simulation); `Testing/profiles-phase3-browser.mjs` (index.html free of Mint hex/Lato/logo; Mint absent via a second server without the file; switching and persistence; six OS/manual combinations x 2 profiles; computed tokens per look; fonts; no-flash frame recording; header, logo and Profile control at 1920 and 1366 incl. BACKUP FAILED; Mint rules; contrast of every text and border kind, focus rings, and hover + pressed (forced) states in all four looks; radios; only-localhost network assertion; no unhandled errors); the existing Phase 2 browser test still runs. Hover/pressed measured with Chrome's forced pseudo-states. `profiles-visual.mjs` (PROFILE=mint) and `profiles-logo-options.mjs` are the evidence tools.
- **Mutation check:** changing Mint dark `--card` by one unit fails 4 checks (S4 x3 and the token check); restored (file hash identical).
- **Baseline for Phase 4:** `Documentation/four-looks-baseline/` (8 fingerprints of 195 elements x 20 properties and 16 screenshots, for Default and Mint, light and dark, 1920x1080 and 1366x768).
- **Test infrastructure notes:** the browser tests are slow (the Phase 3 file takes about 25 minutes); `QUICK=1` runs only the contrast section and `ONLY_S45=1` stops after the token checks. Stray favicon.ico 404s from the test server are ignored by the error check.
- **Share package (not touched):** it needs a rebuild because `index.html` changed (header, profile control, loader); the friend's copy would show the personal brand as Default. It must NOT include `mint-profile.js` (Mint then stays hidden; each load logs one 404 for it in the server log and the browser console, which the README can mention). Its `serve.py` needs no change. The old index.html in the package (SHA d09bd9e6...) is the pre-profiles one.
- **All suites after Phase 3 (2026/10/14):** the eight existing suites 459 of 459 (unit 18 + 69 + 47 + 48, browser 72 + 73 + 78 + 54); Phase 2 browser 62 of 62; Phase 3 unit 20 of 20; Phase 3 browser 127 of 127. The temporary venv and the downloaded font packages were deleted.

### CHANGE: Profiles Phase 4 - logo option (d), Mint heading token, HDR_PX bug fix, final audit - 2026/10/14
Rollback points: `Documentation/index.profiles-phase3.html` and `mint-profile.profiles-phase3.js` (Phase 3 as accepted, with the provisional option (a) logo), `index.profiles-phase2.html` (Phase 2).
- **Logo placement (the user's choice: option d).** The 190 px Mint logo sits at the top of the container-list column, left-aligned, above the list box, and stays pinned with the sticky column. `#logoSlot` moved from the header into `<aside id="side">` (an empty slot in `index.html`; the Mint file draws it as a CSS background). Option (a) code and the Mint `--hdr` 88px / 116px rules are removed. Cost: the list loses the logo block (93 px light, 121 px dark with the plate) plus a 14 px gap: at 1920x1080 the 16-entry list goes 814 -> 752 (light) / 724 (dark); at 1366x768 547 -> 440 / 412.
- **Heading size token.** `--h1-size` / `--h1-lh`: Default 18 px / 22 px bold; Mint 24 px / 30 px Light (set in the Mint light block, inherited by Mint dark).
- **Header height.** The header is now `min-height: var(--hdr-min)` (76 px). `--hdr` is no longer a fixed rule: a ResizeObserver keeps it equal to the header's real height. **Real sticky header height, measured at 1920x1080 and 1366x768: 76 px in Default light, Default dark, Mint light and Mint dark** (the content alone needs 58.6 px in Default and 73.6 px in Mint, so Mint has 2.4 px to spare and would grow rather than clip).
- **BUG FIX: HDR_PX.** The JS constant `HDR_PX = 52` ("matches --hdr") went stale when the header became 76 px in profiles Phase 2 (and 88/116 px in Mint during Phase 3). `ensureVisible` therefore left a container's top up to 24-64 px under the header, and the header highlight's reading line was off by the same amount (the drag auto-scroll edge too). Replaced by `headerPx()`, which reads the real height from the page on every use; `--hdr` follows it. All uses (ensureVisible, the header-highlight reading line and its scrollend logic, drag auto-scroll) go through `headerPx()`.
- **Verification of the fix** (`Testing/profiles-phase4-browser.mjs`, 56 checks): in all four looks at 1920x1080 and 1366x768, a container whose top is 25 px under the header is, after a click in it, fully below the header (top = header height + 12 px); `--hdr` equals the real height; the list column sticks 10 px below the header; making the header taller (140 px) moves `--hdr` and the column at once; the header's content fits and nothing overflows.
- **Existing assertions changed (tightened, none weakened):**
  1. `phase1-browser.mjs` T9d: `vis` required `top >= 52`; now requires `top >= HDRH` (the real rendered header height, read from the page). The click point used by T9d (`lo = 70`) is now `HDRH + 6`, so the click can no longer land under the header. The two set-up checks `g.top > 52` and `g.top < 52` now compare with `HDRH`. Reason: 52 was the stale value; the test now fails on a stale value.
  2. `phase3-browser.mjs` P5 ("the moved container is fully on screen"): `r.top >= 52` is now `r.top >= <real header height>`.
  3. (Earlier, profiles Phase 2) `phase3-browser.mjs` P10: the "page is dark" brightness threshold 0.2 -> 0.3 for the approved Default dark background.
- **Mutation check:** with `headerPx` temporarily returning 52, `profiles-phase4-browser.mjs` failed (--hdr 52 instead of 76, container top 64 < 76, list column at 62 instead of 86, the taller-header check) and `phase1-browser.mjs` T9d failed ("a container cut off at the top brings all of it into view": top 64). `phase3-browser.mjs` P5 did **not** fail (that scenario ends with the container well below the header, so it is not sensitive to the constant; its tightening is correct but it is not the test that guards this). Restored (from a copy taken before the mutation).
- **Final contrast audit** (rendered page; lowest figure per look, the same at both widths; the `FINAL CONTRAST AUDIT` block in the Phase 3 browser test output). Targets: text 4.5 (large text 3); borders, rings, focus and hover borders 3.
  - Default light: text 4.77 (backup line on the page); border 3.21 (profile group on the corner circle); focus 3.21; hover text 7.29; hover border 3.21.
  - Default dark: text 4.73 (unsaved badge on a card); border 3.65 (error panel); focus 3.90; hover text 6.01; hover border 3.90.
  - Mint light: text 4.53 (meta line on grey); large text 4.01 (New container label); border 2.62 (New container fill on white); focus 7.20; hover text 5.70; hover border 4.53.
  - Mint dark: text 5.42; large text 4.01; border 3.04 (Save button fill on a card); focus 4.42; hover text 7.02; hover border 3.20.
  - **Below target: one item only:** Mint light, the New container button's fill on the white page is 2.62:1 (3:1 boundary target). Accepted by the user ("stays as built, no outline"); its label is 4.01:1, which passes as large bold text (3:1).
- **Four-looks fingerprints refreshed:** `Documentation/four-looks-final/` (8 fingerprints of 195 elements x 20 properties and 16 screenshots) from the final files. `four-looks-baseline/` (Phase 3) is kept untouched.
- **Files in Documentation that were updated, not new:** `mint-build/subset-fonts.py` (now takes folders as arguments), `mint-build/mint-values.json` and `mint-build/mint-profile.template.css` (option (a) values removed, heading token added). No other existing file in Documentation was overwritten.

### REFERENCE: the Mint profile and how it is made
- **Source of the font:** Lato 2.015 (its README: "Version 2.015; Latin+Cyrillic+Greek+IPA opensource"), from https://www.latofonts.com/files/Lato2OFL.zip (18 desktop TTFs; the official download page is https://www.latofonts.com/download/). Licence: SIL Open Font License 1.1 (`Documentation/mint-build/Lato-OFL.txt`; https://scripts.sil.org/OFL), copyright (c) 2010-2015 tyPoland Lukasz Dziedzic, Reserved Font Name "Lato".
- **SHA-256 of the sources** (identical in two separate downloads): zip `42b54e96c07e299d967fc3227c7bd63a20d6cfb1dc8fd6dae83628091e20a5b8` (6,102,132 bytes); `Lato-Light.ttf` `e9d59afb6d9cb9cf6e8d8159d4639d5b577e29efc64a15182f228659cfc1e818` (644,556); `Lato-Regular.ttf` `6f6940be0835c3ddec9199e5fc42be4cbc61ebcfd58c623fdf719366253f1780` (657,212); `Lato-Bold.ttf` `bf1b8130069b44b9148eeece35e5423bedac49777ba746615b826b8276574a7b` (657,188); `Lato-Italic.ttf` `8c863f833b12bc8486671d26e3a58b13b0f9eaff1d6b10398e7c107a9b7ee05a` (723,544); `OFL.txt` `bac163b7ef3044511d80804165ff7ca3df6677da83ed32f21fa6c17041d6fa28`; `README.txt` `e6a71e5f63f5d6204c3294e72cb95fa60ace33750567e2e8a0102044fbef2c3e`.
- **Subset and rename steps and options:** `Documentation/mint-build/subset-fonts.py` (usage: `python subset-fonts.py <folder with the TTFs> <output folder>`) in a throwaway virtual environment with `fonttools 4.66.1` and `brotli 1.2.0`. Subset to Google's "latin" range `U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+2074, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD` (256 code points, 531 glyphs); `layout_features = ["*"]`, `notdef_outline = True`, `glyph_names = False`, hinting kept; WOFF2. Renamed (OFL condition 3): name IDs 1 and 16 = "NT Brand Sans", 4 = "NT Brand Sans <style>", 6 = "NTBrandSans-<style>", 3 = "NTBrandSans-<style>;subset of Lato 2.015"; copyright (0) and licence (13, 14) entries kept. Regeneration was tested: a fresh run from freshly downloaded sources produced fonts with identical code points, advance widths, every glyph outline and layout features (the bytes differ slightly because WOFF2 output carries a timestamp). Sizes: Light 41,228; Regular 42,344; Bold 42,000; Italic 43,792 bytes. The venv and the downloads were deleted afterwards.
- **Build:** `python Documentation/mint-build/build-mint-profile.py` writes `app/mint-profile.js` from `mint-profile.template.css` (tokens and rules), `mint-values.json` (values chosen by measurement), the four `.woff2` files, `mint-logo-primary.svg` (the official logo from the Mint brand skill, identical to the mockup's) and `Lato-OFL.txt` (embedded as the licence text in the file's header). Plain Python, no packages.
- **The missing-file 404:** `index.html` loads `mint-profile.js` as a blocking script in `<head>`. When the file is absent (for example in the share package), every page load causes one request that fails with 404: one line in the server log (`code 404, message File not found`) and one console line ("Failed to load resource: the server responded with a status of 404"). No exception is thrown; the `onerror` handler only sets a flag; the Profile control is hidden and the app runs in Default. Accepted by the user.
- **Selector structure (how profile and theme combine):** Default tokens are on `:root` (light), in `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { ... } }` (dark by system setting, unless the user chose light) and in `:root[data-theme="dark"] { ... }` (dark by choice). Mint (in `mint-profile.js`, a `<style>` appended to `<head>` after the app's own style) repeats the same three: `:root[data-profile="mint"]` (light), `@media (prefers-color-scheme: dark) { :root[data-profile="mint"]:not([data-theme="light"]) }` and `:root[data-profile="mint"][data-theme="dark"]`. The Mint dark rules have higher specificity than Default's dark rules, so Mint dark always wins over Default dark; the Mint light block is later in the source than Default's dark rules at equal specificity, so a token the Mint dark block does not set falls back to Mint light, then to Default. Every token that differs by theme is set in both Mint blocks, so nothing leaks. `data-profile="mint"` is set on `<html>` before first paint by a small inline script that follows the blocking `mint-profile.js` tag; `data-theme` is set by the first inline script in `<head>`; the pure functions `resolveProfile` and `themeLabel` are in a `<profile-logic>` block that `Testing/profiles-phase3-unit.mjs` loads. Profile key: `notetaker-profile` (localStorage); theme key: `notetaker-theme`.
- **Token reference** (generated from the shipped files by reading the CSS; every CSS variable by profile and theme; `*` = not set for that look, the value shown is the one it inherits):

| Token | Default light | Default dark | Mint light | Mint dark |
|---|---|---|---|---|
| `--bg` | `#EEF2F7` | `#253D52` | `#FFFFFF` | `#243C7A` |
| `--card` | `#FFFFFF` | `#325A7A` | `#EDEEF0` | `#184B9A` |
| `--field` | `#FFFFFF` | `#253D52` | `#FFFFFF` | `#243C7A` |
| `--field-locked` | `#EEF2F7` | `#325A7A` | `#CFD8DB` | `#184B9A` |
| `--text` | `#253D52` | `#FFFFFF` | `#475054` | `#FFFFFF` |
| `--muted` | `#525254` | `#EEF2F7` | `#626E73` | `#CFD8DB` |
| `--heading` | `#253D52` | `#FFFFFF` | `#184B9A` | `#FFFFFF` |
| `--line` | `#4880AE` | `#A0C2DB` | `#626E73` | `#85C4EB` |
| `--card-line` | `transparent` | `transparent` | `transparent` | `transparent` |
| `--accent` | `#4880AE` | `#A0C2DB` | `#184B9A` | `#F48130` |
| `--accent-bg` | `#EEF2F7` | `#253D52` | `#CFD8DB` | `rgba(255, 255, 255, .14)` |
| `--focus` | `#4880AE` | `#A0C2DB` | `#184B9A` | `#85C4EB` |
| `--active-bg` | `#EEF2F7` | `#253D52` | `#FFFFFF` | `#243C7A` |
| `--icon` | `#4880AE` | `#A0C2DB` | `#184B9A` | `#85C4EB` |
| `--cta-bg` | `#253D52` | `#A0C2DB` | `#F48130` | `#F48130` |
| `--cta-text` | `#FFFFFF` | `#253D52` | `#243C7A` | `#243C7A` |
| `--btn-bg` | `#325A7A` | `#EEF2F7` | `#184B9A` | `#184B9A` |
| `--btn-text` | `#FFFFFF` | `#253D52` | `#FFFFFF` | `#FFFFFF` |
| `--btn-line` | `#325A7A` | `#EEF2F7` | `#184B9A` | `#65A1D7` |
| `--sig` | `rgba(72, 128, 174, .14)` | `rgba(160, 194, 219, .12)` | `transparent` | `transparent` |
| `--ok` | `#217a3c` | `#6fcf8a` | `#217a3c` | `#6fcf8a` |
| `--bad` | `#c62828` | `#ff8a80` | `#c62828` | `#ff8a80` |
| `--warn` | `#9a5b00` | `#ffc766` | `#9a5b00` | `#ffc766` |
| `--warn-bg` | `#fff4d6` | `#3b3317` | `#fff4d6` | `#3b3317` |
| `--warn-line` | `#9a5b00` | `#ffc766` | `#9a5b00` | `#ffc766` |
| `--err-bg` | `#fde4e4` | `#3d1d1d` | `#fde4e4` | `#3d1d1d` |
| `--err-line` | `#c62828` | `#ff9d94` | `#c62828` | `#ff9d94` |
| `--cardw` | `1060px` | `1060px` | `1060px`* | `1060px`* |
| `--idxw` | `528px` | `528px` | `528px`* | `528px`* |
| `--texth` | `400px` | `400px` | `400px`* | `400px`* |
| `--fs` | `14px` | `14px` | `14px`* | `14px`* |
| `--hdr` | `76px` | `76px` | `76px`* | `76px`* |
| `--hdr-min` | `76px` | `76px` | `76px`* | `76px`* |
| `--radius-card` | `14px` | `14px` | `20px` | `20px`* |
| `--radius-ctl` | `8px` | `8px` | `8px`* | `8px`* |
| `--radius-btn` | `8px` | `8px` | `999px` | `999px`* |
| `--radius-field` | `10px` | `10px` | `10px`* | `10px`* |
| `--radius-area` | `12px` | `12px` | `12px`* | `12px`* |
| `--radius-line` | `2px` | `2px` | `2px`* | `2px`* |
| `--font-ui` | `Arial, Helvetica, sans-serif` | `Arial, Helvetica, sans-serif` | `"NT Brand Sans", Arial, Helvetica, sans-serif` | `"NT Brand Sans", Arial, Helvetica, sans-serif`* |
| `--font-mono` | `Consolas, "Courier New", monospace` | `Consolas, "Courier New", monospace` | `Consolas, "Courier New", monospace`* | `Consolas, "Courier New", monospace`* |
| `--fw-normal` | `400` | `400` | `400`* | `400`* |
| `--fw-strong` | `700` | `700` | `700`* | `700`* |
| `--fw-head` | `700` | `700` | `300` | `300`* |
| `--cta-size` | `14px` | `14px` | `19px` | `19px`* |
| `--cta-weight` | `400` | `400` | `700` | `700`* |
| `--h1-size` | `18px` | `18px` | `24px` | `24px`* |
| `--h1-lh` | `22px` | `22px` | `30px` | `30px`* |
| `--logo-w` | `190px` | `190px` | `190px` | `190px`* |
| `--logo-plate` | `transparent` | `transparent` | `transparent` | `#CFD8DB` |
| `--logo-plate-pad` | `0` | `0` | `0` | `14px 22px` |
| `--circle` | `radial-gradient(circle 220px at calc(100% - 110px) 70px, var(--sig) 219px, transparent 220px)` | `radial-gradient(circle 220px at calc(100% - 110px) 70px, var(--sig) 219px, transparent 220px)` | `radial-gradient(circle 220px at calc(100% - 110px) 70px, var(--sig) 219px, transparent 220px)`* | `radial-gradient(circle 220px at calc(100% - 110px) 70px, var(--sig) 219px, transparent 220px)`* |

- **All suites after profiles Phase 4 (2026/10/14), run once in full:** the eight existing suites 459 of 459 (unit 18 + 69 + 47 + 48; browser 72 + 73 + 78 + 54); profiles Phase 3 unit 20 of 20; profiles browser: Phase 2 62, Phase 3 135, Phase 4 56, all pass. Total 732 (unit 202, browser 530).
- **Final snapshots:** `Documentation/index.profiles-final.html` and `Documentation/mint-profile.profiles-final.js`, byte-identical to `app/index.html` and `app/mint-profile.js` (SHA-256 below). `app/` holds exactly those two files.
  d95081162cfb8a603a1790f7f832adaf3ead2f01a1f0b8afca40e8eeef5d986c *app/index.html
  e24356f685b73e8ee1dfb002c0129e19f3cead165c55d630cc4e6f0381bcde11 *app/mint-profile.js

### CHANGE: Tidy-up: superseded items moved to `_to_delete\`, "page is dark" threshold tightened to 0.25 - 2026/10/14
- **Moved (not deleted) to `_to_delete\`, keeping relative paths, for the user to delete in Explorer; 125 files, 9,820,399 bytes; the list with original path, size and SHA-256 of every file is `_to_delete/MANIFEST.txt`.** Why: they were superseded or were evidence for work that is finished, and nothing reads them (checked by searching every text file; no test, script or the app refers to any of them; only documents mention them). Moved: `Share.zip` (a zip of the whole `Share` folder); `Share/NoteTaker-share-20261013.zip` and `Share/NoteTaker/` (the 13 Oct share package, replaced by `Share/NoteTaker-share-20261014.zip`); `Documentation/default-baseline/` (profiles Phase 2 fingerprints and screenshots), `Documentation/four-looks-baseline/` (Phase 3), `Documentation/phase1-screenshots/`, `Documentation/phase3-logo-options/` (logo options a to e); `Testing/profiles-logo-options.mjs` (the prototype that made options a to c; nothing imports or runs it), `Testing/mockup-card-size.html`, `Testing/mockup-layout-sidebar.html`, the four `Testing/Snipaste_*.png`, `Testing/README.md` (described the original handle-test harness; the project summary already called it out of date); and `handle-test.html` from the project root (byte-identical to `Testing/handle-test.html`, which stays). Kept in place: `Documentation/four-looks-final/`, `mint-build/`, the final and rollback snapshots, the profiles mockup, `DATA/`, `Testing/GTEST4/`, `Testing/phase1-screenshot.mjs`, `Testing/phase2-onedrive-mtime.mjs`, `Testing/TEST-PLAN.md`, `app/`, `Launcher/`, `Share/NoteTaker-share-20261014.zip`.
- **Threshold change in `Testing/phase3-browser.mjs` (the original Phase 3 suite, 78 checks): the "page is dark" brightness threshold in P10, from `bgLum() < 0.3` to `bgLum() < 0.25`, at lines 301, 316, 318, 320 and 324** (all five; those are the five lines that were raised from 0.2 to 0.3 in the profiles Phase 2 work, when the approved Default dark background #253D52 made the old 0.2 fail). The check asserts brightness BELOW the threshold, so 0.25 is stricter than 0.3. Measured brightness in all five states: 0.2252 (Default dark), margin 0.0248 under 0.25 (Default light measures 0.9471; the "page is light" checks, above 0.8, were not changed). Nothing else in the file changed (a line-by-line comparison shows exactly these five lines differ). Result: 78 of 78 pass.
- **Earlier notes that say "P10" in "profiles Phase 2"** (the "Existing test changed (deliberate)" item in the profiles Phase 2 entry, and item 3 of "Existing assertions changed" in the profiles Phase 4 entry) **refer to this same file, `Testing/phase3-browser.mjs`** (not to `Testing/profiles-phase2-browser.mjs`, which has no P10 or brightness check).
- **Older lines that mention the moved items are now historical** (for example the lines about `default-baseline`, `four-looks-baseline`, `phase1-screenshots`, `phase3-logo-options`, `profiles-logo-options.mjs`, the 13 Oct share package, `Testing/README.md`, and "kept in `Documentation/four-looks-baseline/`"). They were not rewritten.

### CHANGE: Corrected stale statements in the two summaries (documentation only) - 2026/10/14
In `Documentation/NoteTaker_Profiles_Summary.md`: section 8 now describes the 14 Oct share package (it used to say "not rebuilt") and the logo-placement line (about 42) notes that the option screenshots and prototype script were moved to `_to_delete/`. In `Documentation/NoteTaker_Project_Summary.md`: the Testing/ and root `handle-test.html` statements in the folder-layout row (line 58) and the `Testing/README.md` statement (line 113) now say what was moved to `_to_delete/` on 14 Oct. Each correction carries an "(updated 2026-10-14: ...)" mark; nothing else in either file was changed. Note: the share package rebuild and its verification (2026-10-14) were not logged here when they were done; the verification is described in section 8 of the Profiles summary.

### CHANGE: Two more stale statements corrected in NoteTaker_Project_Summary.md (documentation only) - 2026/10/14
Line 58 (size of `app/index.html`, and that `app/` also holds `mint-profile.js`) and line 99 (the profiles suites and the last full run of 732 checks) now carry "(updated 2026-10-14: ...)" marks; the original statements were kept. Sizes read from disk; counts from the "All suites after profiles Phase 4" entry above; suite names from `Testing/`. Nothing else in the file changed.
