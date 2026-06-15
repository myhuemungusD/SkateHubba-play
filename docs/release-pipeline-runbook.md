# Release Pipeline Runbook

How to recover when the **Release Pipeline Freshness** workflow
(`.github/workflows/release-pipeline-freshness.yml`) opens an alert issue.

---

## Symptom

A GitHub issue is opened (or commented on) carrying the
`release-pipeline-stuck` label with title:

> `[release-pipeline] release-please appears stuck — manual recovery required`

The body lists one or more of:

- A merged release PR still labelled `autorelease: pending` more than 24h
  after merge.
- A PR labelled `autorelease: tagged` whose merge SHA has no matching `v*`
  tag.
- A version named in `.release-please-manifest.json` with no corresponding
  remote tag.

---

## Historical reference

**PR #247** (`chore(main): release 1.1.0`) merged on **2026-04-19** and sat
in this exact stuck state for ~2 months. release-please-action ran with no
visible error but never created the `v1.1.0` tag or GitHub Release. The
manifest was bumped to `1.1.0` and the in-PR label was never advanced from
`autorelease: pending` to `autorelease: tagged`. The freshness workflow
exists so this can never recur silently.

---

## Root cause classes

Roughly in descending order of likelihood:

1. **Missing GitHub Release / tag** — release-please's tagging step
   exited non-zero or was skipped (concurrent push race, branch protection
   blocking the bot, transient API error). PR is merged, manifest is bumped,
   nothing else happened.
2. **Token permissions drift** — `GITHUB_TOKEN` lost `contents: write` or
   `pull-requests: write`, or org-level branch protection began blocking
   the bot from pushing tags to `main`. release-please surfaces this as a
   non-fatal warning in the action log, not as a job failure.
3. **Bot label drift** — release-please relies on the
   `autorelease: pending` → `autorelease: tagged` label transition to know
   what work is outstanding. A human removing/renaming a label, or a label
   rename on the repo, breaks the state machine.
4. **Action version incompatibility** — a `googleapis/release-please-action`
   major bump that silently changed expected manifest shape or default
   release strategy.

---

## Recovery steps

> All commands assume you are on a clean checkout of `main` with push
> access. Replace `vX.Y.Z` with the actual missing version reported in the
> alert body.

### 1. Identify the missing tag

```bash
git fetch --tags origin
cat .release-please-manifest.json   # what release-please thinks shipped
git tag --list 'v*' | sort -V       # what actually has a tag
```

The diff between the two is the recovery list.

### 2. Find the merge SHA that should carry the tag

From the alert body, copy the PR number, then:

```bash
gh pr view <PR_NUMBER> --json mergeCommit,mergedAt,labels
```

Confirm:

- The PR is in fact a release-please PR (title `chore(main): release ...`).
- `mergeCommit.oid` is on `main` (`git branch --contains <sha>`).

### 3. Create the missing tag retroactively

```bash
git tag -a vX.Y.Z <MERGE_SHA> -m "Release vX.Y.Z (retroactive — see release-pipeline-runbook)"
git push origin vX.Y.Z
```

If there are multiple missing versions (rare), tag them in order from
oldest to newest.

### 4. Create the GitHub Release entry

release-please normally generates the release notes section of CHANGELOG
for the same SHA. Reuse it:

```bash
# Extract the section from CHANGELOG.md for vX.Y.Z, then:
gh release create vX.Y.Z \
  --target <MERGE_SHA> \
  --title "vX.Y.Z" \
  --notes-file <(awk '/^## \[X\.Y\.Z\]/,/^## \[/' CHANGELOG.md | sed '$d')
```

If `CHANGELOG.md` is empty or wrong, fall back to a one-line body — the tag
existing is what matters; the release entry is documentation.

### 5. Flip the bot label

In the GitHub UI on the original release PR:

- Remove `autorelease: pending`.
- Add `autorelease: tagged`.

This is what release-please itself would have done. The freshness check
keys off these labels, so skipping this step will re-fire the alert.

### 6. Verify

```bash
# Manual run of the freshness workflow — should now find no problems.
gh workflow run release-pipeline-freshness.yml
gh run watch
```

The job should print "Release pipeline looks healthy — all tags accounted
for." and exit cleanly. Close the alert issue once you have confirmed
this.

---

## Prevention

This runbook covers **recovery**. Prevention is handled separately:

- The freshness cron (this workflow) detects the stuck state within 24h.
- Stream B's workflow hardening adds explicit failure surfacing to
  `release-please.yml` so future tagging errors are not silent.
- Stream D's integrity gate verifies manifest/tag parity at PR time.
