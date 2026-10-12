# Contributing to NoteRoot

Thank you for helping. NoteRoot is a small VS Code extension, and the goal is to keep it simple, safe and dependency-free.

## Reporting problems

Open an [issue](https://github.com/talakbairam/NoteRoot/issues) and include:

- your VS Code version and operating system, and whether you use a Remote window (SSH, WSL, Dev Container),
- what you did, what you expected and what happened,
- the output of **NoteRoot: Show Logs**. The logs never contain note contents, but check them for private paths before you share them.

## Set up

You need Node.js (22 or newer) and VS Code 1.140 or newer.

```bash
git clone https://github.com/talakbairam/NoteRoot.git
cd NoteRoot
npm install
```

Press **F5** to start an Extension Development Host with the extension loaded. The recommended extension *esbuild Problem Matchers* (`connor4312.esbuild-problem-matchers`) is needed by the build task.

If F5 closes the new window right away, run the extension without the debugger to see whether the problem is in your VS Code profile:

```bash
code --extensionDevelopmentPath=<path-to-this-repo> --new-window
```

## Scripts

| Script | What it does |
|---|---|
| `npm run compile` | Type check, lint, then bundle `src/extension.ts` to `dist/extension.js`. |
| `npm run watch` | Rebuild on every change (used by F5). |
| `npm run lint` | ESLint on `src/`. |
| `npm run check-types` | `tsc --noEmit`. |
| `npm run package` | Build a `.vsix` with `vsce`. |

Before you open a pull request, `npm run lint` and `npm run compile` must both finish with no errors and no warnings.

## How the code is organized

A fuller digest of the design and its decisions is in [CLAUDE.md](CLAUDE.md). In short:

```
src/
  extension.ts        wiring only: creates services, providers, commands
  constants/          command IDs, settings, context keys, ALL user-facing text
  services/           file logic, no UI (settings, root folder, config, file operations,
                      path guard, name validation, excludes, Quick Note, state, logger)
  tree/               tree provider, drag and drop, tree items, state restore
  webview/            Quick Note view provider and message contract
  commands/           command registration and the dialogs they show
  util/               typed errors and small helpers
media/                webview CSS and JS, icons, walkthrough pages
```

## Rules for code changes

These are the project's rules and are checked in review.

1. **Strict TypeScript.** No `any` unless unavoidable, and then explain why in a comment.
2. **Files go through `vscode.workspace.fs` and `vscode.Uri`.** Never use Node `fs`. This keeps Remote windows working.
3. **Layers.** Services never show UI. They throw typed errors (see `src/util/errors.ts`), and commands decide what the user sees. Services that need an answer from the user take a callback instead.
4. **All user-facing text lives in `src/constants/strings.ts`.** Command IDs, setting keys and context keys live in their own constants files. No text literals scattered in code.
5. **No runtime dependencies.** Dev dependencies only.
6. **Never delete or overwrite silently.** Confirm destructive actions. Deleting uses the Trash first, and permanent deletion needs its own explicit question.
7. **Every operation that changes a path checks it with `PathGuard`.** Nothing may leave the notes folder.
8. **Dispose everything** by pushing disposables into `context.subscriptions`.
9. **Catch errors at command boundaries.** Log the details to the output channel and show a short, friendly message. Use `registerSafeCommand` for new commands.
10. **Webview content is untrusted.** Validate every message. Keep the strict Content-Security-Policy and use theme colour variables only.
11. **Privacy.** No telemetry, no network use except the optional Sync (only when the user presses one of its buttons), no external resources, and never write note contents to the logs.

Use async/await, keep functions small, and write short comments that explain *why*, not *what*.

## Testing

There are no automated tests in the MVP, by design. Keep logic in the services so tests can be added later. Before a pull request, run the part of the [manual checklist](MANUAL-TESTING.md) that your change touches, in an Extension Development Host. Mention what you tested in the pull request.

## Pull requests

1. Fork the repository and create a branch from `develop`.
2. Keep the change focused. Unrelated fixes belong in separate pull requests.
3. Update `README.md` when behaviour or settings change, and add a line to `CHANGELOG.md` under the next version.
4. Make sure `npm run format`, `npm run lint` and `npm run compile` pass. CI runs them on every pull request.
5. Open the pull request **against `develop`** and fill in the template (what, why, testing with a screenshot, impact, notes).
6. **One commit, one-line message.** Squash your commits before you push (`git rebase -i`, or `git reset --soft develop` and commit once). The check *PR rules* fails otherwise.
7. The owner reviews it. A pull request is merged into `develop` only after the owner approves it and the checks pass.

`develop` is merged into `master` only by the owner. That merge builds the `.vsix` and adds the version tag; nothing is published to the Marketplace by it. Force pushes are blocked on both branches. The rules are in `.github/rulesets/`.

## License

NoteRoot is released under the [GNU General Public License, version 3](LICENSE). By contributing, you agree that your contribution is licensed under the same terms.
