# BeautyBOX continuation and recovery plan

Checkpoint prepared on 16 November 2026, following the owner's request to push completed work before continuing tasks blocked by Google billing.

## What this checkpoint actually contains

- Fourteen recovered generated design previews, accessible as individual PNG files through [the visual index](design-explorations/README.md).
- The original eleven-concept index and a SHA-256 inventory of every recovered PNG.
- The decisions below, transcribed from the conversation, and an ordered implementation plan.

This is **not a backup of the missing later app implementation**. At inspection, `/workspace/BeautyBOX` was clean at `197e926c56dab50f0218ffdd017e40aeb039d79f`, matching GitHub `main`. The local reflog records resets to `FETCH_HEAD`; no stash, unreachable Git commit, implementation patch/bundle, or saved copy of the later checkout/delivery source was found in the available workspace. Every existing remote branch was fetched and checked for the expected Kigali configuration, Google adapter, live diagnostic and v1.2 contract files; none contained them. This establishes the available recovery points, not the reason for the missing files.

The previously discussed source files, standalone HTML prototypes, detailed backlog CSV and test-evidence directories were unavailable. Historical test counts mentioned in chat are not presented as freshly verified results for this checkout. Existing app code and its historical documentation remain the base for further development.

## Decisions to preserve

| Area                  | Owner direction / agreed starting point                                                                                                                                                                                                                                                                                             |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Visual direction      | Develop the Signature, Rare Boutique, Beauties Colour and Coral Discovery references further; use the supplied product/shade/cart preview when rebuilding purchase flows.                                                                                                                                                           |
| Homepage discovery    | Include controlled slides, mega menus, curated top picks and real deals when supported by catalogue data. Shop/brand discovery must be reconciled with the existing Phase 1 single-shop model before introducing new seller functionality.                                                                                          |
| Product and cart      | Large gallery, clearly labelled shared/illustrative images, required shade selection, explicit mobile shade confirmation, editable quantity/shade and transparent merchandise subtotal.                                                                                                                                             |
| Dispatch              | Owner-confirmed Silverback Mall, Kicukiro. Planning point: latitude -1.9688464, longitude 30.1025134; database precision discussed: -1.968846, 30.102513. Confirm the physical pickup entrance with a rider later.                                                                                                                  |
| Initial service area  | Kigali City first; nationwide delivery is a later expansion with separate courier pricing/operations. Source considered previously: OpenStreetMap City of Kigali relation 1708283. The previously imported geometry was missing; it has now been sourced again in full and checked (1,749 distinct vertices, OSM relation 1708283). |
| Starting delivery fee | RWF 1,500 for the first 3 road km, then RWF 250 per additional km, rounding the final amount upward to RWF 100. The owner authorized these starting prices, with later revision using actual expenses and feedback.                                                                                                                 |
| Real routing          | Server-side Places API (New) and Routes API motorcycle road distance. Never replace unavailable routes with guessed fees, driving distance or straight-line calculations.                                                                                                                                                           |
| Billing blocker       | Earlier live checks returned HTTP 403 Permission denied. The latest user-supplied Google screenshot shows a closed billing account, a disabled Reopen button and the BeautyBOX project already linked. Billing reactivation and fresh API checks remain outstanding; no fresh Google API calls were made for this checkpoint.       |
| Release boundary      | Push reviewable work to a separate Git branch. Do not merge into main, publish the cloud environment, update hosted settings, change payment/SMS modes or launch real sales as part of this checkpoint. Existing staging deployment behavior remains governed by `DEPLOYMENT.md`.                                                   |

The delivery terms and visual references are decisions to carry forward, not claims that they are currently applied to the loaded application.

## Rebuild checkpoint — 16 November 2026

Priorities 2 and 3 below are now implemented and locally verified on `codex/beautybox-storefront-rebuild`: Signature homepage, manual featured slides, mega menus, category/brand/budget discovery, responsive catalogue and demo-labelled packshots. Tests and captured visual QA are in `docs/evidence/storefront-rebuild/`. The product gallery, explicit shade sheet, cart option editing and checkout presentation are now restored and tested. Silverback Mall/Kigali configuration and server-only Google adapters are now also restored and mock-tested. Live Google testing remains pending billing reactivation. This is new rebuilt source, not recovered source from the earlier lost workspace.

## Task status and remaining work

| Priority               | Task                                                                                                                                                              | Completion evidence                                                                                                                          |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 1                      | Recover the missing source from any additional owner backup/snapshot. If unavailable, rebuild against this current repository in small slices.                    | Source stored in Git with a named branch, reviewed diff and explicit scope.                                                                  |
| 2 · done               | Rebuild the selected responsive homepage and catalogue styling using real catalogue/category data. Preserve working search, filters, navigation and availability. | Desktop/mobile review; keyboard navigation and mega-menu/carousel accessibility; relevant existing checks pass.                              |
| 3 · done               | Rebuild product gallery, required shade selection, option changes, cart and checkout review. Keep server-owned prices and versioned quotes.                       | Required-option behavior, quantity/shade changes, subtotal updates and purchase-flow regressions verified.                                   |
| 4 · done locally       | Rebuild Silverback Mall configuration, source and validate the Kigali polygon, and apply the owner-selected starting tariff locally.                              | Versioned settings; city boundary/edge checks; tariff checks at 3, 3.1, 5, 8 and 10 km; old quotes invalid after relevant changes.           |
| 5 · done               | Restore server-only Google adapters and bounded diagnostics. Keep demo/local route tests independent of Google billing.                                           | Mock HTTP coverage for Places and motorcycle routes, unavailable routes, provider errors, outside-city locations and location changes.       |
| 6 · blocked by billing | After the owner restores Google billing, run a bounded live check and then a local checkout check against Google.                                                 | Actual Places results and motorcycle routes from the dispatch point; a clear live-results report without keys or raw customer-location data. |
| 7                      | Review remaining release inputs and hosting checks.                                                                                                               | Fresh build and relevant tests; approved product imagery/content, operating details and delivery evidence; separate release decision.        |

Commit and push each verified slice so future environment reloads do not depend on an uncommitted working tree. Keep all `.env` files, keys, database credentials and private customer data outside Git.

## Validation of the original design-reference checkpoint

Only documentation and reference images are added. Validate PNG decoding, image counts/dimensions, manifest hashes, relative Markdown links, Git whitespace and staged-file secret checks. Application tests should be run when application code is restored or changed; this checkpoint does not rerun historical app suites or claim they passed again.

## Restored delivery evidence

On 16 November 2026 the local preview received settings version 2 with Silverback Mall, the complete Kigali boundary and the agreed starting tariff. The local/test-only command preserves stock location identity, switches and existing order snapshots. Google adapters are mock-tested; default routing remains fake and the motorcycle coverage gate remains false. The zero-request key preflight found the configured keys. No live Google request was made during restoration because billing remains closed. Runbook: [GOOGLE-DELIVERY.md](integrations/GOOGLE-DELIVERY.md).
