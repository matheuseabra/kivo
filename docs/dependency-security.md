# Dependency security update

Updated: 2026-10-24. The audit used the official npm registry at `https://registry.npmjs.org`.

The initial registry audit reported 25 vulnerabilities: 6 low, 3 moderate, 13 high and 3 critical. The 18-item audit snapshot recorded before this run came from a different registry snapshot. `npm audit fix` without `--force` updated the lockfile within the existing package version ranges. It did not change `package.json` or introduce major-version changes.

The lockfile now resolves Next.js 16.4.3, `@ai-sdk/google` 3.0.138, `@ai-sdk/react` 3.0.318, `ai` 6.0.315, PostCSS 8.5.23, Sharp 0.35.5, Vite 7.3.7, Vitest 4.1.12 and Zod 4.6.7. The package manifest remains unchanged.

## Verification

- `npm ci --registry=https://registry.npmjs.org` completed from this worktree.
- `npm audit --registry=https://registry.npmjs.org` reports zero vulnerabilities.
- `npm audit --omit=dev --registry=https://registry.npmjs.org` reports zero vulnerabilities.
- Focused generation, provider and LLM tests passed: 134 tests across 6 files.
- `npm run build` compiled successfully with Next.js 16.4.3, then stopped during TypeScript checking. It reported the repository's existing 297 TypeScript diagnostics. No source files changed in this update.

The audit is a point-in-time result. Re-run `npm audit` against the intended registry as part of regular release checks.
