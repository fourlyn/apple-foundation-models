# Releasing

Releases are published by GitHub Actions (`.github/workflows/release.yml`) when a version tag is pushed.

## One-time setup

1. Create an npm **automation** token with publish access to the `@fourlyn` scope.
2. Add it to the GitHub repository as the secret `NPM_TOKEN` (Settings → Secrets and variables → Actions).

## Cut a release

1. Update `CHANGELOG.md`: rename the top section to the new version, e.g. `## 0.2.0 — 2026-10-15`.
   The workflow copies the section whose heading starts with that version into the GitHub release notes.
2. Set the same version in `src/models.ts` (`PACKAGE_VERSION`).
3. Bump `package.json` and create the tag:

   ```sh
   npm version minor        # or patch / major / 1.0.0-beta.1
   git push --follow-tags
   ```

   `npm version` commits `package.json` and tags `vX.Y.Z`. Commit the changelog and `PACKAGE_VERSION` changes
   first, or stage them and use `npm version minor --force`.

## What the workflow does

| Step | Fails the release when |
| --- | --- |
| Version check | the tag, `package.json` and `PACKAGE_VERSION` disagree |
| `npm run typecheck`, `npm test`, `npm run build` | anything fails |
| `npm publish --access public --provenance` | the token is missing or the version already exists |
| GitHub release | — (notes come from `CHANGELOG.md`) |

Pre-release versions (anything with a `-`, such as `1.0.0-beta.1`) are published under the npm tag `next` and
marked as pre-releases on GitHub, so `npm install @fourlyn/apple-foundation-models` keeps resolving to the latest
stable version.

## Versioning

[Semantic Versioning](https://semver.org). While the version is `0.x`, minor versions may contain breaking
changes; say so in the changelog. Apple SDK support changes (a new minimum Xcode, a renamed Apple API) are
breaking changes.

## Before tagging

Run the checks in [testing.md](./testing.md): the three automated suites, then the Self-Test on a physical device.
The workflow runs only the JS suite; the Swift tests and the example build run in CI on every push.
