# Changesets

This monorepo uses [Changesets](https://github.com/changesets/changesets) for **independent** package versioning, changelog generation, and npm publish (with provenance on CI).

The private root package (`paykernel`, `"private": true`) is automatically excluded by Changesets. Only publishable packages under `packages/*` (today: `@paykernel/core` in `packages/core`) are versioned and published.

## Day-to-day: record a change

After a user-facing or publish-worthy change, create a changeset:

```bash
bunx changeset
# or
bun run changeset
```

Pick the package(s), bump type (`patch` / `minor` / `major`), and write a short summary. Commit the generated Markdown file under `.changeset/`.

Empty / documentation-only PRs do not need a changeset.

## Version packages (local or via CI PR)

Applies pending changesets: bumps `package.json` versions, updates each package’s `CHANGELOG.md`, and consumes the changeset files.

```bash
bun run version-packages
# equivalent: bunx changeset version
```

Prefer letting the **Release** GitHub Action open a “Version packages” PR on `master` rather than versioning by hand on every merge.

## Publish

**Do not publish casually from a laptop in normal flow.** CI publishes on `master` when a version PR is merged (see `.github/workflows/release.yml`).

If you must publish locally (maintainer escape hatch):

```bash
bun run build
bun run release
# equivalent: bunx changeset publish
```

Requires npm auth and will not enable GitHub OIDC provenance the way CI does. Prefer CI.

## Prerelease channels (canary / beta)

Enter prerelease mode (example: `canary`):

```bash
bun run changeset:pre:enter
# or: bunx changeset pre enter canary
# or: bunx changeset pre enter beta
```

While in pre mode, `changeset version` produces versions like `0.9.0-canary.0`. Publish as usual (CI or `bun run release`).

Exit prerelease mode before cutting a stable release:

```bash
bun run changeset:pre:exit
# or: bunx changeset pre exit
```

Full policy and CI details: [docs/releases.md](../docs/releases.md).
