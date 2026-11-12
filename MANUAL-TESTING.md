# Manual testing checklist

NoteRoot has no automated tests, so check these by hand before a release. Press **F5** (Extension Development Host). Try Windows first, then macOS or Linux, and one Remote window if possible. Use a **copy** of real notes, never your only copy.

## Folder and tree

- [ ] No folder set: sidebar says "No notes folder selected" with **Select Notes Folder**; Quick Note shows the same message and button instead of the box (the draft comes back after a folder is chosen).
- [ ] Selecting a folder creates `.noteroot/config.json` and shows the tree; `.noteroot` is not visible. An empty folder offers **New File** / **New Folder**.
- [ ] Rename or delete the root folder on disk: the view shows "not found" with **Select Another Folder** and **Create Folder Again** (asks first).
- [ ] Folders first, natural sort (`note2` before `note10`), file icons follow the theme, tooltip shows path and size, folder links are shown but not expanded.
- [ ] Sort by name / modified (Settings page); expanded folders and selection survive a restart; **Expand All** and **Collapse All** work.
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
- [ ] Change the file with **Change Quick Note File** in the `...` menu (existing note, new note, default). New notes at the start or the end, heading level: the Quick Note rows of the Settings view.
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
- [ ] **Tag when saving** (Settings page): tags are written at Ctrl+S, Ctrl+Z takes them away; not at auto save.
- [ ] **Don't Auto-Tag** on a file and a folder; **Auto-Tag Again** reverses it. Run Tagging then says the file is excluded.

## Move to, Add and header

- [ ] Select text, right-click ▸ NoteRoot ▸ **Move to ▸**: **Quick Note**, and **Choose Note…** (New note…, Recent, All notes, preview beside while moving the highlight). The text is removed only after it was written; Ctrl+Z brings it back.
- [ ] **Add ▸ Date and Tags** writes the heading and an empty tag line at the cursor. **Add ▸ Header** adds the note header once.
- [ ] **Note header** (Settings page): a new file starts with it; a Quick Note into a new or empty file goes below it; **Insert Header** on an existing note adds it once.

## Hide and show

- [ ] **Hide from NoteRoot** adds `/path` to the hidden list and hides the item from the tree, search, tags and categories; **Undo** works.
- [ ] **Show Hidden Items** shows hidden items marked **hidden** (never `.noteroot`); the menu entry becomes **Hide Hidden Items**. Only one of Hide / Show in NoteRoot Again is offered per item.

## Search, Pinned and Recent

- [ ] Search finds file names, folder names and text (2+ characters), shows the matching line, opens the note at that line and reveals it in the tree.
- [ ] **Pin Note** / **Unpin Note**; pins follow a rename or move and survive a missing drive. The **Pinned** and **Recent** groups are the first rows of the Notes tree, above the folders (both are always there, with their count, also 0); the eye button on a row turns the group off (`n · off`, its notes are hidden, nothing is deleted) and on again, and while Recent is off new notes are not remembered; Recent lists the last opened notes; remove one, clear all (the button on the Recent row). A click opens the note; dragging a folder onto a group row drops it into the notes folder; Expand All, Collapse All and Ctrl+Z still work.
- [ ] The same note pinned and recent shows in both groups without errors.
- [ ] **Favorites** is the first group of the Notes tree: a file and a folder can be added (right-click ▸ **Add to Favorites**) and removed. Renaming keeps them, and the eye button hides the group without losing them.

## Settings page

- [ ] **Open Settings Page** in the `...` menu of the Notes view (and the Command Palette) opens **NoteRoot Settings** in an editor tab (a second click shows the same tab). There is no Settings view in the sidebar any more.
- [ ] The page has a menu of sections on the left (Notes, Tree & Search, Quick Note, Tags & Categories, Sync & Encryption, Advanced, Files and logs); a click shows that section only, and the choice is remembered when the tab is hidden and shown again; a search or **Only changed** lists the sections that have a match and clearing it returns to the chosen section; in a narrow tab the menu is a row on top.
- [ ] Every kind of row can be changed there (select, checkbox, text box on Enter or leaving it, list with **Apply** or Ctrl+Enter, **Change…** for the folder and the Quick Note file); a bad value shows a message under the row and is not saved.
- [ ] **Reset** appears only on changed rows; the folder value is removed first, a second reset removes the user value. Rows show **this folder** when the notes folder has its own value. The search box and **Only changed** work.
- [ ] A change made in the VS Code Settings editor shows up in the page at once.
- [ ] The last section, **Files and logs**, opens the config file, the logs and the VS Code Settings editor. **Sort Notes By…** is in the Command Palette only; the page has the same choice as **Sort notes by**.
- [ ] **Sidebar** shows the Sync, Favorites, Pinned and Recent rows with a preview of the tree. Move, hide and **Add blank row** change the Notes tree at once; **Back to the default** undoes it.
- [ ] The choice is still there after a restart. Without a notes folder a change is refused with one message.
- [ ] Every setting has a tag icon: hovering it shows the tags, a click on one searches for it, and a search such as `pinned` finds the settings that match it.

## Tags & Categories page

- [ ] The pencil button of the Tags & Categories view opens **NoteRoot Tags & Categories** in an editor tab (a second click shows the same tab). A menu on the left lists Categories, Every file, Tags and Tag Patterns with their counts; a click shows that section only, the choice is remembered, and a search lists the sections that have a match. Categories, tags, patterns and the **Every file** list match the view; the counts appear a moment after the lists.
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

## Sync page and services

