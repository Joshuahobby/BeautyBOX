# Kigali delivery and Google integration

Rebuilt on 16 November 2026. Code and mock tests are available; live Google routing remains unverified. The owner's latest Google screenshot shows the linked billing account closed with a disabled Reopen action. Do not spend requests repeating the unchanged failure. No hosted settings were changed by this rebuild.

## Selected operational configuration

- Dispatch: owner-confirmed Silverback Mall, KK 15 Road, Kicukiro. Database pin: `-1.968846, 30.102513`. Check the physical pickup entrance with a rider later.
- Eligibility: the complete City of Kigali boundary, OpenStreetMap relation [1708283](https://www.openstreetmap.org/relation/1708283), retrieved 16 November 2026. All 1,749 distinct vertices are retained; GeoJSON uses longitude then latitude. Boundary edges and vertices are included. Rural/eastern city locations are supported by eligibility; a usable road route is still required.
- Tariff: RWF 1,500 for the first 3,000 road metres, plus RWF 250 per additional kilometre; round the final fee up to RWF 100. Examples: 3 km 1,500; 3.1 km 1,600; 5 km 2,000; 8 km 2,800; 10 km 3,300; 20 km 5,800; 32 km 8,800.
- A 100 km routed-distance anomaly guard is separate from the city polygon. It does not imply nationwide service or cap the fare. Nationwide delivery remains a future courier service.
- These are owner-authorized starting prices, to be revised against actual expenses; they are not a claimed current courier quote or a guaranteed delivery time.

Source: [kigali-city.geojson.json](../../src/config/delivery/kigali-city.geojson.json), with provenance and raw-response hash. © OpenStreetMap contributors; [ODbL 1.0](https://www.openstreetmap.org/copyright). No rectangle or simplified boundary is substituted.

## Local configuration

Fresh demo seeds use the selected Kigali configuration. Generic domain-test fixtures retain the historical synthetic origin, coverage and RWF 300/km tariff, so older FSD scenarios remain meaningful.

For an existing local database:

```sh
npm run delivery:configure-kigali -- --config-file=.env.local
# Read the returned current version, then use it explicitly:
npm run delivery:configure-kigali -- --config-file=.env.local --apply --expected-version=1
```

The command refuses non-loopback databases, APP_ENV outside local/test and database profiles outside LOCAL/TEST. It defaults to read-only. Apply serializes with the settings editor, requires the expected version and creates immutable tariff/settings versions. The inventory location keeps its ID; origin changes increment its version. Existing quotes become invalid at payment validation, while placed orders retain their fee snapshots. Repeating an unchanged configuration is a no-op. Checkout/payment/SMS switches, contacts, operating hours, parcel rules and policy approvals are preserved. New operational records remain PROPOSED; this command cannot approve a launch.

The admin settings route accepts up to 128 KiB after ADMIN authentication so the complete boundary fits. Other JSON operations keep their 16 KiB default limit. Internal polygons allow at most 2,048 vertices.

## Keys and service selection

`GOOGLE_ROUTES_API_KEY` is server-only, restricted to Routes API; it may also allow Places API (New). Set a separate server-only `GOOGLE_PLACES_API_KEY` if Places uses a different key. Never put either under NEXT_PUBLIC_. Do not print keys or include them in Git.

`NEXT_PUBLIC_GOOGLE_MAPS_EMBED_KEY` is a separate, browser-restricted Embed key. The optional street-map iframe loads only after the customer selects Show street map and a valid pin exists. It does not require or expose the server key. Panning the preview does not change the delivery pin; accessible manual coordinate entry and nudging remain available. Without the browser key, checkout still works through search/GPS/manual coordinates. The coordinate schematic is labelled as a preview, not a street map. Live Embed rendering and key/referrer restrictions still need account-side verification; automated tests fulfill the iframe with a local mock and make no Google request.

The app selects the adapter with `ROUTING_PROVIDER=google`. `GOOGLE_TWO_WHEELER_COVERAGE_APPROVED=false` is the default and blocks route requests until evidence is reviewed. Production publication blocks retain ROUTING_ADAPTER_NOT_LIVE while that evidence gate is false. No request parameter can choose the provider or approve coverage. Local previews continue using fake routing/payment/SMS. Hosted staging remains on its existing sandbox/disabled configuration.

Google Places API (New) receives bounded Rwanda autocomplete queries with a bias around Silverback Mall; the server resolves the selected place. Autocomplete and place resolution share a guest request budget. The browser confirms the exact destination before quoting; a late Places/GPS response cannot overwrite a later pin adjustment. Official Google Maps attribution accompanies Google suggestions. Routes requests use TWO_WHEELER, TRAFFIC_UNAWARE, metric units and no alternatives. One request, eight-second timeout, no redirects/retries, no-store, and a 256 KiB response cap apply. Invalid data, denial, outage or no motorcycle route never falls back to driving or straight-line fees. Google road distances and response bodies are not persisted in quote records. Approved fee/quote snapshots and customer-confirmed locations remain part of normal commerce records.

## Resume live checks after billing is active

1. Reopen/fix the **already linked** billing account through Payment method/Payment settings, using its administrator or Google Billing Support if Reopen stays disabled. The screenshot alone does not establish the signed-in user's administrator role or the reason for closure. No replacement project/key is required solely because billing is closed.
2. Confirm Routes API and Places API (New) are enabled and the server key's API restrictions permit them. Keep the separate browser key restricted to the website and Embed API.
3. Run the zero-request preflight. It prints presence booleans only:

```sh
npm run delivery:check-google
```

4. Start with one explicit public-landmark check, then the bounded city sample:

```sh
npm run delivery:check-google -- --live --billing-active --cases=1
npm run delivery:check-google -- --live --billing-active --cases=12 --output=/tmp/beautybox-google-results.json
```

In this managed cloud shell, preserve its supplied proxy/CA configuration; Node's native fetch may require `NODE_USE_ENV_PROXY=1`. Never disable TLS verification. `--config-file=.env.local` is optional for local key loading; environment secrets also work. No keys need to be pasted into chat.

The runner uses only public landmark cases, at most three requests each and **36 requests maximum** for the full sample. It stops at the first provider failure and never retries automatically. Outside-city rejection is tested locally without a Google call. Reports contain case IDs, outcomes and computed RWF fees, not raw coordinates, road distances, keys or provider error bodies. The first suggestion is used, so destination identity and the dispatch entrance need independent review; a green smoke check alone is not release approval. The runner never writes database settings, changes gates, sends payments/SMS or publishes anything.

5. Review actual motorcycle coverage, missing routes and expected fees. If approved, explicitly configure the evidence gate and rehearse checkout with real routing but fake/local payment. Confirm location changes invalidate the old quote and outage/no-route states keep payment unavailable. Review remaining release inputs separately before any hosted change or launch.

## Fresh local verification

See [TEST-EVIDENCE.md](../TEST-EVIDENCE.md) and the delivery test files. Unit tests cover complete geometry/edges, agreed tariff arithmetic, provider request modes/errors/response bounds, Places resolution and diagnostic budgets. Real PostgreSQL integration tests cover versioned local configuration, stock-location identity, concurrency, stale quotes, placed-order snapshots, full admin polygon payloads, mocked Google road fees, location changes and provider failures. Browser tests use fake providers and exercise the deployed UI behavior; none is live Google evidence.
