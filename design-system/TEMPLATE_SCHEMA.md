# Kaipability template schema

**Version:** 1.0
**Status:** Live. First conforming template is `templates/Engagement Quote.html`.
**Machine copy:** `template-schema.json` in this folder. Keep both in sync.
**Purpose:** Defines the structural contract every Kaipability document template must speak, so one Template Designer generation (background, margins, corner graphic, page numbering, logo) applies to any conforming template, not just the one it happened to be built against.

See `../docs/proposals/TEMPLATE_DESIGNER_PRD.md`, section 6, for why this exists.

---

## The two tag types

- **`data-kai-region`** marks a structural area of the page. Regions are what design tokens (background, margins) apply to.
- **`data-kai-slot`** marks one specific point inside a region where a particular asset or value is inserted.

Both are plain HTML data-attributes. Not literal XML namespaces. See the PRD section 6 for why, HTML5 does not support arbitrary custom namespaces the way XHTML did, and these templates need to stay renderable HTML for the browser and for the Playwright PDF export. The `data-kai-` prefix exists so these attributes never collide with anything else on the page, present or future.

## Schema version declaration

Every conforming template declares which schema version it was authored against, once, on the root `<html>` element:

```html
<html lang="en" data-kai-schema-version="1.0">
```

A template on an older schema version keeps working under that version's rules until deliberately migrated. Never assume a template conforms to the latest schema just because it is in the repo, check the declared version.

## Region vocabulary (v1.0)

| Region | Cardinality | Applies | Notes |
|---|---|---|---|
| `page` | Required, repeatable | One instance per physical page | The printed page itself. Background and margin tokens apply here. |
| `header` | Required, exactly one per `page` | Nested inside `page` | Holds the logo and the per-page meta line (date, ref, or section label). |
| `footer` | Required, exactly one per `page` | Nested inside `page` | Holds the legal line and pagination. |

There is deliberately no generic `body` region in v1.0. The content between header and footer is document-type-specific (a letter opening, a quotation table, a SMART deliverables table) and is addressed by `data-field` on the individual content elements, per the existing content-tagging convention in `_quote.js`, not by a single catch-all region. If a future document type needs a structural wrapper around its main content for token purposes, propose it through the governance process below rather than inventing it ad hoc.

## Slot vocabulary (v1.0)

| Slot | Lives in | Cardinality | Notes |
|---|---|---|---|
| `logo` | `header` | Required, exactly one | The brand mark image. |
| `pagination` | `footer` | Required, exactly one | The page-number readout. Format (none / "N" / "Page N" / "Page N of M") is a Template Designer control, not fixed by the schema. |
| `legal-line` | `footer` | Required, exactly one | The copyright and company-number line. |
| `corner-decoration` | `page` | Optional, zero or one | The decorative corner graphic. Optional because no asset has been supplied to the design system yet, see `design-system/README.md` caveats and the 20 July 2026 letterhead review. A template with this slot absent is still valid. A template with this slot present but pointing at a missing asset is not. |

## Example

Taken from the migrated `Engagement Quote.html` header, unchanged visually, the existing CSS classes stay exactly as they were:

```html
<div class="page__header" data-kai-region="header">
  <img data-kai-slot="logo" src="../assets/kaipability-logo-lockup.png" alt="Kaipability">
  <div class="meta">
    <b data-edit data-field="date">25 May 2026</b>
    <span data-edit data-field="ref">Ref: QUOTE-2026-0142</span>
  </div>
</div>
```

Note the difference from `data-edit` / `data-field`. Those tag *content* (what value goes here, editable, persisted per document). `data-kai-region` / `data-kai-slot` tag *structure* (what kind of thing this is, for tooling that operates across every document type at once). A single element can carry both when it is both a slot and an editable field, they answer different questions.

## Governance

Adding a new region or slot name is a deliberate, logged decision, not something invented inside a single template file while building it. Mirrors the 3-strikes mechanic already established in `../docs/architecture/ARCHITECTURE_DECISIONS_v2.md` §4.18 for module and rule drift.

1. Bump the version (a new region/slot is a minor version, `1.1`, a breaking change to an existing region/slot's meaning is a major version, `2.0`).
2. Update this file and `template-schema.json` together.
3. Log the addition and why in `CHANGELOG.md`.
4. Re-run the Structure Validator (`automation/validate-template-structure.js`) against every template in the repo, since a version bump can invalidate templates that declared an older version if the change is breaking.

## Validation

Enforced by `automation/validate-template-structure.js`. Checks, per template:

- Every required region present at the correct cardinality.
- Every required slot present inside its correct parent region.
- No `data-kai-region` or `data-kai-slot` value that is not defined in this schema (catches typos and drift before they ship, the same class of error that let the design system's background-colour default go unchecked against a real reference document).
- The declared `data-kai-schema-version` exists and is recognised.

Run it directly with `node automation/validate-template-structure.js`, or against a single file with `node automation/validate-template-structure.js path/to/template.html`.
