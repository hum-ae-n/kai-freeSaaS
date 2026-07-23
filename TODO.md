# TODO

Open items as of 22 July 2026. Build state: Phases 0-4 done and verified, Phase 5 done except 5.6, Phase 6 blocked on the items below. Detail in [BUILD-PLAN.md](BUILD-PLAN.md); run `node scripts/validate-data.mjs` and `node scripts/smoke-test.mjs` before any push (a push to `main` is a production release once Netlify is connected).

## Deploy (Phase 6)

- [x] Connect this repo to Netlify, confirm auto-deploy on push to `main`
  - 22 Jul: project **kai-freestack** created on team `mrv`, site id `3bbf5cb0-fbf6-4ccc-b07a-b377af02b444`. 23 Jul: Rocky linked `hum-ae-n/kai-freeSaaS` via GitHub OAuth; live at `https://kai-freestack.netlify.app` (200, `tools.json` serving). Status badge added to README.
  - Note: curator mode (including the internal `when` column) is now publicly reachable at that URL. The public-curator decision below is now live, not theoretical.
- [ ] Custom domain: **tools.airl.io** (decided 22 Jul, replaces the `freestack.kaipability.com` example). Do after the repo link: Domain management > add custom domain > CNAME to `kai-freestack.netlify.app`.
- [ ] Full Definition of Done pass (PRD §14, all 10 items) against the live URL, not localhost
  - Pre-deploy gates green 22 Jul in this environment: `validate-data.mjs` exit 0 (85 tools, 15/50/7/13 split), `smoke-test.mjs` 15/15 PASS.

## Decisions only Rocky can make

- [ ] **Public curator mode.** The bare URL serves the full curator interface, including the internal `when` column (consulting guidance) and value calibrations. Decide before sharing any client link: acceptable public, hide the column, or add the token auth deferred in PRD §13. Blocks Phase 6 sign-off.
- [ ] **Value figure spot-check (Phase 1.5).** The validator can't judge honesty (PRD §10). Review the `value` field across `data/tools.json`; flag anything indefensible.
- [ ] **Favicon self-hosting (Phase 5.6).** Client pages currently hit DuckDuckGo/Google proxies per link. Decide whether to inline/self-host icons for the 15 core tools (privacy + reliability) or accept the proxies.

## Nice-to-have / flagged

- [ ] Replace the Lucide-via-CDN icon substitution if a preferred icon system exists (design-system brief caveat; not currently used by Free Stack itself)
- [ ] Confirm whether a licensed Proxima Nova webfont should be loaded for the wordmark (falls back to Mona Sans/Montserrat today)
- [ ] Post-v1 ideas parked in PRD §13 (analytics, PDF export, embed mode, freshness tracking)
