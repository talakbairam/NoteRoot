# Publishing NoteRoot

Notes for maintainers. This file is not shipped in the extension package.

## Build a package

```bash
npm ci
npm run package        # vsce package: lint, type check, production bundle, .vsix
```

Install the result with **Extensions: Install from VSIX...** and try it before publishing.

## VS Code Marketplace

```bash
npx vsce login <publisher-id>      # needs an Azure DevOps personal access token (scope: Marketplace > Manage)
npx vsce publish                   # or: npx vsce publish minor
```

## Open VSX (VSCodium, Cursor and similar editors)

Create an account and a token at [open-vsx.org](https://open-vsx.org), claim the namespace once, then:

```bash
npx ovsx create-namespace <publisher-id> -p <token>   # first time only
npx ovsx publish noteroot-<version>.vsix -p <token>
```

## Release checklist

- `npm run lint` and `npm run compile` pass.
- The `.vsix` contains only `dist/`, `media/`, `README.md`, `CHANGELOG.md`, `LICENSE` and `package.json` (`npx vsce ls`).
- Tag the release in git, for example `v0.1.0`.
