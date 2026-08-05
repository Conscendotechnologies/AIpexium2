# sync.yml — updates to apply in the mirror repo

The sync workflow lives in the **public mirror repo** (`Conscendotechnologies/siid-forge-api`,
`.github/workflows/sync.yml`), not in this monorepo, so it can't be edited from here. Apply the
two changes below there.

Both are additive and preserve the existing **no-change guard** (`git diff --quiet` → exit 0),
so the daily cron still does nothing on a quiet day.

## 1. Also mirror `CHANGELOG.md`

In the **"Copy types into repo root"** step, add the CHANGELOG to the copied files:

```bash
cp -f ".src/${SOURCE_SUBDIR}/index.d.ts"      ./index.d.ts
cp -f ".src/${SOURCE_SUBDIR}/siid-forge.d.ts" ./siid-forge.d.ts
cp -f ".src/${SOURCE_SUBDIR}/package.json"    ./package.json
cp -f ".src/${SOURCE_SUBDIR}/README.md"       ./README.md
cp -f ".src/${SOURCE_SUBDIR}/CHANGELOG.md"    ./CHANGELOG.md   # ← add
```

And include it in the **change-detection + commit** file lists in the "Commit & push if changed" step:

```bash
if git diff --quiet -- index.d.ts siid-forge.d.ts package.json README.md CHANGELOG.md; then
  echo "No changes to sync."; exit 0
fi
...
git add index.d.ts siid-forge.d.ts package.json README.md CHANGELOG.md
```

## 2. Create a GitHub Release per new tag (with the CHANGELOG entry as notes)

After the existing `git tag "v${VER}" && git push --tags` block, add a step that publishes a
Release whose body is the matching `## <VER>` section of `CHANGELOG.md`. This gives a browsable
version list with "what changed" — the pre-upgrade release note. Runs only when a NEW tag was
just created (same `rev-parse` guard), so no duplicate releases on quiet days.

```yaml
      - name: Publish GitHub Release for the new tag
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          set -eu
          VER=$(node -e "process.stdout.write(require('./package.json').version)")
          # Only if the tag exists (just created) and no Release exists yet for it.
          if git rev-parse "v${VER}" >/dev/null 2>&1 && ! gh release view "v${VER}" >/dev/null 2>&1; then
            # Extract the "## <VER>" section from CHANGELOG.md as the release body.
            NOTES=$(node -e "
              const fs=require('fs');
              const md=fs.readFileSync('CHANGELOG.md','utf8');
              const re=new RegExp('^## '+process.argv[1].replace(/\\./g,'\\\\.')+'\\\\b[\\\\s\\\\S]*?(?=^## |\\\\Z)','m');
              const m=md.match(re);
              process.stdout.write((m?m[0]:'Release v'+process.argv[1]).trim());
            " "${VER}")
            printf '%s\n' "$NOTES" | gh release create "v${VER}" --title "v${VER}" --notes-file -
          fi
```

> `gh` is preinstalled on `ubuntu-latest`; `github.token` already has `contents: write`
> (which the workflow declares), enough to create releases in the same repo.
