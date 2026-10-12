# CI/CD and repository rules

How changes get into NoteRoot, and what GitHub checks along the way. The rules are kept in files so they can be reviewed and imported again: the workflows are in `workflows/`, the branch rules in `rulesets/`.

## Branches

- **`develop`** takes every change. It accepts pull requests only.
- **`master`** holds releases. It accepts pull requests only, and only from `develop`, opened by the owner.
- Force pushes and deleting the branch are blocked on both.

## Pull requests

- A pull request goes **against `develop`**. Only the owner opens one against `master`, from `develop`.
- A pull request to `develop` has **exactly one commit with a one-line message**. Anything else (details, co-authors) goes in the description of the pull request, which follows `pull_request_template.md`: What, Why, Testing (screenshot), Impact, Notes, Checklist.
- Merging into `develop` needs **one approval from a code owner** (`CODEOWNERS`), the checks passing, and a squash merge. The title of the pull request becomes the commit message.
- Merging into `master` needs one approval from a code owner as well, with a merge commit.
- The owner can bypass the approval, only through a pull request. Nobody can push directly.

## Workflows

| File | Runs | What it does |
|---|---|---|
| `workflows/ci.yml` (job `build`) | Push to `master` or `develop`, and every pull request | `npm run format:check`, `lint`, `compile`, `npm audit --omit=dev`, and a trial `vsce package` |
| `workflows/pr-rules.yml` (job `pr-rules`) | Every pull request | Against `master`: the head must be `develop` of this repository and the author the owner. Against `develop`: exactly one commit with a one-line message. Any other base fails. |
| `workflows/release.yml` | Push to `master` | Builds the `.vsix`, creates the tag `v<version>` (from `package.json`) and a release with the `.vsix` attached. It fails if the tag exists already, so raise the version before merging. It does not publish to the Marketplace. |

## Other files

- `CODEOWNERS`: the owner reviews everything.
- `rulesets/develop.json`, `rulesets/master.json`: the branch rules above. Import them in *Settings → Rules → Rulesets → New → Import a ruleset*. The status checks they require are `build` and `pr-rules`.
- `dependabot.yml`: weekly npm updates (at most 20 open pull requests), monthly GitHub Actions updates. Its pull requests are exempt from the one-commit, one-line rule of `pr-rules.yml`, because Dependabot writes a title and a body.
- `ISSUE_TEMPLATE/`: bug report and feature request; blank issues are off and security problems point to private reporting.
- `../SECURITY.md`: how to report a security problem.

## Setting up a repository

1. Make the repository public (the rules are not enforced on private repositories of the free plan).
2. Push `develop` and `master` once, before the rulesets, so the workflows run and the check names `build` and `pr-rules` exist.
3. Import the two rulesets.
4. *Settings → Code security*: turn on private vulnerability reporting.
5. *Settings → General → Pull Requests*: allow squash merging with the default commit message *Pull request title*.

## Making a change (owner)

```
git switch develop && git pull
git switch -c my-change
# edit, then:
npm run format && npm run lint && npm run compile
git add -A
git commit -m "One line message"
git push -u origin my-change
```

Open the pull request against `develop`, wait for the checks, and squash and merge. Several commits? Join them first: `git reset --soft origin/develop`, commit once, `git push --force-with-lease`.

## Making a release (owner)

1. Raise `version` in `package.json` and merge that into `develop`.
2. Open a pull request from `develop` to `master`, and merge it.
3. `release.yml` builds the `.vsix`, tags the version and creates the release. Publishing to the Marketplace is done by hand.
