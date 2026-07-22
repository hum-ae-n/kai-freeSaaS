# Design System

Layer 2 of the architecture: brand, fonts, colours, components, page layout. The authoritative source lives here in git per `../docs/architecture/ARCHITECTURE_DECISIONS_v2.md` §16.

Edited primarily in Claude Design (Anthropic's design tool). Outputs are exported here and become the canonical source. Claude Design is a design-time editor, not a runtime dependency.

## Files (populated as Claude Design exports arrive)

- `colors_and_type.css` — design tokens, exported from Claude Design
- `components.css` — buttons, tables, cards, exported from Claude Design
- `SKILL.md` — exported from Claude Design (teaches Claude how to use the system)
- `fonts/` — font files
- `assets/` — logo and brand marks
- `ui-kits/` — additional UI kits from Claude Design
- `visual-templates/` — Claude Design's static HTML templates (styling reference only)
- `preview/` — Claude Design preview captures

## How to update (verified 25 May 2026 against current Claude Design docs)

The mechanism is the **Claude Code handoff bundle**, not the standalone export menu. The standalone exports (PDF, PPTX, URL, Canva) are for finished deliverables. The handoff bundle is what carries the structured design-system source files.

Five-step flow:

1. **Open the relevant Claude Design project.** One project per sub-brand (Kaipability Advisory, Learning, Research, Studio). Make sure the brand's design system is published at the organisation level so the project inherits it.
2. **Make your changes** in Claude Design via GUI or chatbot. Iterate.
3. **Trigger the Claude Code handoff** from the export menu. Claude packages design intent, CSS, components, fonts, assets, and SKILL.md into a bundle.
4. **Pick up the bundle in Claude Code** with the single instruction Claude Design provides (per [TechCrunch coverage of the launch](https://techcrunch.com/2026/04/17/anthropic-launches-claude-design-a-new-product-for-creating-quick-visuals/), the bundle is designed for a coding agent to consume with one instruction).
5. **Verify and commit.** Claude Code unpacks the bundle into the brand's folder. Review the diff. Commit with a message describing what changed.

After commit, the portal (Phase 2) and Apps Script bundler (Phase 5) pick up the new design system on the next deploy.

**Two cautions**, verified against [DataCamp's 2026 guide](https://www.datacamp.com/blog/claude-design):

- Without a published design system, Claude Design produces "functional but generic" output. Always upload the brand kit first and publish before creating project deliverables.
- Allowances reset weekly per user. Large redesigns may need pacing.

## Naming distinction

`design-system/visual-templates/` = Claude Design's static HTML shells (styling reference).
`compositions/` (sibling folder) = our YAML composition recipes (the actual engine).

These are different mechanisms per `../docs/architecture/ARCHITECTURE_DECISIONS_v2.md` §16.5.

## What is NOT here

- The composition engine (in `compositions/` and `google-apps-script/`)
- Module content (in `modules/`)
- A database, auth, ref-number generation (all in `google-apps-script/` plus Sheets)

## Multi-brand future

Today this folder holds a single brand's design system (Kaipability Advisory). Sub-brands (e.g. Kaipability Learning, Research, Studio) will live as sub-folders here when they exist:

```
design-system/
  kaipability-advisory/         (today's content moves here when a second brand lands)
    colors_and_type.css
    components.css
    fonts/
    assets/
    ...
  kaipability-learning/
    colors_and_type.css
    ...
```

The brand-to-folder mapping lives in `Settings.brands` (L4 Sheets). The Composer agent reads `Settings.brands[<brand>].design_system_path` at composition time to pick the right CSS and assets. Per §4.19 admin agility, adding a brand is a Settings edit plus folder creation, not a code change.

Until a second brand exists, the current flat layout is fine. Restructure on demand.
