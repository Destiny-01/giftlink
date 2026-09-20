---
name: ship
description: Take a GitHub issue from triage to an open pull request - fetch the issue, create an isolated worktree and feature branch, implement it fully with tests, validate, run the code-reviewer, fix material findings, then commit, push, and open a PR that closes the issue. Use when asked to implement or ship an issue, e.g. "/ship 42".
argument-hint: "<issue-number>"
arguments: issue
---

# Ship a GitHub issue

Deliver issue `#$issue` end to end. Never merge the PR.

## 1. Fetch and validate the issue

- `gh issue view $issue --json number,title,body,labels,state,comments,assignees`.
- Confirm it is suitable for implementation: open, scoped, and specific enough that
  "done" is checkable. If it is ambiguous, already fixed, or a duplicate, stop and
  report why instead of guessing. Ask the user only when the ambiguity is genuine.

## 2. Isolate the work

- Create a worktree and branch off the current `main`: `feat/$issue-<slug>`, where
  `<slug>` is a short kebab-case summary of the issue title.
- Work only in that worktree.

## 3. Understand before writing

- Read the issue, then the code it touches and its call sites.
- Consult `docs/PRODUCT.md` when product behavior or terminology matters and
  `docs/DECISIONS.md` when an established decision may be affected. Skip them when
  irrelevant.
- Determine the implementation strategy and decomposition yourself; the issue defines
  *what*, not *how*.

## 4. Implement

- Implement the complete issue, not a partial slice.
- Follow existing repository patterns rather than introducing parallel abstractions.
- Add or update tests for the behavior you changed.
- Use subagents when they materially help (parallel independent work, or exploration
  that would flood your context) - not ceremonially.

## 5. Validate

- Run the validation that applies to what changed (lint, typecheck, tests, build) for
  the affected project. The monorepo has two projects: `link-backend` (yarn) and
  `link-gift-send` (npm). Use each project's real scripts.
- Never claim a check passed unless it actually ran successfully.

## 6. Review

- Invoke the `code-reviewer` agent with the issue reference and the diff (`git diff
  main...HEAD`).
- Fix every BLOCKING finding and every IMPORTANT finding that is justified. You may
  reject an IMPORTANT finding with a clear reason, but say so in the PR summary.
- Rerun the affected checks after fixing.
- If you made substantial corrections, allow at most one additional `code-reviewer`
  pass. Do not loop.

## 7. Deliver

- Commit and push the branch.
- Open a PR with `Closes #$issue` in the body.
- If the issue carries the `architect-review` label, apply that label to the PR too.
- The PR summary must cover: what was implemented, acceptance-criteria coverage,
  validation actually run, reviewer findings fixed, unresolved concerns, and any
  contract deviations.
- Report the PR URL. Do not merge.
