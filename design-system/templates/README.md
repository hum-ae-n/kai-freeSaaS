# Kaipability — Templates

Editable HTML quote templates. Open in a browser, click any field to edit, then
**Print / Save PDF** from the toolbar (or browser print). Field edits persist
in local storage, so closing the tab does not lose your draft. Use **Reset**
to return to the template defaults.

## What is here

| File | Format | Pages | Built from |
|---|---|---|---|
| `Engagement Quote.html` | Full engagement quotation | 6 (A4) | Recreation of the Word `Quote template.dotx` — letter + WBS + quotation table + milestones + SMART appendix |

The HTML preserves the structure, voice, and section flow of the original Word
template:

1. **Letter opening** — letterhead, recipient block, subject line,
   introduction, strategic-positioning paragraph, credibility paragraph,
   **Current State** with key questions.
2. **Future State + Proposed Approach** — outcomes list, three-gate phase
   block.
3. **Work Breakdown Structure** — duration, resource commitment, D1–D8
   deliverables, key outcomes, scope-management paragraph, call to action,
   **Next Steps**, signed sign-off as Dr. Mayank (Rocky) Verma.
4. **Quotation table** — three service offerings (hourly / daily / packaged),
   notes, total, payment-terms milestone breakdown (first two milestones).
5. **Payment terms continued + Appendix · Notes & Clarifications** —
   remaining milestones, two-column notes block (~20 standard clarifications).
6. **Appendix · SMART Deliverables** — D1–D8 with Specific / Measurable /
   Achievable / Relevant / Time-bound columns.

## Editing

- **Bracketed placeholders** like `[Client]`, `[Phase Name]`, `[Rate]` show
  exactly where to type. They render italic-grey when emptied.
- Hover any text — if it lights up with a soft oxblood wash, it is editable.
- The toolbar is only visible on screen. Print previews and PDFs are clean.

## Print

- Sized for **A4** (210 × 297 mm).
- The `@page` rule sets zero margin so the template's own 22 mm margins are
  the only ones used. In your browser's print dialog, keep *Margins:* set to
  **Default** or **None**, and turn **Background graphics** on so the oxblood
  rules and tinted blocks come through.

## Heading colour

The Word template uses Accent 1 shaded to ~75 % = `#7D0C02`. We use that
exact value for all headings in this template (exposed as
`--quote-oxblood`). It is a fraction darker than the brand `--oxblood`
(`#A40000`) used elsewhere — print-friendlier and a closer match to the
Word output.

## Caveats

- **Signature font (Caveat)** is loaded from Google Fonts as a placeholder
  handwritten signature. Replace the `[signature]` line with a transparent
  PNG of a real signed name if you prefer.
- **Reference numbers** appear in the meta block and in every page's folio.
  They are linked through `data-field` keys but **not** auto-synced — change
  each instance, or extend `_quote.js` to broadcast the value.
- **Fee numbers, durations, and milestone percentages** are illustrative.
- **No appendix images** (e.g. CV, prior-work samples) are included. Add
  pages following the same `.page` pattern if you need them.
