# Toolchain and compatibility record

Checked 2026-10-20 against the npm registry (dist-tags, release times, `peerDependencies`, `engines`). Exact versions are pinned in `package.json` (`save-exact`) and `package-lock.json`.

| Package | Pinned | Released | Compatibility notes |
| --- | --- | --- | --- |
| Node.js | 22.23.1 (engines `>=22.12 <23`) | installed | Prisma 7 needs `^22.12`; Next 16 needs `>=20.9`; axe-core/playwright needs `>=22.12`. |
| next / eslint-config-next | 16.4.2 | 2026-10-15 | Peers React `^19`; App Router; `proxy.ts` (renamed middleware); async `params`/`cookies()`; `after()` used for post-response work. Latest patch of the current minor chosen for security fixes. |
| react / react-dom | 19.3.1 | 2026-10-14 | |
| typescript | 6.0.3 | 2026-04-16 | 7.0.2 excluded: typescript-eslint peer `<6.1.0`. Prisma peer `>=5.4`. |
| prisma / @prisma/client / @prisma/adapter-pg | 7.10.1 | 2026-10-15 | `prisma-client` generator (ESM, output `src/generated/prisma`), `prisma.config.ts`, pg driver adapter; `schemas = ["commerce"]`. 8.0 is RC only. |
| pg / @types/pg | 8.23.1 / 8.23.1 | 2026-09-30 / 08-17 | |
| zod | 4.6.7 | 2026-10-12 | `z.strictObject`, `z.uuid()`, `z.url()`. |
| @supabase/supabase-js / @supabase/ssr | 2.118.0 / 0.12.7 | 2026-10-15 / 09-08 | ssr peers supabase-js `^2.114`. For I08. |
| radix-ui | 1.8.1 | 2026-10-12 | Unified package; React 19 peer. Dialog used for the mobile filter sheet. |
| lucide-react | 1.55.0 | 2026-10-10 | DR-006. |
| libphonenumber-js | 1.13.15 | 2026-10-08 | Rwanda mobile validation (`max` metadata). |
| eslint | 9.39.5 | 2026-07-10 | Marked unsupported on npm; ESLint 10 blocked by eslint-plugin-react 7.37.5 (DR-003). |
| typescript-eslint | 8.72.0 (via eslint-config-next) | | |
| vitest / vite | 4.1.12 / 7.3.7 | 2026-10-15 / 10-06 | Vite pinned by `overrides` (DR-005). Vitest 5.0.5 also exists (Node `^22.12`); 4.1 kept as the mature line. |
| @playwright/test / @axe-core/playwright | 1.64.1 / 4.14.0 | 2026-10-14 / 10-15 | Chromium revision already present locally. |
| tsx | 4.23.15 | 2026-09-20 | Scripts run with `--conditions=react-server` so `server-only` resolves to its empty export. |
| subset-font | 2.9.0 | 2026-09-20 | harfbuzz WASM; variable-axis limiting (`wght 400-700`) works on Windows without Python. |
| prettier | 3.9.10 | 2026-10-10 | |

## Databases

| Environment | Engine | Notes |
| --- | --- | --- |
| Local dev/test | PostgreSQL 16.15 (project-local cluster) | Durability relaxed (DR-008). Extensions used: `pg_trgm` (in schema `extensions`). |
| Supabase dev project | PostgreSQL 17 (`17.11.0.003`) | Migrations use only features available in 15-17 (partial unique indexes, CHECKs, `FOR UPDATE SKIP LOCKED`, constraint triggers, `gen_random_uuid()`). **Before release, run the integration suite against Postgres 17** (Supabase branch or a PG17 cluster via `PG_BIN`). |

## Known warnings

- `npm warn deprecated eslint@9.39.5` (DR-003).
- `prisma` prints "Update available 7.10.1 -> 8.0.0-rc.23"; ignore until 8.0 is GA and reviewed.
