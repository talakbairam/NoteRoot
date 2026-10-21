# Changelog

All notable changes to NoteRoot are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [0.2.0] - 2026-10-21

### Added

- **Settings page** (**NoteRoot: Open Settings Page**, or the pencil button in the title bar of the Settings view): every setting in a tab of the editor, grouped, with a search box and an **Only changed** filter. Each setting shows its default and where its value comes from (this notes folder or your settings), has a **Reset** link and its own editor: a dropdown, a checkbox, a text box, or one line per entry for a list. A change is checked and saved at once, with the same rules as the Settings view.
- **Tags & Categories page** (**NoteRoot: Open Tags & Categories Page**, or the pencil button in the title bar of the Tags & Categories view): the categories with their files and keywords, the categories of every file, the tags with the notes that use them, the tag patterns and what they found, and the two switches of the automatic features. New, Rename, Keyword, Change File, Remove File and Delete ask the same questions as the view, and a note or a file opens from its link.

- **Copy as Encrypted Text** (right-click a note) puts the encrypted text of a note on the clipboard without changing the file, and **Decrypt Text from Clipboard** (Command Palette, or the `...` menu of the Notes view) asks for the key and shows the decrypted text in a read-only tab. Both use the same encryption as **Encrypt…**.

### Changed

- Development tools updated (eslint, typescript-eslint, prettier, vsce and the Node types). Nothing changes for the user.
- The pages of the Quick Note and of the two new tabs moved from `media/` to a folder of their own, `webview/`. Nothing changes for the user.

## [0.1.0] - 2026-10-12

First release.

### Notes and files

- **Notes tree** in the Activity Bar: an Explorer-like view of one notes folder you choose, with natural sorting, file icons, lazy loading, refresh on outside changes, and expanded folders restored on restart. **Expand All**, **Collapse All** and **Sort Notes By…** (name or date modified).
- **Create, rename, duplicate and delete** (to the Trash, with a confirmation), copy path, reveal in the OS, open to the side. Case-only renames work, and nothing is ever overwritten silently.
- **Drag and drop** with several items, conflict questions (Replace, Skip, Cancel) and protection against moving a folder into itself. Dragging files in from the operating system **imports** (copies) them.
- **Undo** for renames and moves (Ctrl+Z in the tree, last 20 steps, never overwrites).
- **Search Notes** by file name, folder name or text (text files up to 1 MB, first 200 results).
- **Pinned & Recent** panel: pin the notes you need most; the last notes you opened are listed too. Both follow renames and moves.
- **Note header**: a list of lines (a comment with *Summary* and *Comment* at first) written at the start of every new note, and **Add ▸ Header** for existing notes.
- **Hide from NoteRoot** and **Show Hidden Items**: keep files and folders out of the tree, search and tags, and bring them back with **Show in NoteRoot Again**.

### Quick Note

- **Quick Note** box: type a thought and press **Save**; it is added to one file with a date heading, the file is not opened, and your draft is kept. Choose the file, the position (start or end) and the heading style in **Quick Note Options…**.
- **Save and Open**, **Paste and Save** (the clipboard), and **Add Selection to Quick Note** from the editor menu.
- **Move to ▸** cuts the selected text and adds it to the Quick Note file or to any other note, with a preview of the destination. **Add ▸ Date and Tags** writes a heading and a tag line at the cursor.

### Categories and tags

- **Advanced mode** adds **Category** and **Tag** boxes with autocomplete. A category sends the note to its own file, and any number of tags are written as one line (`**Tags:** #work #urgent`) under the heading.
- **Keywords** and **tag patterns** (`ab-*`, `ab-#`) tag and file notes by themselves; **Auto create category for every file** offers every note as a category.
- **Run Tagging** (on notes and folders) and **Tag when saving** write the tags into notes you already have; **Don't Auto-Tag** skips files and folders.
- **Tags & Categories** panel and **Manage Categories and Tags**: create, rename, delete, change the file of a category, set keywords, with multi-select.

### Sync (GitHub)

- **Actions** panel: connect a notes folder to a GitHub repository (the VS Code sign-in, no git, no other app), then **Push**, **Pull** and **Refresh**, with a diff for each changed file. Conflicts ask whether to keep yours, the online version, or both; replaced and deleted files go to the Trash first. Nothing contacts GitHub until you press a button.
- Optional: check for new commits automatically, keep only the last commits (or one), and include hidden files.
- **Encrypted sync**: an empty repository can be encrypted before the first push (AES-256-GCM, with the file names kept or hidden), a plain repository can be encrypted later, and **Change the Master Key** and **Forget the Saved Master Key** are in the `...` menu. The master key is never stored.
- Files over 25 MB, links and unsafe names are left out, and paths from the repository are checked before they become files.

### Encryption of a note

- **Encrypt…** a note with a master key (AES-256-GCM, scrypt): it becomes `name.ext.enc` with a lock. **Decrypt for Viewing…** opens it read-only in memory; **Decrypt Permanently…** restores it. The key is never stored and cannot be recovered. `tools/decrypt.js` and `tools/decrypt.ps1` decrypt a note without the extension, and `tools/decrypt-repo.js` and `tools/decrypt-repo.ps1` open a cloned encrypted repository.

### Settings

- **Settings** panel with every setting and the three switches, grouped, each with its value. Settings that belong to your notes are saved in the notes folder (`.noteroot/config.json`), so they travel with it and with Sync.

### Safety

- Everything stays inside the notes folder, links to folders are never followed, and notes are never logged. No telemetry and no runtime dependencies; the only network use is the optional Sync.
- A **Get Started** walkthrough opens on first start, and an Output channel **NoteRoot** shows logs without note contents.
