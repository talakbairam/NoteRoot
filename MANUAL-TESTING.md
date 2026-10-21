# Manual testing checklist

NoteRoot has no automated tests, so check these by hand before a release. Press **F5** (Extension Development Host). Try Windows first, then macOS or Linux, and one Remote window if possible. Use a **copy** of real notes, never your only copy.

## Folder and tree

- [ ] No folder set: sidebar says "No notes folder selected" with **Select Notes Folder**; Quick Note shows the same message and button instead of the box (the draft comes back after a folder is chosen).
- [ ] Selecting a folder creates `.noteroot/config.json` and shows the tree; `.noteroot` is not visible. An empty folder offers **New File** / **New Folder**.
- [ ] Rename or delete the root folder on disk: the view shows "not found" with **Select Another Folder** and **Create Folder Again** (asks first).
- [ ] Folders first, natural sort (`note2` before `note10`), file icons follow the theme, tooltip shows path and size, folder links are shown but not expanded.
- [ ] Sort by name / modified (Settings panel); expanded folders and selection survive a restart; **Expand All** and **Collapse All** work.
- [ ] Single click opens a preview tab, double click a permanent tab; a large file asks first; a file VS Code cannot show opens in the system app.
- [ ] Changes made outside VS Code appear in the tree; **Refresh** works.

## File operations

- [ ] New File / New Folder: invalid names (empty, `a/b`, `CON`, trailing dot or space) are refused with a clear message; an existing name (any case) is refused.
- [ ] Rename (F2), including a case-only change; the open editor follows. Renaming the Quick Note file warns first.
- [ ] Delete asks, then uses the Trash; several selected items at once. Without a Trash it asks again before deleting for good.
- [ ] Duplicate a file and a folder (`name copy.ext`, then `name copy 2.ext`); nothing is overwritten.
- [ ] Drag and drop: several items, onto a folder, a file and empty space; a folder cannot go into itself; a conflict asks Replace / Skip / Cancel.
- [ ] Drag files from the file manager into the tree: they are copied, originals stay; conflicts ask.
- [ ] **Undo** (Ctrl+Z in the tree) takes back the last rename or move; one drag is one step; it never overwrites.
- [ ] Copy Path, Copy Relative Path, Reveal in OS, Open to the Side.

## Quick Note

- [ ] Type text, **Save**: it is added to `quick-notes.md` with a date heading; the box clears; the file is not opened. A failed save keeps the text.
- [ ] The draft survives closing the sidebar and restarting. The box grows, and its height can be dragged and is remembered.
- [ ] **Save and Open** (icon button) saves and opens the file. **Paste and Save** saves the clipboard text without touching the box.
- [ ] **Add Selection to Quick Note** from the editor menu (NoteRoot ▸).
- [ ] Change the file with the title bar button (existing note, new note, default). New notes at the start or the end, heading level: **Quick Note Options…**.
- [ ] The file open in an editor with unsaved changes: the note goes into the buffer and is not saved by itself. A clean open file is saved again.
- [ ] Two quick saves in a row both end up in the file.

## Advanced mode, categories and tags

- [ ] The sliders button switches the Advanced mode; **Category** and **Tag** boxes appear. Lists open fully on click, narrow while typing, and stay inside the panel (also when the panel is small).
- [ ] **Create category…** / **Create tag…** with the typed name filled in. A category asks for a file; the Quick Note then goes to that file.
- [ ] Several tags become chips (× removes one); the tag line is written as `**Tags:** #a #b`; with no tags the line is written empty.
- [ ] **Tags & Categories** panel: rename, delete (also several selected with Ctrl+click), change or remove a file, set or remove a keyword. A tag opens to its notes.
- [ ] Keyword on a tag: a note that contains it gets the tag at Save. Keyword on a category: the note goes to that category's file.
- [ ] **Tag Patterns**: add one with the ready-made kinds (`ab-#`), a note with `ab-12` gets `#ab-12` at Save; "No matches yet" for a pattern with none.
- [ ] **Category for every file** turns note files into categories; turning it off leaves nothing behind.
- [ ] A damaged or newer `config.json` is never changed: edits are refused with one message.

## Tagging

- [ ] **Run Tagging** on one note, several notes and a folder (it asks first). A second run changes nothing. A Quick Note file is tagged entry by entry.
- [ ] **Tag when saving** (Settings panel): tags are written at Ctrl+S, Ctrl+Z takes them away; not at auto save.
- [ ] **Don't Auto-Tag** on a file and a folder; **Auto-Tag Again** reverses it. Run Tagging then says the file is excluded.

## Move to, Add and header

