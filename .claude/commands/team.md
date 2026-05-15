---
description: Fan a feature spec to the SkateHubba dev team. Usage — /team <feature description>
---

You are dispatching feature work across the SkateHubba senior dev
team. The user's spec is in `$ARGUMENTS`.

## Procedure (follow exactly)

### 1. Scope (sequential, blocking)

Invoke `tech-lead-reviewer` with `model: "opus"`. Ask it to:
- Identify the change surface (which files, which layers).
- List blast-radius callers/dependents.
- Flag any CLAUDE.md guardrails the spec risks.
- Return a one-paragraph scope summary plus a per-lane work list.

### 2. Implementation (parallel — single message, multiple Agent calls)

Based on the reviewer's lane list, dispatch in parallel — **one
message containing every Agent tool call**, not sequential turns:

- `firebase-engineer` (`model: "opus"`) — if services / Firebase /
  transactions / listeners are involved.
- `rules-guardian` (`model: "opus"`) — if any new write path,
  document shape, or collection is involved. Coordinate with
  firebase-engineer on the contract.
- `frontend-engineer` (`model: "opus"`) — if there's UI surface,
  new routes, hooks, or context.
- `qa-engineer` (`model: "opus"`) — for the test plan and any
  cross-lane integration or E2E coverage. Often runs last because
  unit tests ship with the production code in the same commit.
- `release-engineer` (`model: "opus"`) — only if CI, build, or
  Vercel config changes.

Give each agent the reviewer's scope summary plus its slice of the
work list. Each agent ships its own tests with its code.

### 3. Final review (sequential, blocking)

Invoke `tech-lead-reviewer` (`model: "opus"`) again with the diff
(`git diff --staged` or `git diff main...HEAD`). It returns
`APPROVE` / `REQUEST CHANGES` / `BLOCK`.

- `APPROVE` → run the `/ship` verify gate, then commit on the current
  branch with a conventional-commit message. Push with
  `git push -u origin <branch>`. Do not open a PR unless the user
  asked.
- `REQUEST CHANGES` → loop back to step 2 with only the affected
  agents.
- `BLOCK` → stop, report the blocker to the user, ask for direction.

## Hard rules

- Every Agent tool call in this command **must** include
  `model: "opus"`. CLAUDE.md rule 7, no exceptions.
- Parallel agents go in **one message**. If you find yourself sending
  them sequentially, you're doing it wrong.
- No drive-by refactors. Each specialist stays in its lane. If a
  task crosses lanes, the reviewer splits it before step 2 starts.
- No PR creation unless the user's spec explicitly requests one.
