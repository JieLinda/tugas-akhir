# Agent Studio (`/studio`) — parked on a branch

`/studio` was a throwaway prototype. It is **deleted from `main`** and preserved
on the branch **`parked/agent-studio`** (pushed to `origin`).

```bash
git show parked/agent-studio:lib/agent/plan/planner.ts   # read one file
git checkout parked/agent-studio                          # get the whole module back
```

That branch holds the module in its *parked* state — every file annotated with a
header explaining what it was — branched from `main` immediately before the
deletion, so it is a complete working tree, not a patch. The design docs
[`docs/agent-studio.md`](agent-studio.md) and
[`docs/agent-studio-fase0.md`](agent-studio-fase0.md) stay on `main`.

Same treatment as [`docs/talent-5box-parked.md`](talent-5box-parked.md), for
different reasons — see below.

## What it was

One natural-language command from a user ("scoring run untuk posisi A dengan
menonjolkan aspek penilaian kinerja") turned into a work plan, validated, run
across Pulse's features, and returned as an answer plus buttons to the result
page. Concretely: a planner, a plan validator, an executor with its own guard
runtime, a ~40-tool registry split into pure manifests and DB-touching handlers, a
config-proposal flow with rollback, memories, recipes, a retrieval corpus over
`docs/*.md`, and a 20-case golden eval harness.

**It was never doing anything on a schedule.** No cron, no API route, no worker:
it ran entirely through server actions invoked from its own page, and
`lib/agent-actions.ts` was imported only by that page and `components/studio/*`.
That is the substantive difference from `/talent` — deleting the route was enough
to make the whole module inert, and nothing else had to be switched off first.

## What was deleted from `main`

| Path | What |
|---|---|
| `app/(dashboard)/studio/` | the route — the module's only entry point |
| `components/studio/` | composer, run view, sidebar, proposals/memories/recipes dialogs (10 files) |
| `lib/agent-actions.ts` | every studio server action |
| `lib/agent/` | planner, validator, executor, guard, registry, present, state, config, knowledge, `links.ts`, `llm.ts`, `optimize/ahp.ts` — **minus the three files named below** |
| `scripts/agent-eval/` | the 20-case golden harness (never wired into `package.json`) |
| `scripts/agent-registry-audit.ts` | the registry-coverage audit — it read every `export async function …Action` and demanded each be either wrapped by a manifest or listed in `UNREGISTERED` with a written reason. Hand-invoked, never wired into `package.json` |

Plus the nav entry in `components/sidebar-nav.tsx` and the two `lucide-react`
icons it owned.

## What survived on `main`, and why

- **`lib/job-family/optimize/{diagnose,space,objective}.ts` — moved, not
  deleted.** These were at `lib/agent/optimize/` because the optimizer reasoning
  was first written as agent tooling, but they are the single implementation
  behind the **live** Job Family → Pengaturan optimizer panel:
  `components/job-family/optimizer-panel.tsx` →
  `lib/job-family-optimize-actions.ts` → these three. That panel uses no LLM and
  never went through the planner, so it was never downstream of the studio.
  `lib/job-family-topics-actions.ts` also reads `diagnose.ts`. They now sit beside
  `lib/job-family/config.ts`, which they already imported.

  Note that **`lib/agent/optimize/ahp.ts` was NOT in that set** — only
  `registry/handlers/optimize.ts` reached it, so it went with the branch. The four
  files in that directory were not interchangeable, and assuming they were is the
  easy way to either break the panel or resurrect dead code.
- **The four `job_family.*` registry tools** (`read_config`,
  `diagnose_clustering`, `explain_outliers`, `apply_config`) went with the branch,
  and that costs nothing: they existed to keep the capability available *inside*
  Agent Studio and wrapped `lib/job-family-optimize-actions.ts` rather than
  computing anything themselves. The panel is the primary surface and calls that
  module directly.
- **The six `agent_*` tables and their Drizzle definitions**
  (`agent_sessions`, `agent_runs`, `agent_run_steps`, `agent_config_proposals`,
  `agent_memories`, `agent_recipes`; `drizzle/0047`, `0049`, `0050`, `0062`).
  Nothing was dropped and no migration was written. The definitions stay in
  `lib/db/schema.ts` on purpose: removing a table from the schema does not drop
  it, but `drizzle-kit push` compares schema against database, so an unmodelled
  table becomes a DROP proposal against real data — and
  `agent_config_proposals` records configuration changes a person applied while
  `agent_memories` records preferences a person stated. `agent_sessions.scope`
  must survive regardless, since it was added for the optimizer.
- **`docs/*.md`.** `lib/agent/knowledge/corpus.ts` ingested every markdown file
  under `docs/` as a retrieval corpus; that consumer is gone, but the docs are
  read by people and `lib/scoring-methodology-brief.ts` has its own path. Nothing
  about them changes — keep writing them.
- **The analysis chat panel is unrelated and live.** `chat_messages`,
  `lib/chat-actions.ts`, `lib/chat-export.ts`, `components/analysis/chat-*` never
  imported `lib/agent/`.
- **`lib/agent/registry/{tools,handlers}/talent.ts` was not about `/talent`.**
  Confusingly named: it was the registry's *positions and candidates* domain, and
  it went with this branch because it was registry code.

## Reviving it

1. `git checkout parked/agent-studio` for the whole thing, or cherry-pick the
   paths in the table above onto a branch off current `main`.
2. **Do not restore `lib/agent/optimize/{diagnose,space,objective}.ts`.** They
   live at `lib/job-family/optimize/` now, and two copies would drift into
   proposing different `minClusterSize` values on the panel and in the tool with
   nothing to say which is right. Repoint `registry/handlers/{job-family,optimize}.ts`
   and `registry/tools/optimize.ts` at the new path instead. `optimize/ahp.ts` does
   come back.
3. Expect a merge conflict in `components/sidebar-nav.tsx` (nav entry and its two
   icon imports removed). Take main's side and re-add.
4. Confirm `drizzle/0047`, `0049`, `0050`, `0062` are applied. The page was
   written to survive their absence — it degrades to `schemaReady: false` and says
   how to fix it — so a missing migration shows an empty studio rather than
   crashing.
5. `pnpm exec tsx scripts/agent-eval/run.ts` before trusting it. The planner needs
   `LLM_BASE_URL` / `LLM_MODEL`, and the ≥70% valid-plan threshold from
   `docs/agent-studio.md` §5 is the gate the module was built against.
