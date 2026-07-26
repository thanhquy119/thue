# Search Grounding rollout

Search Grounding is integrated as an optional official-source discovery layer. It never answers tax questions directly from Google Search.

## Safe behavior

- `off`: no provider request. This is the default until the live smoke passes with the production API key.
- `auto`: call Grounding only for high-risk or deep-evidence questions when direct official discovery is weak.
- `always`: diagnostics and live smoke only.

Grounded URLs must resolve to the government allowlist. The application still downloads, extracts and validates the full official document before it can be used as legal evidence.

## Activation gate

Run a deployment whose commit message contains `[live-grounding]`. `tests/live-search-grounding-smoke.ts` probes both `generateContent` and Interactions API transports, checks each configured model, and requires official URLs for a high-risk question and a deep appendix/form question.

Only after this test passes should `SEARCH_GROUNDING_MODE=auto` be set for Preview, then Production.

## Current provider finding — 2026-07-26

The Vercel `GEMINI_API_KEY` received HTTP 429 from both transports for:

- `gemini-2.5-pro`
- `gemini-3.5-flash-lite`
- `gemini-3.5-flash`

The code therefore remains fail-closed with Grounding off. Replace the key with one belonging to the Google project that has active Search Grounding quota or enable billing/quota on the key's project, then rerun the live smoke.
