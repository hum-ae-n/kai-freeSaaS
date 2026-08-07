# Build notes

Narrative records of how this project got built: the conversations, the reasoning
and the decisions behind the code. Kept for posterity, not for operating the site.

Nothing in `docs/` is ever served: `netlify.toml` returns 404 for `/docs/*`, so
these files exist on GitHub only. Do not link them from any page.

## Where each kind of record lives

The project already keeps four separate records, and they answer different
questions. Look here first rather than guessing:

| Question | Where |
|---|---|
| What is the spec, and why does a clause say what it says? | `PRD.md`, `PRD-REGISTER.md` |
| What was built, in what order, and did it pass its gate? | `BUILD-PLAN.md`, per-phase entries with verifier verdicts |
| Where does the build knowingly deviate from the spec, and why? | The changelog table at the foot of `BUILD-PLAN.md` |
| What is still open, and what needs Rocky specifically? | `TODO.md` |
| Exactly what changed in the code? | The commit history, and the pull requests |
| **How did we get here: what was asked, argued, tried and rejected?** | **This folder** |

The changelog table remains the authoritative record of spec deviations. These
notes are the story around it, not a replacement for it.

## Contents

### `2026-08-session-log.md`

The complete conversation for Phases 11 to 17: 22 July to 4 August 2026,
804 turns. Verbatim, in order, from "read todo" to the Phase 17 launch.

Regenerated in place rather than split into a second file, because it is one
continuous session: splitting it would put a phase boundary where the
conversation has none.

It covers, among much else:

- **Phase 11**, the My Stack register: local-first storage, opt-in encryption,
  and the law that no password field may ever exist on that surface.
- **Phase 12**, the Discover deck: the swipe idea, and the question that shaped
  its persistence ("how does the user remember, and what if they revisit?").
- **Phase 14**, the compact landing and the answer-engine layer, including the
  direction that every tool should carry an FAQ question.
- **Phase 15**, the nav, privacy and contact pages, and the CTA rebuild against
  the airl.io reference.
- **Phase 13.1**, payments: hosted links only, the two trust rules, and the
  Stripe integration for Kaipability's own invoicing.
- **Phase 16**, the hero rewrite and the fixed self-compressing top bar, plus
  the removal of the changelog strip to its own page.
- **Phase 17**, the savings figures: the ticker request, the retirement of the
  coffee equivalent, and the decision to stop moving a page budget every time
  it binds.

It is also an honest record of things going wrong and being caught, which is
most of its value. Among them: a coach overlay that silently killed keyboard
access to the deck; a regression check that passed against the very bug it was
written to catch, because a View Transition happened to mask it; an invoice
that finalised at £150 instead of £7,650 because `curl -d` does not URL-encode a
percent sign; and a test that claimed to pin a live payment URL and did not,
proven by mutation after the claim had already been written into a commit
message.

Phase 17 turned that into a named pattern rather than a run of bad luck.
Seven separate checks were found to be green while proving nothing: a contrast
check reading the hidden accessibility sentence instead of the visible text; a
regex containing literal backspace characters, so it hunted control codes and
could never match; a figure-overhang check that sampled a count-up mid-flight
and so measured a shorter string than the one that actually overflowed; and a
static crawler block that advertised coffees for a phase after the page had
dropped them, because the check meant to catch that was specified and never
written. The structural answers adopted are worth more than the fixes: assert
outcomes rather than mechanisms, record events rather than sampling computed
style, prove every new check bites by mutating the code it guards, and prefer
a shared definition over a test wherever drift is possible.

**What has been stripped.** User and assistant prose only. Tool calls, command
output, file diffs and subagent transcripts are removed: the raw session file is
roughly 28MB and the reasoning, not the mechanics, is what is worth keeping.
Harness noise is dropped too, so a reply occasionally answers something not
shown.

**What has been redacted.** Every key-shaped string. The raw transcript contained
a live Stripe secret key, which is precisely why the raw file is not committed
and why the extractor redacts before writing rather than after.

## Adding another log

Regenerate from a session transcript with the extractor kept alongside this file:

```bash
python3 docs/build-notes/extract-log.py <session>.jsonl docs/build-notes/<date>-session-log.md
```

Then check the result before committing, every time:

```bash
grep -nE 'sk_(test|live)_|pk_(test|live)_|whsec_|gh[pousr]_' docs/build-notes/<file>.md
```

That must return nothing. A transcript is raw material, and raw material is
where credentials hide.
