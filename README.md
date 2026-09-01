# Moth Forge Quampute — Public Demonstration

This repository is a privacy-safe public demonstration of an evidence-routed collaborative workflow. Its bundled content is synthetic: it does not contain the private source corpus, private tab names, private taxonomy, private checkpoints, private or preexisting hosting metadata, or private repository history. It does contain one newly generated non-secret Sites binding file described below.

## What is included

The release copier used a closed allowlist. It copied only these application directories:

- `app/`
- `db/`
- `drizzle/`
- `docs/`
- `lib/`
- `public/`

It copied only these root files:

- `.env.example`
- `.gitignore`
- `LICENSE`
- `drizzle.config.ts`
- `env.d.ts`
- `eslint.config.mjs`
- `next.config.ts`
- `package.json`
- `pnpm-lock.yaml`
- `pnpm-workspace.yaml`
- `tsconfig.json`
- `vite.config.ts`

The public `forge-bundle/`, this README, `PUBLIC_RELEASE_RECEIPT.json`, and the target hosting file were generated independently. The private generator itself is intentionally absent. Scripts, checkpoints, private bundles, the private `.openai` tree, `.git`, dependencies, caches, outputs, and build directories were not copied. A fresh `.openai/hosting.json` was created with only project `appgprj_6a95ddcaad2481919c47c027f6259e68` and the non-secret `DB`/`FILES` binding names required by Sites.

## Synthetic pack receipt

- Tabs: **29**
- Questions: **607**
- Unique question IDs: **607**
- Unique normalized question prompts: **607**
- Duplicate normalized prompts: **0**
- Distribution: **27 tabs × 21 questions; 2 tabs × 20 questions**
- Manifest SHA-256: `a8c359131df01acd68031ad89589ac36172b53a9d11b8a4979242b78bbe2e2fc`

Every tab title, identifier, filename, and prompt was created from public synthetic vocabulary. The loader and server anchor parse all synthetic tabs generically and validate tab hashes, byte counts, character counts, question counts, ID uniqueness, prompt uniqueness, and traversal order. The copied server route is also rewritten to request only IDs present in the synthetic public index.

## Privacy and history receipt

- Files scanned in the final pass, including this README and the machine receipt: **93**
- Forbidden content patterns checked: **26**
- Forbidden matches: **0**
- Forbidden-pattern inventory SHA-256: `58be4e66b72f18508a24ca14842861599820c2dd7c6b5c5210295fcb9edfa722`
- Credential-like filename patterns checked: **6**
- Credential-filename-pattern inventory SHA-256: `2321dca1d99ea99c1817e2e6354451ea28b7b77f8e03d98ec4ea41b9e96e4239`
- Credential-like filenames found: **1** (the generated and content-validated `.openai/hosting.json` only)
- Unexpected credential-like filenames: **0**
- Generation mode: **fresh_directory_without_git_history**
- Git history evidence: **not applicable; this was generated into a fresh directory without a repository**

The private-pattern regular-expression text is intentionally withheld. Opaque ordinal identifiers and SHA-256 fingerprints identify the exact inventories used by the private generator, but they do not disclose protected semantics or make the protected scan independently reproducible without that generator. The machine-readable receipt records the exact allowlist, exclusions, public-only rewrites, uniqueness counts, pattern-inventory hashes, scan results, manifest hash, and history evidence. A receipt describes what this generator verified; it is not evidence of publication or deployment.

After a production build, the receipt hashes `dist/` with the documented `sha256-canonical-file-inventory-v1` algorithm: hash each exact file byte sequence with lowercase SHA-256; sort forward-slash relative paths with Node `String.localeCompare`; serialize rows shaped as `{path,bytes,sha256}` using UTF-8 `JSON.stringify` with no added whitespace; then SHA-256 that serialized byte sequence. Vinext also creates a per-build internal server-only prerender-header guard. The receipt records only its field name, length, value hash, and containing server-file hashes and paths; the value itself is never disclosed and is not a user credential.

## Install, verify, and run

1. Install the locked dependency graph with `pnpm install --frozen-lockfile`.
2. Verify source with `pnpm exec tsc --noEmit` and `pnpm run lint`.
3. Create the production artifact with `pnpm run build`.
4. Start a local production runtime with `pnpm start`, or use `pnpm run dev` while developing.

For the no-cost challenge experience, set `PUBLIC_DEMO_MODE=true`. The runtime still requires a D1 database bound as `DB` and an R2 bucket bound as `FILES`; apply the checked-in D1 migrations before opening the application. Public demo mode prevents paid model execution even if a server secret is accidentally present.

For a Sites deployment, use the generated `.openai/hosting.json` only as the project/binding declaration, provision the `DB` and `FILES` resources in the destination environment, configure runtime variables and secrets outside Git, build the exact candidate, and verify the deployed guided demo separately. No deployment or publication is performed by this repository or its release receipt.
