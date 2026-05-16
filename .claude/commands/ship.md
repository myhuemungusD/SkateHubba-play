---
description: Run the SkateHubba verify gate (tsc, lint, coverage, build, test-dup). On failure, dispatch the right specialist.
---

Run the full SkateHubba verification gate, in this exact order, and
report the first failure with file paths and the failing assertion or
error message:

```bash
npx tsc -b && npm run lint && npm run test:coverage && npm run build && npm run check:test-dup
```

**On success:** print a green checklist of the five steps and stop.

**On failure:** identify which step failed and which file(s) caused
it, then hand off to the right specialist by invoking the matching
subagent with `model: "opus"`:

- **`npx tsc -b` failure** → invoke the agent whose lane owns the
  failing file (services → `firebase-engineer`, screens/components
  /hooks → `frontend-engineer`, rules-tests → `rules-guardian`, test
  files → `qa-engineer`, build/CI → `release-engineer`).
- **`npm run lint` failure** → same dispatch rule by file path.
- **`npm run test:coverage` failure** → `qa-engineer` first; if the
  failure is a real bug not a missing test, then the owning lane.
- **`npm run build` failure** → `release-engineer`.
- **`npm run check:test-dup` failure** → `qa-engineer`.

Do not skip any step. Do not run with `--no-verify`. Do not amend a
previous commit to make this pass — make a new commit.

All subagent dispatches must use `model: "opus"`. No exceptions
(CLAUDE.md rule 7).
