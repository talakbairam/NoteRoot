# Code style

Conventions for NoteRoot code. They describe how the code is written today. When this file and the surrounding code disagree, match the surrounding code and fix this file. The project rules in `CLAUDE.md` (Hard rules) come first.

## General

- Clarity over cleverness. Small, focused functions. DRY, KISS, YAGNI.
- Check that the logic does not exist already before writing it (`src/util`, the services).
- Keep changes minimal: only what the request needs. Do not revert unrelated changes.
- Inspect, do not invent: read the code and the types before assuming an API.
- Comments are in English and explain why, not what. Remove commented-out code.
- Pure helpers (parsing, planning, formatting) stay free of `vscode` where possible, so they can be checked on their own (`NoteHeader.ts`, `TagPatterns.ts`, `NoteTagging.ts`).

## Formatting

Prettier decides (`.prettierrc`): 2 spaces, double quotes, semicolons, line width 100, trailing commas where ES5 allows them, CRLF line endings (`.editorconfig`). Prettier is a dev dependency: run `npm run format` after editing and before finishing (`npm run format:check` only checks). `webview/` (the pages of the webviews: .js and .css) is not formatted by it. Always use braces for `if`, `for` and `while` (`curly` is a lint rule). Use `===` (`eqeqeq`).

## Naming

| What | Convention | Example |
|---|---|---|
| Variables, functions, methods | `camelCase` | `fetchUserData` |
| Constants | `UPPER_SNAKE_CASE` | `MAX_UNDO_STEPS` |
| Classes, interfaces, types, enums | `PascalCase` | `NoteTaggingService` |
| Files in `services`, `tree`, `webview` (also pure ones) | `PascalCase.ts` | `SearchService.ts`, `NoteHeader.ts` |
| Files in `commands`, `util`, `constants` | `camelCase.ts` | `fileCommands.ts`, `lineEnding.ts` |
| Booleans | `is` / `has` / `can` prefix | `isHidden`, `hasHeader` |

Command ids, setting keys, context keys and view ids live in `src/constants` and are never typed as literals in other files. The `contextValue` texts of tree rows are constants at the top of the tree file that makes the rows (`ContextValues` in `NoteItem.ts`). All user-facing text is in `src/constants/strings.ts`.

## TypeScript

- Strict mode is on, with `noImplicitReturns`, `noUnusedLocals` and `noUnusedParameters`.
- Annotate the return type of every function and method that is exported or part of a class.
- No `any`. If a type is unknown, take `unknown` and narrow it before use (values from the webview, the config file and settings are always checked first). Where `any` cannot be avoided, comment why.
- Prefer `interface` for object shapes and `type` for unions. Use `readonly` for what must not change.
- Prefer `undefined` over `null`; use `?.` and `??`. `null` stays where the outside world has it (JSON, `typeof x === "object"` checks, the webview message contract) or where it means "chosen: nothing" next to `undefined` for "cancelled" (`pickNoteFile`).
- Prefer string unions over `enum`.
- Default parameter values are fine for a harmless default (`scale = 1`). Do not use a boolean parameter to switch between two behaviours: write two functions (`askKey` / `askNewKey`) or pass an options object. A boolean that is only data (`setEnabled(value)`, `caseSensitive` from a setting) is fine.

## Structure

- Services (`src/services`) never show UI. They throw typed errors (`src/util/errors.ts`) or take callbacks. Commands and views decide what the user sees.
- All file access goes through `vscode.workspace.fs` and `Uri`, never Node `fs`. Every path-changing operation goes through `PathGuard`.
- Everything that can be disposed is registered in `context.subscriptions`.
- New services take their dependencies in the constructor; a new optional dependency goes last.
- `src/extension.ts` only wires things together.
- Imports are at the top of the file, ES modules only, named exports. `vscode` first, then the other imports.

## Errors and logging

- Never swallow an error silently. Either handle it with a clear message and a log entry, or let it reach the command boundary (`registerSafeCommand` logs the details and shows one friendly message).
- A `catch` that deliberately ignores an error says why in a comment (`catch { return; // Not there: free. }`).
- Use a typed error from `src/util/errors.ts` for a failure the user can fix (`ConfigLockedError`, `EncryptionRefusedError`).
- Log with `Logger`: relative paths and metadata only, **never note contents or keys**.
- No fallbacks that hide a problem. Fix the cause, unless the fallback is a documented decision (for example a damaged config: keep working with defaults and warn once).

## Comments and documentation

- Write JSDoc on exported functions, classes and types. Say what is returned and what is thrown.
- Keep knowledge in one place: the code and its JSDoc first, then `CLAUDE.md` for decisions that the code cannot show. Do not copy the same text into several files.
- When behaviour changes, update `README.md`, `CHANGELOG.md` and `CLAUDE.md` in the same change.

## Adding something

- **A command:** its id in `src/constants/commands.ts`, its title in `package.json` (`contributes.commands`), its menu entries, an entry in `commandPalette` with `"when": "false"` if it only works from a menu, and `registerSafeCommand` for the handler.
- **A setting:** `package.json`, `src/constants/settings.ts`, a typed getter in `SettingsService` and a row in `SettingsCatalog.ts` (a folder setting also goes in `FOLDER_SETTING_KEYS`; a folder-only one is not declared in `package.json`).
- **A user-facing text:** `src/constants/strings.ts`, never inline.
- **A `when` clause:** there is no `!~`; say "does not contain" with a negative lookahead (`/^noteRoot\.file(?!.*\.hidden)/`); inside `package.json` every backslash is doubled (`\\.`).
- **A sync service:** a class that implements `SyncProvider` (`src/services`), its texts under `Strings.sync.<service>`, and one line in the `syncProviders` array of `extension.ts`. Nothing in `SyncService`, `SyncPlan`, the Actions view or `syncCommands.ts` should need to change.
- **A note format that other code reads** (tag line, header, encrypted file): keep the writer, the reader, `tools/decrypt.js` and `tools/decrypt.ps1` in step; for the encrypted sync (`SyncCrypto.ts`) the readers outside the extension are `tools/decrypt-repo.js` and `tools/decrypt-repo.ps1`.

## Checks

- `npm run lint` and `npm run compile` must finish with zero errors and zero warnings.
- There are no automated tests in the repository by design. Check pure logic with a throwaway script outside the repository, and walk through `MANUAL-TESTING.md` for anything you can see in VS Code. Say so when something was not run (for example F5 cannot be started from the terminal).

## Dependencies

- No runtime dependencies. Dev dependencies go in `package.json` with the lockfile updated.
- Node's `node:crypto` is allowed for encryption; it ships with VS Code.

## Working in the Windows shell

- Heredocs and `sed` in the Bash tool mangle backslashes. Write JSON, regexes and Windows paths with the Write or Edit tool.
- Scratch scripts and test files go outside the repository (the scratchpad), never in it.
- Do not commit unless asked.
