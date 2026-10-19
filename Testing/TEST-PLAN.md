# TEST-PLAN – File System Access handle persistence

Fill in the **Observed** columns. Repeat everything for **each origin (file://, http://localhost:8000)** in **Chrome only** (Edge is deliberately out of scope). Record the browser version at the top. Use the "Copy log" button and keep the log for each test.

| Browser | Version | Origin tested | Date |
|---|---|---|---|
| Chrome | 155.0.8059.40 (Official Build, 64-bit) | file:// |2026/10/09|
| Chrome | 155.0.8059.40 (Official Build, 64-bit) | http://localhost:8000 |2026/10/09|

Setup: put test files in a normal folder (e.g. Documents). Start with a clean state: click **Wipe IndexedDB** on the page before each origin's first run.

Harness note: the harness restores handles on load but does **not** reload file contents into the textareas (they reset to default text), and Save only writes. To verify what is on disk after a reopen, use **Check** (shows `size` and `lastModified` from `getFile()`) or open the file outside the browser. "File not brought back" is therefore expected harness behaviour, not an API failure.

---
## ADDITIONAL TESTING
1. Move the html page to another folder. Observed: file:// works. localhost returns a 404, which is expected (server serves from its own folder).
   - After moving the page (Chrome 155.0.8059.40): localhost fails with a 404; file:// succeeds. No unexpected log entries.
---

## A. Same session
1. Open the harness. Slot 1 -> Save As, choose a name. Note `handle.name` in the log vs suggested name.
2. Edit the text, click Save twice.

| Expected | Observed |
|---|---|
| Save As dialog once; subsequent Saves silent, no prompt | Correct|

## B. Close tab, reopen (same browser session)
1. With slots 1-3 bound (Save As each), close the tab; keep another Chrome window open. Reopen the page.
2. Read the status line per slot (no click). Then click Check on each slot (note size/lastModified), then click Save on slot 1.

| Slot | Expected permission on load | Observed on load | Prompt on first Save? (expected: yes if "prompt") | Observed |
|---|---|---|---|---|
| 1 | prompt (or granted) |granted | NO| permission: granted.  |
| 2 | prompt (or granted) | granted| NO| permission: granted.  |
| 3 | prompt (or granted) | granted| NO| permission: granted.  |

## C. Fully quit browser, reopen
1. Quit **all** windows (check Task Manager for leftover chrome.exe, incl. the "continue running background apps" setting). Reopen the page.

**Results below are for localhost.** file:// behaves differently (prompt returns after restart, see F).

| Slot | Expected | Observed permission on load (localhost) | Prompt on Save? |
|---|---|---|---|
| 1 | prompt |granted. |  No |
| 2 | prompt | granted |  No |
| 3 | prompt | granted |  No |

file:// : permission on load = prompt; Save prompts "Allow / Don't allow" (see F).

Handles still restored from IndexedDB at all? Observed: Yes (see I). Textarea contents are not restored (harness behaviour).

**Resolved:** on localhost the grant is per site (Chrome site settings: localhost:8000 "allowed to edit"), not per file or folder. Confirmed with a file in a different folder.

## D. Prompts with 3 slots, new session
1. After a full restart, click Save on slot 1, then 2, then 3. Count prompts.

| Expected | Observed (prompts per slot / total) |
|---|---|
| Unknown – likely one per file | localhost: no prompts at all; permission on load reads granted for all slots. file:// : prompts again after each restart (see F), **once for each slot** (per file, not once per session). |

## E. The permission prompt
Record exact wording and the buttons offered. Does an "Allow on every visit" (or similar persistent) option appear?

| Origin | Browser + version | Exact prompt wording | Buttons / options | Persistent option present? |
|---|---|---|---|---|
| file:// | Chrome 155 | Title: "Allow this site to edit `<filename>`?" Body: "file:/// will be able to edit `<filename>`" (the filename changes with the file; see screenshot) | Allow, Don't Allow ("Don't Allow" is the default-focused button) | **No.** Prompt returns after every full restart (see F). |
| localhost | Chrome 155 | No permission prompt has ever appeared.| None. | Yes, as a stored site setting ("localhost:8000 allowed to edit" in Chrome site settings). |

NOTE: The File Save (Save As) dialog appears only after a Wipe, because there is no bound handle. It is not a permission prompt.

![Save As dialog, no handle bound](ScrnShot.png)

![file:// permission prompt](File%20Prompt%20Screenshot.png)

The page shows `permission: prompt` on load for restored slots (see also `File_Screenshot.png`, which shows all three slots at `prompt`).

## F. If a persistent option exists and is chosen
1. Choose it for slot 1 (and others). Do a full browser restart. Reopen. **This is the key test for a silent-overwrite design. localhost has a persistent grant (a stored site setting, see E); file:// does not.**

| Origin / Browser | Expected | Observed permission on load | Prompt on Save? |
|---|---|---|---|
| file:// Chrome | unknown | Prompt | Yes: Allow / Don't allow, every restart |
| localhost Chrome | unknown | granted | No asking (stored site permission) |

Longevity (multi-day expiry of the localhost grant): not tested. Out of scope for this project, because files are normally discarded at the end of the day or the start of the next.

## G. External changes
Bind slot, then (outside the browser) do each action, then click **Check** first (to see `getFile()` result), then **Save**. Re-bind between tests. Note which files in `Testing` each action produced.

**First run (inside OneDrive; Check/Save order unconfirmed):**

| Action | Expected error name | Observed error name + message (Save) | Observed (Check/getFile) |
|---|---|---|---|
| Rename file | NotFoundError? | No error. Save a new copy under the original name. | name=TestSlot1_20261009142605.txt size=19 lastModified=2026-10-09T14:26:43.413Z |
| Move file to another folder | NotFoundError? | No error. Save a new copy under the original name. | getFile OK: name=TestSlot2_20261009142614.txt size=19 lastModified=2026-10-09T14:28:25.795Z |
| Delete file | NotFoundError? | No error. Save a new copy under the original name. | getFile OK: name=TestSlot2_20261009142614.txt size=19 lastModified=2026-10-09T14:29:10.901Z |
| (extra) Open file in another app with exclusive lock | NoModificationAllowedError? | `InvalidStateError`: "An operation that depends on state cached in an interface object was made but the state had changed since it was read from disk." (write failed, slot 3, 13:42:48) | not recorded |

**Rerun (localhost, files OUTSIDE OneDrive, fresh file per test; order: bind, change externally, Check, record, then Save):**

| Action | Check (`getFile()`) result BEFORE Save: error name, or name/size/lastModified | Save result: error name + message, or "no error" | Files present afterwards |
|---|---|---|---|
| Rename file | **`NotFoundError`**: "A requested file or directory could not be found at the time an operation was processed." | No error. File re-created at the original path (getFile OK afterwards: TestSlot1_20261009154105.txt, size=19, lastModified=2026-10-09T15:41:38.990Z) | Re-created file at original path |
| Move file to another folder | **`NotFoundError`** (same message) | No error. Re-created at original path (TestSlot2_20261009154111.txt, size=19, lastModified=2026-10-09T15:42:40.331Z) | Re-created file at original path |
| Delete file | **`NotFoundError`** (same message) | No error. Re-created at original path (TestSlot3_20261009154115.txt, size=19, lastModified=2026-10-09T15:43:40.664Z) | Re-created file at original path |
| Exclusive lock (other app) | getFile OK: TestSlot2_20261009154111.txt, size=19, lastModified=2026-10-09T15:42:40.331Z (Check cannot see the lock) | **`InvalidStateError`**: "An operation that depends on state cached in an interface object was made but the state had changed since it was read from disk." (15:46:34, write FAILED; harness did not fall back) | not recorded |
| Edit file externally (new) | getFile OK: TestSlot1_20261009154105.txt, size=19, lastModified=2026-10-09T15:53:49.423Z (changed from the last save, 15:41:38.990Z, so detectable by comparison) | **No error. Save silently overwrote the external edit** (getFile OK afterwards: size=19, lastModified=2026-10-09T15:54:19.028Z) | Same file, external edit lost |

Takeaway so far: the handle is path-based; Save silently re-creates a renamed, moved or deleted file at the original path. The write path does refuse (`InvalidStateError`) when the file changed on disk after it was read.

**Resolved by the rerun:** `getFile()` before Save **does** detect rename, move and delete: it throws `NotFoundError`. The first run's "getFile OK" results were Checks taken after Save had already re-created the file. So the design can call `getFile()` before every write and refuse (or ask the user) on `NotFoundError`, instead of letting Save silently re-create the file.

**Lock:** `getFile()` still succeeds while the file is locked, so Check cannot detect it. The write itself fails with `InvalidStateError`, which is a loud failure (nothing overwritten). Handle it as "file locked or changed on disk".

**External edit:** Save does **not** protect against this. It silently overwrote the external edit, with no error. The only defence is to store `lastModified` (and `size`) at each save/load, call `getFile()` before every write, and compare. A mismatch (here 15:53:49 vs 15:41:38) means the file changed externally: warn instead of overwriting. Note the edit kept `size=19`, so compare `lastModified` and do not rely on size alone.

Rerun confirmed on localhost, outside OneDrive. file:// was not repeated (not needed: the API behaves the same on both origins as far as tested).

## H. `id` option / last folder
1. Save As slot 1: navigate to a distinctive folder (e.g. Desktop\Foo), save. Click Save As on slot 2. Which folder does the dialog open in?
2. Fully restart and repeat once.

| Origin | Expected | Observed (same session) | Observed (after restart) |
|---|---|---|---|
| file:// | last folder | last folder| last folder|
| localhost | last folder | last folder | documents |

**Inconsistency:** localhost fell back to Documents after restart while file:// kept the last folder. Repeat to confirm and record the folder used. ______CONFIRMED AS STATED.

## I. IndexedDB persistence across restart on file://
1. Bind slots, fully quit, reopen. Does the log show "restored handle from IndexedDB" for each slot?

| Origin / Browser | Expected | Observed |
|---|---|---|
| file:// Chrome | unknown | Yes |
| localhost Chrome | persists | Yes

Also note: does moving/renaming `handle-test.html` itself change this (it may change the origin handling)? Observed: file:// still works after moving (see Additional Testing); localhost 404s (expected: the server serves from its own folder).

## J. Cancel the dialog
1. Click Save As, then Cancel.

| Expected | Observed error name |
|---|---|
| AbortError | AbortError|

## K. Browser summary

| Test | Chrome file:// | Chrome localhost |
|---|---|---|
| A silent re-save | Pass | Pass |
| B permission after tab close | granted, no prompt | granted, no prompt |
| C permission after quit | prompt | granted, no prompt |
| D prompts for 3 slots | one per slot after each restart | 0 |
| E persistent option | No (Allow / Don't allow only) | Yes (stored site setting "allowed to edit") |
| F persists restart | No, prompt returns | Yes, silent |
| G error names | Not repeated on file:// | `getFile()` before Save: `NotFoundError` for rename/move/delete. Save alone re-creates silently. Lock: `InvalidStateError` on write. External edit: no error, silently overwritten (detect via `lastModified`) |
| H id reopens folder | Yes | Same session only (Documents after restart) |
| I IndexedDB persists | Yes | Yes |
| J cancel = AbortError | Yes | Yes |

Anything unexpected (e.g. feature missing, IndexedDB throwing, picker blocked on file://): Nothing unexpected noted. Not tested: multi-day expiry of the localhost permission (not relevant to the intended use).Nothing noted at this stage.