- [ ] Select text, right-click ▸ NoteRoot ▸ **Move to ▸**: **Quick Note**, and **Choose Note…** (New note…, Recent, All notes, preview beside while moving the highlight). The text is removed only after it was written; Ctrl+Z brings it back.
- [ ] **Add ▸ Date and Tags** writes the heading and an empty tag line at the cursor. **Add ▸ Header** adds the note header once.
- [ ] **Note header** (Settings panel): a new file starts with it; a Quick Note into a new or empty file goes below it; **Insert Header** on an existing note adds it once.

## Hide and show

- [ ] **Hide from NoteRoot** adds `/path` to the hidden list and hides the item from the tree, search, tags and categories; **Undo** works.
- [ ] **Show Hidden Items** shows hidden items marked **hidden** (never `.noteroot`); the menu entry becomes **Hide Hidden Items**. Only one of Hide / Show in NoteRoot Again is offered per item.

## Search, Pinned and Recent

- [ ] Search finds file names, folder names and text (2+ characters), shows the matching line, opens the note at that line and reveals it in the tree.
- [ ] **Pin Note** / **Unpin Note**; pins follow a rename or move and survive a missing drive. **Recent** lists the last opened notes; remove one, clear all.
- [ ] The same note pinned and recent shows in both groups without errors.

## Settings panel

- [ ] Every row opens the right editor (choice, text, number, list, switch, action) and rejects bad input with a message.
- [ ] **Reset to Default** appears only on changed rows; the folder value is removed first, a second reset removes the user value. Rows show **· this folder** when the notes folder has its own value.
- [ ] A change made in the VS Code Settings editor shows up in the panel at once.
- [ ] The pencil button of the Settings view opens **NoteRoot Settings** in an editor tab (a second click shows the same tab). Every kind of row can be changed there (select, checkbox, text box on Enter or leaving it, list with **Apply** or Ctrl+Enter, **Change…** for the folder and the Quick Note file); a bad value shows a message under the row and is not saved; **Reset** and the search box and **Only changed** work; a change made in the Settings view shows up in the page and the other way round.

## Tags & Categories page

- [ ] The pencil button of the Tags & Categories view opens **NoteRoot Tags & Categories** in an editor tab (a second click shows the same tab). Categories, tags, patterns and the **Every file** list match the view; the counts appear a moment after the lists.
- [ ] New, Rename, Keyword, Change file, Remove file / keyword and Delete ask the same questions as the view and the page updates at once; the two switches turn the automatic features on and off; a note, a category file and a tag of a pattern open from their links.
- [ ] A change made in the view, in the Quick Note panel or in the config file shows up in the page; with no notes folder the page offers **Select Notes Folder**.

## Encryption

- [ ] Right-click a note ▸ **Encrypt…**: the key is asked twice (short key and mismatch are refused); the note becomes `name.ext.enc`, shows a lock, and its text on disk is unreadable.
- [ ] Click the locked note (also from Search, Recent and Pinned): the key is asked; the right key opens a read-only editor, a wrong key gives an error. Closing the tab forgets the text.
- [ ] **Decrypt Permanently…** restores name and text; a taken name is refused and nothing is lost.
- [ ] Refused with a clear message: unsaved changes, the Quick Note file, a binary file, a link.
- [ ] Search, Run Tagging, Insert Header, Tag when saving, Move to and Quick Note leave encrypted notes alone.
- [ ] A pinned or recent note keeps its entry after encrypting. Several selected notes share one key.
- [ ] `node tools/decrypt.js note.md.enc` decrypts the same note outside VS Code.
- [ ] `powershell -ExecutionPolicy Bypass -File tools/decrypt.ps1 note.md.enc out.md` does the same without Node.

## Sync (Actions panel, GitHub)

Use a throwaway notes folder and a throwaway **private** repository. The logic was checked against a fake GitHub; these steps check the real thing.

