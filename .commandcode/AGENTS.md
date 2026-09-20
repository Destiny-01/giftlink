# Standing Rules

- GitHub issues define what a feature must accomplish. Determine implementation details from the repository.
- Consult `docs/PRODUCT.md` when product behavior or terminology matters and `docs/DECISIONS.md` when established decisions may be affected. Do not load them ritualistically when irrelevant.
- Own implementation strategy and decomposition.
- Use built-in or custom subagents only when they materially improve speed, context isolation, or quality.
- Follow existing repository patterns where appropriate rather than creating parallel abstractions unnecessarily.
- Before completing code changes, run validation appropriate to the change and invoke the project `code-reviewer`.
- Fix BLOCKING and justified IMPORTANT reviewer findings and rerun affected checks.
- Never claim a check passed unless it actually ran successfully.
- Never merge a PR yourself.
- Never broadcast a mainnet deployment or spend real funds without explicit user approval.
