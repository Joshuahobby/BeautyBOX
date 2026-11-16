## Repository freshness

- Before reviewing the product, choosing implementation changes, or starting a new task, check the working tree and fetch the latest GitHub refs. Compare the local commit with the intended upstream branch (normally `origin/main`).
- Preserve local work. Fast-forward an outdated clean baseline when appropriate; if branches diverge or local changes overlap, reconcile them without discarding work. Do not review an old local checkout as though it were the current product.
- Record the source commit used for builds, screenshots, reviews and verification. Check upstream again before final handoff if work has continued while the task was in progress.
- Treat GitHub source and a deployed site's version as separate facts. Do not claim deployment parity without evidence for the deployed commit. When live-site access is unavailable, use the latest GitHub source locally and state that limit instead of reverting to an older implementation.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