- [ ] Before connecting, the **Actions** panel (collapsed, under Pinned & Recent) shows the welcome text and no request is sent to GitHub. Without a notes folder it asks for one.
- [ ] **Connect to a Sync Service**: the browser sign-in of VS Code opens once; the list shows your repositories with a lock for private ones; **Create a new private repository…**, **Type the name…** and picking one all work; a public repository asks before it is used.
- [ ] Connecting to an empty repository, then **Push** (edit the message): the commit appears on GitHub with your files and `.noteroot-sync`; the panel says everything is in sync.
- [ ] On a second notes folder (or computer) connect to the same repository: the files are **pulled right away** (a file that exists on both sides with different contents asks what to keep) and the panel is in sync.
- [ ] Edit, add and delete files on one side, push, then refresh and pull on the other: each change arrives; the deleted file is in the Trash.
- [ ] Change the same file on both sides: the panel marks the **conflict**; Pull offers Keep Mine, Use the Online Version, Keep Both (and, for several files, Review One by One / Keep All…); Escape changes nothing; "Use GitHub's Version" leaves the old file in the Trash; Keep Both saves `name (online).ext`.
- [ ] A file with unsaved changes in an editor is treated as changed (conflict) on pull, and a push warns that unsaved changes are not sent.
- [ ] Right after choosing the repository the *history* question appears (GitHub): *Keep every commit* is the usual way; *Keep only the last commits…* asks how many (the box starts with 5; 0, 101, text and decimals are refused); *Keep only one commit* is the same as 1. Dropping commits asks to confirm, and cancelling anywhere connects nothing.
- [ ] `...` menu ▸ **Choose How Sync Keeps Commits** ▸ *last commits* with 3: after four or five pushes in a row GitHub shows **exactly 3 commits** (the newest three, with their original dates and authors), the panel shows `· last 3 commits`, the newest commit has every file, and a second computer pulls without trouble. Raising the number to 10 adds commits again without rewriting. *Keep every commit* goes back to the usual way. (Use a throwaway repository.)
- [ ] Reload the window while connected: the panel lists the files changed since the last sync at once, the line says **Remote not checked yet** and **Remote changes** says *not checked*; no request is sent until you press Refresh. With *Check for new changes automatically* on, the remote is compared about ten seconds after the start.
- [ ] After a Refresh, saving, creating or deleting a note makes **Local changes** update by itself within a few seconds (no Refresh needed, nothing sent to GitHub); before the first Refresh the list stays untouched.
- [ ] Right after choosing the repository a *hidden files* question appears: *Leave the hidden files out* is the default; *Sync the hidden files too* asks to confirm, and cancelling connects nothing. With it on, a file in `.vscode` (or one you hid with **Hide from NoteRoot**) shows in Local changes and is pushed; `.git`, `Thumbs.db` and `.DS_Store` never do. The panel shows `· hidden files included`. Switching it off again (`...` ▸ **Choose Whether Sync Includes Hidden Files**) proposes **no deletions**, and the files stay online.
- [ ] Click a file under **Local changes** that was changed: a diff opens with the online version on the left (read-only) and your file on the right. Click a new local file: it opens alone. Under **Remote changes** a changed file opens a diff (yours on the left, online on the right), a file that is only online opens alone as read-only text. In an encrypted repository the online side is readable. A binary or very big file shows a message instead.
- [ ] `...` menu: **Change Sync Target**, **Disconnect from Sync** (notes and repository untouched) and **Check Sync for New Changes Automatically** (turn on / off). With it on, a new commit made on GitHub shows one notice and the badge, within about five minutes.
- [ ] Signing out of GitHub in the Accounts menu makes the actions ask to sign in again instead of failing silently. The log never contains note text or the token.

## Encrypted sync (Actions panel, GitHub)

Use a throwaway notes folder and a new **empty** private repository.

- [ ] Connecting an empty repository asks: encrypt or not, how the names show (kept or hidden), and the master key twice (short key and mismatch are refused). Cancelling any of them connects nothing. A repository with plain notes asks nothing about encryption.
- [ ] After a Push the repository on GitHub holds `.noteroot-encrypted`, `.noteroot-index` and sealed files only: no note text anywhere, and with hidden names no note name or folder either. The panel shows the shield icon and `encrypted`.
- [ ] On a second computer (or after removing the saved key) connecting to that repository asks for the master key; a wrong one asks again, three wrong ones stop; the right one opens the notes, and the next refresh does not ask.
- [ ] Edit, add and delete notes on one side, Push, Pull on the other: they arrive. Conflicts, "Pull, then Push" and the last-commits option behave as with plain notes.
- [ ] In a plain repository the `...` menu has **Encrypt the Notes of This Repository**: it warns, asks names, history (keep or drop) and the master key twice; afterwards the repository holds only sealed files, the panel shows nothing to push or pull, and a second computer can connect with the key.
- [ ] In an encrypted repository the menu has **Change the Master Key** (old key asked if not kept) and **Forget the Saved Master Key**: after forgetting, the key is asked again at the next Pull or Refresh after reloading the window; after changing, another computer must connect again with the new key, and the old key is refused.
- [ ] `node tools/decrypt-repo.js <clone of the repository> <empty folder>` and `powershell -ExecutionPolicy Bypass -File tools/decrypt-repo.ps1 <clone> <empty folder>` write the notes after the master key is typed; a wrong key is refused.

## General

- [ ] The walkthrough opens on first run and can be reopened from the Welcome page.
- [ ] The **NoteRoot** output channel is useful and never contains note text.
- [ ] No network traffic from the extension unless Sync is connected and used.
- [ ] Reloading the window leaves no errors in the Developer Tools console.
- [ ] Works in a Remote window (notes folder on the remote machine) and in a light and a dark theme.
- [ ] `npm run lint` and `npm run compile` pass with zero errors and warnings; `vsce package` makes a `.vsix` that installs and works.
