---
name: fix-pr
description: Address review feedback on an existing pull request - fetch the PR, its review comments and CI state, fix the justified findings, validate, run the code-reviewer, then commit, push, and refresh the PR summary. Use when asked to fix, resolve, or respond to PR feedback, e.g. "/fix-pr 57".
argument-hint: "[pr-number]"
arguments: pr
---

# Fix a pull request

Resolve review feedback on PR `$pr` (default: the PR for the current branch). Never
merge.

## 1. Gather

- Resolve the PR if `$pr` is empty: `gh pr view --json number,title,body,headRefName`.
- Read the PR, all review comments and review threads, and the relevant CI state
  (`gh pr checks`).
- Make sure you are on the PR's branch with its latest commits.

## 2. Triage

- Separate actionable, justified findings from noise.
- Do not blindly apply suggestions. Verify each one against the code; if a suggestion
  is wrong, would regress behavior, or misreads the issue, leave it and explain why.
- If a finding is unclear, say what you need rather than guessing.

## 3. Fix

- Fix the justified findings with the smallest sufficient change.
- Keep every fix consistent with the PR's linked issue and existing repository
  patterns.

## 4. Validate

- Run the validation affected by your changes for the relevant project
  (`link-backend` uses yarn; `link-gift-send` uses npm).
- Never claim a check passed unless it actually ran successfully.

## 5. Review

- Invoke the `code-reviewer` agent with the PR reference and the diff.
- Fix material findings, then rerun the affected checks.

## 6. Deliver

- Commit and push to the PR branch.
- Update the PR summary when the change set or its status meaningfully changed.
- Report what you fixed, what you deliberately did not fix and why, and the validation
  you ran. Do not merge.
