# OCR merge readiness gate

OCR remains isolated on `experiment/ocr-pipeline`. Do not merge the OCR fallback into `main` until every required case below has passed both automated and visual review.

## Required official PDF matrix

| Document | Target pages | Main risks |
| --- | --- | --- |
| 273/2026/NĐ-CP | 12–14 | six-column checkbox table, table continued across pages, split OCR bands |
| 11/2026/TT-BKHCN | 4, 6, 9, 12, 13 | forms, dotted fields, five-column tables, stamps |
| 237/2026/NĐ-CP | 1, 37, 38 | standard preamble and final appendices |
| 197/2026/NĐ-CP | 1, 18, 19 | signed administrative layout and signature page |
| 68/2026/TT-BTC | 1, 11, 12 | dense legal citations and final provisions |
| 11/2026/QĐ-TTg | 1, 13, 14 | national data lists and final tables |
| 63/2026/NĐ-CP | 1, 14, 15 | source URL without the `.signed` suffix |

## Automated blockers

All items are merge blockers:

- Preserve 2–10 physical table columns, including empty cells.
- Repeat a previous table header when a table continues on the next page.
- Join a sentence cut by a page or OCR-band boundary into the correct table cell.
- Keep `□` and `☑` in their corresponding columns.
- Never invent a missing checkbox or unreadable cell; leave it blank and emit a review notice.
- Merge adjacent OCR bands only when row numbering or headers prove they belong to the same table.
- Do not merge two unrelated numbered tables separated by a heading.
- Remove scanner metadata, isolated page numbers, decorative rules, logo tokens and repeated dotted filler.
- Preserve substantive footnotes, legal notes, dotted form fields and signature labels.
- Treat `[không đọc rõ]`, a missing table column, or an incomplete required checkbox pair as manual-review conditions.
- A failure on one page must not discard pages already completed.

## Visual blockers

Review on desktop and iPhone:

- Desktop tables fit inside the simulated paper without starting at a hidden horizontal offset.
- Wide tables may scroll only inside the table on narrow screens; the whole document must not move sideways.
- Continued tables display their header and a visible continuation label.
- Column widths prioritize the long content column while keeping STT and checkbox columns compact.
- No text overlaps borders, headings or neighboring rows.
- Opening a saved document and opening a newly fetched document must produce the same alignment.

## Production rollout

1. Keep the existing non-OCR extractor as the first choice.
2. Enable OCR only when the embedded text fails the quality gate.
3. Store OCR output separately with page-level score, notices, model and source URL.
4. Do not publish OCR output containing unresolved review notices as official text.
5. Roll out behind a feature flag, first to preview, then a small production percentage.
6. Retain `backup/stable-before-ocr-2026-07-22` until the rollout has passed monitoring and rollback drills.
