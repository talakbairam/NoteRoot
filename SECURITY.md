# Security

NoteRoot works on plain files in a folder you choose. It sends no telemetry and has no runtime dependencies. The only network use is the optional **Sync** (GitHub today): it does nothing until you connect a repository, and then it contacts GitHub only when you press one of its buttons, or when you turn on the optional check for new commits.

## Reporting a problem

Please do **not** open a public issue for a security problem. Use [private vulnerability reporting](https://github.com/talakbairam/NoteRoot/security/advisories/new) on GitHub instead. Include the NoteRoot and VS Code versions, what you did, and what you saw. Do not send real notes or real master keys.

## What is in scope

- Reading or writing outside the notes folder.
- Losing, overwriting or deleting a note without asking.
- Note text, master keys or personal paths ending up in a log.
- A weakness in how notes are encrypted, in a note or in the encrypted sync (see below).
- A GitHub token or a key ending up in a file, a log or a request to anything but GitHub. NoteRoot never stores the GitHub token (VS Code keeps it) and never stores a master key.

## Encryption

Encrypted notes use AES-256-GCM with a key derived from your master key by scrypt (a random salt and IV for each note). The master key is never stored and cannot be recovered. The file name and size stay visible, and older copies (Local History, Git history, backups, sync services) may still hold the plain text. The encrypted sync uses the same cipher and key derivation, with the path of each note as authenticated data; online there are only sealed files, the number and size of the files, and the dates of the commits. Only the key derived from the master key is kept on your computer, in the secure storage of VS Code, and **Forget the Saved Master Key** removes it. Changing the master key or encrypting an existing repository leaves older commits unchanged unless you drop the history. The encryption has not been reviewed by an independent party.

## Supported versions

Only the latest release gets fixes.
