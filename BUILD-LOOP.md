# Build Loop

How `free-stack` gets built: a bounded, resumable loop that turns `BUILD-PLAN.md` into a deployed site. Any session can pick this up cold by reading the state and running one iteration.

## State

`BUILD-PLAN.md` checkboxes are the single source of truth for progress. There is no separate state file to drift out of sync. `[ ]` not started, `[~]` in progress, `[x]` done and verified by the verifier agent.

"Done" always means verified, never means written. A task whose code exists but has not passed the verifier stays `[~]`.

## Starting the loop

```
/loop Run one iteration of BUILD-LOOP.md against BUILD-PLAN.md.
```

No interval. This is task paced, not time paced, so let it self pace: each iteration ends when its work is verified and pushed, and the next begins immediately. Time based polling would just wake into an unchanged repo.

To run a single iteration by hand, without the loop, just say: `Run one iteration of BUILD-LOOP.md`.

## One iteration

### 1. Orient

```bash
git fetch origin && git status --short && git log --oneline -3
node scripts/validate-data.mjs --summary
```

Read `BUILD-PLAN.md`. Note which phases are `[x]`, which are `[~]`, and the current validator error count. If the working tree is dirty from a previous interrupted iteration, reconcile that before starting new work.

### 2. Select

Pick the next unblocked tasks from the dependency graph in `BUILD-PLAN.md`. A task is unblocked when every phase it depends on is `[x]`.

Dispatch in parallel only when file ownership does not overlap:

| Can run concurrently | Why |
|----------------------|-----|
| Phase 1 with any of Phases 2 to 5 | data-steward touches only `data/tools.json`, builder touches only code |
| Phase 3 with Phase 4 | separate JS files and separate CSS blocks, once Phase 2 froze the DOM contract |

Never run two builder tasks that touch the same file. Phase 2 must be `[x]` before 3 or 4 start, because it defines the DOM contract they both build against.

Prefer finishing an in progress phase over starting a new one. Do not open more than two concurrent agents: this is a small codebase and merge friction costs more than the parallelism buys.

### 3. Dispatch

Mark the tasks `[~]` in `BUILD-PLAN.md` before dispatching, so an interrupted iteration is recoverable.

| Work | Agent |
|------|-------|
| `data/tools.json` | **data-steward** |
| HTML, CSS, JS | **builder** |
| `README.md`, copy, house style | **content-editor** |
| Phase sign off, pre deploy check | **verifier** |
| PRD amendments, git, Netlify, spec decisions | main thread, not delegated |

Give the agent the specific numbered tasks and the PRD sections they come from, not a whole phase in the abstract. Agents cannot see this conversation, so restate what they need.

### 4. Verify

Run the **verifier** on the completed work. It is read only by design: it reports, it does not fix. Its verdict decides the checkbox.

- **Pass:** mark `[x]`.
- **Fail:** leave `[~]`, feed the findings back to the owning agent, and iterate. After **three** failed attempts on the same task, stop the loop and escalate to the user. Do not keep retrying a task that is not converging, it usually means the spec is wrong rather than the code.

For any phase touching `data/tools.json`, `node scripts/validate-data.mjs` must exit 0 before the phase can be marked `[x]`.

### 5. Commit and push

One commit per completed task or coherent batch. Reference the phase:

```
Phase 3.6: curator tools table, nine columns per PRD section 6
```

Push to `main`. **Netlify auto deploys every push, so a push is a production release.** Never push with the validator failing, and never push code that has not passed the verifier.

### 6. Update and decide

Update the `BUILD-PLAN.md` checkboxes and commit that too. Then choose:

- Unblocked work remains: start the next iteration.
- Everything blocked on a human decision: stop, report, do not guess.
- All phases `[x]` and the Definition of Done is 10 for 10 on the deployed URL: stop, the build is complete.

## Stop conditions

Stop the loop and report rather than continuing when any of these hold:

1. All six phases are `[x]` and PRD section 14 passes 10 for 10 against the live Netlify URL.
2. The same task has failed verification three times.
3. Work is blocked on one of the open spec questions in `BUILD-PLAN.md`, which need Rocky's decision, not a guess. The public curator mode question in particular blocks Phase 6, because it decides whether internal consulting guidance in the `when` column ships publicly.
4. A change would deviate from the PRD in a way not already recorded in the changelog. Record it and get agreement first.
5. The validator regresses. A rising error count means an agent is going backwards.

## What the loop deliberately does not do

- **It does not decide spec questions.** The four open questions in `BUILD-PLAN.md` are judgement calls about a real consulting business and they belong to Rocky.
- **It does not judge value figures.** PRD section 10 sets an honesty standard that no automated check can enforce, and no agent can know what a comparable CRM costs. Phase 1.5 is a human review step.
- **It does not verify layout by eye.** No agent here drives a real browser, so responsive rendering, computed contrast and touch target size get marked NOT TESTABLE and handed to a human. Treat a clean verifier report as necessary, not sufficient, before showing the site to a client.
