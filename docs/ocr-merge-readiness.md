# OCR merge readiness gate

OCR remains isolated on `experiment/ocr-pipeline`. Do not merge the OCR fallback into `main` until every required case below has passed automated tests, desktop review and iPhone review.

## Review order

1. Open the no-quota format fixtures in `/ocr-lab` and verify all five layouts.
2. In every fixture, click a heading, paragraph, checkbox and table row; speech must begin exactly there and continue in document order.
3. Run the official PDF matrix on representative pages with Gemini 3.5 Flash-Lite.
4. Retry only difficult pages with Gemini 3.6 Flash.
5. Record unresolved `[không đọc rõ]`, missing cells or layout warnings. Any unresolved warning blocks merge.

## No-quota format fixture matrix

| Fixture | Required behavior |
| --- | --- |
| Nghị định · phần mở đầu chuẩn | Two-column preamble, one combined title, Điều/Khoản/Điểm hierarchy |
| Thông tư · dòng đầu bị tách | Rejoin split authority, national heading, motto, number and non-Hà-Nội dateline |
| Bảng 6 cột · qua nhiều trang | Preserve six columns, repeated header, split row and checkbox positions |
| Biểu mẫu · trường điền và ô chọn | Preserve dotted fields, notes, checkboxes and two-column model list |
| Đoạn giữa văn bản · không có trang 1 | Never invent a preamble; split Điều headings even without a period |

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

- Recognize authority, national heading, motto, document number, document type and title when page 1 is present.
- Rejoin safe split preamble lines without guessing missing legal text.
- Do not classify a selected middle page as `Phần mở đầu`.
- Detect `Điều 4` and `Điều 4.` consistently while avoiding long inline legal citations.
- Preserve 2–10 physical table columns, including empty cells.
- Repeat or retain the previous table header when a table continues on the next page.
- Join a numbered row cut by a page or OCR-band boundary without duplicating that row.
- Keep `□` and `☑` in their corresponding columns.
- Never invent a missing checkbox or unreadable cell; leave it blank and emit a review notice.
- Merge adjacent OCR bands only when row numbering or headers prove they belong to the same table.
- Do not merge two unrelated numbered tables or tables from non-consecutive selected pages.
- Remove scanner metadata, isolated page numbers, decorative rules, logo tokens and repeated dotted filler.
- Preserve substantive footnotes, legal notes, dotted form fields and signature labels.
- Treat `[không đọc rõ]`, a missing table column, an empty required table body or an incomplete checkbox pair as manual-review conditions.
- A failure on one page must not discard pages already completed.
- Speech queue must start at the selected DOM unit and continue through later text and table rows in source order.

## Speech behavior blockers

- Clicking any visible Điều title, paragraph, list item, checkbox, field or table row starts speech from that exact unit.
- The reader highlights only the active unit, not the entire PDF page.
- Reading continues across page boundaries without announcing or restarting each page in content mode.
- Table content mode reads the meaningful row; verification mode reads every column and says when a cell is blank.
- `Dừng`, `Tiếp tục`, `← Mục`, `Mục →`, voice and speed remain usable on desktop and mobile.
- Keyboard users can start from a unit with Enter or Space.

## Visual blockers

Review on desktop and iPhone:

- Preamble alignment matches the current main reader and never changes main CSS or main data.
- Long document titles occupy one centered title block instead of several unrelated blocks.
- Desktop tables remain inside the document width without starting at a hidden horizontal offset.
- Wide tables may scroll only inside the table on narrow screens; the whole document must not move sideways.
- Continued tables display their header and a visible continuation label.
- Column widths prioritize the long content column while keeping STT and checkbox columns compact.
- No text overlaps borders, headings, audit cards or neighboring rows.
- Search highlighting and speech highlighting can coexist without hiding text.
- Opening a no-quota fixture and opening a real OCR result must produce the same alignment.

## Approval checklist

Before changing the PR from Draft:

- GitHub Actions: unit tests, TypeScript and Next production build all pass.
- All five no-quota fixtures pass desktop and iPhone review.
- Every official PDF row above has been reviewed on its target pages.
- The layout audit contains no unexplained warning.
- The user has approved the final preview link.
- `main` still matches `backup/stable-before-ocr-2026-07-22` for existing reader behavior and stored data.

## Production rollout

1. Keep the existing non-OCR extractor as the first choice.
2. Enable OCR only when the embedded text fails the quality gate.
3. Store OCR output separately with page-level score, notices, model and source URL.
4. Do not publish OCR output containing unresolved review notices as official text.
5. Roll out behind a feature flag, first to preview, then a small production percentage.
6. Retain `backup/stable-before-ocr-2026-07-22` until rollout monitoring and rollback drills pass.
