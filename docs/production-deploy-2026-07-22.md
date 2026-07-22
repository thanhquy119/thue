# Production deployment note — 2026-07-22

This commit triggers a clean production deployment after fixing OCR module resolution and the merged OCR regression fixtures.

Source policy remains unchanged:

- Official Government HTML, DOCX, DOC and usable PDF text are preferred.
- OCR is only the final fallback for an official PDF without usable text.
- Commercial legal databases are not accepted as the authoritative full-text source.
