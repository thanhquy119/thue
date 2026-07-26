# Search Grounding rollout

Search Grounding is integrated as an optional official-source discovery layer. It never answers tax questions directly from Google Search.

## Safe behavior

- `off`: no provider request. This is the default until the live smoke passes with the production API key.
- `auto`: call Grounding only for high-risk or deep-evidence questions when direct official discovery is weak.
- `always`: diagnostics and live smoke only.

Grounded URLs must resolve to the government allowlist. The application still downloads, extracts and validates the full official document before it can be used as legal evidence.

## Model priority

`gemini-2.5-flash` is the preferred model because Google documents it as supporting Search grounding and it is the best price-performance option for low-latency, high-volume work. Fallback models are tried only when the preferred endpoint is unavailable.

## Activation gate

Run a deployment whose commit message contains `[live-grounding]`. `tests/live-search-grounding-smoke.ts` probes both `generateContent` and Interactions API transports, checks each configured model, and requires official URLs for a high-risk question and a deep appendix/form question.

Only after this test passes should `SEARCH_GROUNDING_MODE=auto` be set for Preview, then Production.

## Current provider finding — 2026-07-26

The Vercel `GEMINI_API_KEY` did not have usable Search Grounding access during live verification. The project observed a model-specific 404 on an earlier `gemini-2.5-flash` attempt, followed by HTTP 429 quota responses across both transports for the configured candidates. This does not mean Gemini 2.5 Flash lacks Search grounding; it indicates that the API key/project used by Vercel needs its access and quota verified.

The code therefore remains fail-closed with Grounding off. Verify that the Vercel key belongs to the Google project showing active Search Grounding quota or enable billing/quota on that project, then rerun the live smoke.
