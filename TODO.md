# TODO

**Editing and content**
- Paste images from the clipboard into an `assets/` folder next to the note

**Workspace and files**
- Multiple root folders (e.g. Work / Personal) with switching
- Export a note or folder to PDF/HTML

**Documentation and publishing**
- README: more screenshots (the notes tree, the Tags & Categories panel) and, if it grows again, the detail of the features in a second file (for example `docs/FEATURES.md`).

**Sync** (connect, push, pull, conflicts, the history option and the encryption are done)
- Sync other branches than the default one, and show the history of the repository.
- More sync services: each one is a class that implements `SyncProvider` (see `CLAUDE.md`). Candidates: GitLab and other git hosts (same shape as GitHub), a cloud drive (needs a content hash that the service reports, and a version such as a cursor), a folder on a shared or network drive.

**Platform**
- Sync tree state between computers (optional setting)
- Localization (l10n): all strings are already centralized in `strings.ts`
