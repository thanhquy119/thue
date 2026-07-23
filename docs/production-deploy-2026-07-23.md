# Production deployment note — 2026-07-23

This commit triggers a clean production deployment from the latest `main` after the Vercel deployment-rate limit reset.

Expected build state:

- OCR production fixture uses representative complete legal pages.
- Official-source policy accepts the Government PDF for 291/2026/NĐ-CP.
- LuatVietnam remains outside the authoritative full-text allowlist.
- OCR stays the final fallback after HTML, DOCX, DOC and usable PDF text.