Use a throwaway notes folder and a throwaway **private** repository or folder. The logic was checked against fake services; these steps check the real ones.

- [ ] **Open Sync Page** (`...` menu of Notes, or the Command Palette) opens one tab; a second click shows the same tab. It starts with the list of services, each with its status. **Open** shows that service, and the menu has a way back.
- [ ] With nothing connected no request is sent. By default the Notes tree has a sync row only for connected services; the setting *Sync rows in the Notes tree* can show every service or none.
- [ ] The row of a connected service is grey (not connected), green (in sync) or yellow (something to push or pull). A click does nothing; right-click offers Push, Pull, Check now, Open Sync Page and Disconnect.
- [ ] Opening the page checks every connected service (read only); the status leaves *Remote not checked yet*.

## Connecting each service

- [ ] **GitHub:** the sign-in of VS Code opens once; pick a repository, create a private one or type a name. A public repository gets a warning.
- [ ] **GitLab:** the page says *No GitLab token yet*; Connect asks for a token (password box). A wrong token is refused and nothing is saved. The **GitLab address** setting refuses `http://`. An empty project works (the first push may be two commits).
- [ ] **Google Drive:** needs a Google client id and secret (Settings page ▸ Sync & Encryption). Without one the page shows what is missing and Connect is disabled. Connect opens the browser; **Deny** connects nothing. Files made by hand in the folder are not seen (that is the `drive.file` permission).
- [ ] **Dropbox:** needs the *Dropbox app key* setting. Connect opens the browser; the notes are in `Apps/<app>`.
- [ ] Revoking the access (GitHub, GitLab token, Google, Dropbox) makes the next check say to connect again; nothing fails silently. The log never has note text or a token.
- [ ] Two services can be connected at once; connecting one leaves the other alone. Disconnect on one keeps the other.

## Push, pull and conflicts

- [ ] Connect to an empty target and Push: the files appear online. Connecting to a target with files pulls them right away.
- [ ] Add, edit and delete on one side, push, then pull on the other: each change arrives; deleted files go to the Trash.
- [ ] **Message of a push** (on by default): Push does not ask for a message and uses *NoteRoot sync <date and time>*; off, it asks.
- [ ] A file changed on both sides is only in the **Conflicts** list (not counted as a push or a pull). A Pull with an unresolved conflict changes nothing and offers **Open the Conflicts**.
- [ ] In Conflicts each file has Mine, Online and Both; *All mine* / *All online* choose for all; **Apply choices** (a Pull) is enabled when every file has a choice. *Both* is not offered for a deleted file or the settings file.
- [ ] A Push with news online asks **Pull, then Push**. A file with unsaved changes in an editor counts as changed.
- [ ] **Diff** next to a file opens your file against the online one; a file on one side only opens alone.
- [ ] **Check all**, **Pull all** and **Push all** (two services connected) run each service in turn; one that fails does not stop the others. While a sync action runs, a second one says so.
- [ ] After a Refresh, editing or deleting a note updates Local changes by itself within seconds, with nothing sent.
- [ ] **Open online** opens the repository or folder in the browser.

## Sync options

- [ ] *Hidden files* are left out by default; including them asks to confirm.
- [ ] *History* (GitHub only): *every commit*, or *last N commits* (1 to 100): after several pushes GitHub shows exactly N commits.
- [ ] *Check for new changes* (For all services): with it on, a new online version gives one notice.
- [ ] **Don't Sync** / **Sync Again** (tree menu) and the setting *Files and folders not synced*: those files are not listed in Changes, and a file that was online already is not deleted there. **Show Not-Synced Items** marks them.

## Encrypted sync

Use a new **empty** private repository.

- [ ] Connecting to an empty target asks: encrypt or not, file names kept or hidden, and the master key twice. Cancelling any of them connects nothing.
- [ ] After a Push the target holds only `.noteroot-encrypted`, `.noteroot-index` and sealed files: no note text, and with hidden names no note names.
- [ ] On a second computer the master key is asked once; a wrong key asks again (three tries); the right one opens the notes.
- [ ] **Only the files and folders I choose:** **Encrypt in Sync** on a note, Push: that note is sealed and the others are plain. In a plain repository a marked file asks (or follows *A marked file in a plain repository*).
- [ ] **Encrypt the Notes of This Repository**, **Change the Master Key**, **Forget the Saved Master Key**, **Change How Encrypted Files Are Named** and **Turn off the encryption** each ask their questions and leave the notes readable afterwards.
- [ ] Settings ▸ Sync & Encryption shows the saved GitLab token, Google and Dropbox sign-ins and keys (each key with a **Forget**); **Reset** takes the secret away at once.
- [ ] `node tools/decrypt-repo.js <clone> <empty folder>` and `powershell -ExecutionPolicy Bypass -File tools/decrypt-repo.ps1 <clone> <empty folder>` write the notes after the master key is given.

## Settings page extras

- [ ] Setting a value back to its default removes it from `custom.folderSettings` and the *changed* mark goes away.
- [ ] The **Advanced** section holds the limits, fine tuning and the *on at the start* switches.

## General

- [ ] The walkthrough opens on first run and can be reopened from the Welcome page.
- [ ] The **NoteRoot** output channel is useful and never contains note text.
- [ ] No network traffic from the extension unless Sync is connected and used.
- [ ] Reloading the window leaves no errors in the Developer Tools console.
- [ ] Works in a Remote window (notes folder on the remote machine) and in a light and a dark theme.
- [ ] `npm run lint` and `npm run compile` pass with zero errors and warnings; `vsce package` makes a `.vsix` that installs and works.
