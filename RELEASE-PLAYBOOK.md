# Release Playbook

Agent-executable guide for releasing `@dolphin278/vjuga`.

## Prerequisites

- `gh` CLI authenticated (`gh auth status`)
- Push access to `origin` (git@github.com:dolphin278/vjuga.git)
- Trusted Publisher configured on npmjs.com (see [One-Time Setup](#one-time-setup))
- Repo visibility is **public**. `npm publish --provenance` rejects publishes
  from private source repos with `422 Unsupported ... visibility: "private"` —
  the SLSA attestation must be verifiable against a public commit.
- Node 22+, `npm ci` succeeds

---

## Step 1 — Gather changes since last release

Pull tags from the remote before inspecting history — local clones often
lack remote tags, causing `git describe` to fail:

```bash
git fetch --tags origin
LAST_TAG=$(git describe --tags --abbrev=0)
echo "Last release: $LAST_TAG"
git log ${LAST_TAG}..HEAD --format="%H %s%n%b" --no-merges
```

Read every commit subject and body. Note the commit hashes.

---

## Step 2 — Classify changes and pick version bump

Apply these rules in priority order:

| Signal | Bump |
|--------|------|
| Commit body contains `BREAKING CHANGE:` | **major** |
| Commit subject ends with `!` (e.g. `feat!:`, `fix!:`) | **major** |
| Exported API removed or renamed (check `src/`) | **major** |
| Any commit type is `feat` | **minor** |
| All commits are `fix`, `docs`, `chore`, `refactor`, `perf`, `test` | **patch** |

When in doubt, read the diff: `git diff ${LAST_TAG}..HEAD -- src/`

---

## Step 3 — Write release notes

Compute the target version now (substitute the bump type from Step 2) so the changelog URL is correct when you write the notes:

```bash
LAST_TAG=$(git describe --tags --abbrev=0)
BUMP=[patch|minor|major]
NEW_VERSION=$(npx --yes semver -i ${BUMP} $(node -p "require('./package.json').version"))
echo "Releasing: ${LAST_TAG} → v${NEW_VERSION}"
```

Use this structure:

```
## What's Changed

### Breaking Changes ⚠️
- **[Short label]**: Description of what broke and how to migrate.

### New Features
- Description of new capability and when to use it.

### Fixes & Improvements
- Description of fix or improvement.

### Internal / Documentation
- Description of internal change.

**Full changelog**: https://github.com/dolphin278/vjuga/compare/${LAST_TAG}...v${NEW_VERSION}
```

Guidelines:
- Lead with user impact, not implementation detail
- Breaking changes **must** include migration instructions
- Each bullet ≤ 120 characters
- Present tense: "Add X" not "Added X"
- Skip sections with no entries
- Make it informative — a user upgrading should understand what changed and why it matters

Write the notes to `/tmp/release-notes.md` (Step 4 reads this path):

```bash
cat > /tmp/release-notes.md << 'EOF'
<release notes here>
EOF
```

---

## Step 4 — Bump version and tag with release notes

```bash
npm version [patch|minor|major] --no-git-tag-version
NEW_VERSION=$(node -p "require('./package.json').version")
git add package.json package-lock.json
git commit -m "chore: release v${NEW_VERSION}"
git tag -a "v${NEW_VERSION}" -F /tmp/release-notes.md
```

`--no-git-tag-version` bumps `package.json` and `package-lock.json` (no automatic commit or tag). The manual `git tag -a` creates an annotated tag whose message is the release notes from Step 3 — making the tag the single source of truth for release content.

Verify: `git log --oneline -3` and `git show "v${NEW_VERSION}" | head -30`

---

## Step 5 — Push tag (triggers publish)

```bash
git push origin master --follow-tags
```

The `.github/workflows/publish.yml` workflow fires on the new `v*` tag and runs `npm publish --provenance`. The `--provenance` flag attaches a SLSA attestation signed by GitHub OIDC, proving the package was built from this repo and commit.

The `prepare` script (tsc, lint, coverage, fuzz) runs automatically before pack as a quality gate.

---

## Step 6 — Create GitHub release

```bash
NEW_VERSION=$(node -p "require('./package.json').version")
gh release create "v${NEW_VERSION}" --title "v${NEW_VERSION}" --notes-from-tag
```

`--notes-from-tag` reads the annotated tag message created in Step 4 and uses it as the release body. No separate notes argument needed.

---

## Step 7 — Verify

```bash
NEW_VERSION=$(node -p "require('./package.json').version")

# Workflow status
gh run list --workflow=publish.yml --limit 3

# npm version live
npm view @dolphin278/vjuga version

# GitHub release
gh release view "v${NEW_VERSION}"

# Provenance attestation
npm audit signatures
```

All four checks must pass before the release is considered complete.

---

## One-Time Setup

These steps require a human with browser access and cannot be automated.
No npm token or GitHub secret is needed — authentication uses GitHub's OIDC identity.

1. Go to [npmjs.com](https://www.npmjs.com) → your packages → **@dolphin278/vjuga**
2. Navigate to **Settings** → **Trusted Publishers**
3. Click **Add a Trusted Publisher** and fill in:
   - **Publisher**: GitHub Actions
   - **Organization or username**: `dolphin278`
   - **Repository**: `vjuga`
   - **Workflow filename**: `publish.yml`
   - **Environment** (optional): leave blank unless you use GitHub Environments
4. Save. Done.

The workflow's `id-token: write` permission lets GitHub Actions generate an OIDC token;
the npm registry verifies it against the trusted publisher config and allows publish without
any stored secret.

---

## Example: Minor Release (v8.1.0)

```bash
# 1. Check what changed
git fetch --tags origin
LAST_TAG=$(git describe --tags --abbrev=0)
git log ${LAST_TAG}..HEAD --oneline --no-merges
# Output:
#   3887be7 Reorganize agent documentation
#   5cf8817 Support extensionless package subpath imports

# 2. Classify:
#   - 3887be7: docs → patch signal
#   - 5cf8817: adds new import path support → feat → minor bump
#   → minor wins → v8.1.0

# 3. Write notes
cat > /tmp/release-notes.md << 'EOF'
## What's Changed

### New Features
- Add explicit `.js`-extension subpath exports alongside extensionless ones.
  TypeScript consumers can now import with full `.js` extension (e.g.
  `import * as R from "@dolphin278/vjuga/Result.js"`) without adjusting
  `moduleResolution` or `paths` in `tsconfig.json`. Both styles now work.

### Internal / Documentation
- Reorganize agent documentation for improved clarity and navigation.

**Full changelog**: https://github.com/dolphin278/vjuga/compare/v8.0.0...v8.1.0
EOF

# 4. Bump version and tag with release notes
npm version minor --no-git-tag-version
NEW_VERSION=$(node -p "require('./package.json').version")
git add package.json package-lock.json
git commit -m "chore: release v${NEW_VERSION}"
git tag -a "v${NEW_VERSION}" -F /tmp/release-notes.md

# 5. Push
git push origin master --follow-tags

# 6. Create release from tag annotation
gh release create "v8.1.0" --title "v8.1.0" --notes-from-tag

# 7. Verify (give workflow ~2 min to complete)
gh run list --workflow=publish.yml --limit 1
npm view @dolphin278/vjuga version
```

---

## Troubleshooting

If `npm publish --provenance` fails with `422 Unprocessable Entity` and
`Error verifying sigstore provenance bundle`, **read the rest of the message**
— it names the precise cause (repository visibility, missing trusted
publisher, branch protection, etc.). Don't assume an OIDC/auth problem: in
the publish flow, OIDC token exchange and sigstore signing run *before*
provenance verification, so by the time you see a 422 the auth path has
already succeeded.

Known causes seen on this repo:

- **`Unsupported ... visibility: "private"`** — flip the GitHub repo to public
  (`gh repo edit <owner>/<repo> --visibility public --accept-visibility-change-consequences`).
  npm provenance requires a public source repo.
- **npm 10.9.7 OIDC bug** — Node 22's bundled npm has a known publish-side
  OIDC issue. The workflow uses `npx --yes npm@^11 publish` to bypass it; do
  not "simplify" this back to plain `npm publish` without re-testing.
