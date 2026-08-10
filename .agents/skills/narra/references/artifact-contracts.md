# Narra artifact contracts

Use repository-relative portable paths and UTF-8. Write JSON with two-space indentation and a trailing newline. Never encode state in filenames when a schema field exists.

## Common rules

- IDs match `^[a-z0-9][a-z0-9_-]*$` and remain stable across revisions.
- Every item carries the owning `projectId`.
- Timestamps use ISO 8601 with an explicit UTC offset, normally `Z`.
- Collection envelopes use:

```json
{"schemaVersion":1,"projectId":"project-id","updatedAt":"2026-01-01T00:00:00.000Z","items":[]}
```

- Paths inside artifacts are project-relative, never absolute, and never contain `..`.
- Read `packages/contracts/src/schemas.ts` when a field or enum is uncertain; it is authoritative.

## Research

`research/sources.json` items require `id`, `projectId`, `title`, valid `url`, `publisher`, optional `publishedAt`, `sourceType`, and `accessedAt`.

Allowed `sourceType`: `PRIMARY`, `OFFICIAL`, `ACADEMIC`, `REPUTABLE_SECONDARY`.

`research/facts.json` items require `id`, `projectId`, non-empty `statement`, one or more valid `sourceIds`, `confidence` (`HIGH`, `MEDIUM`, `LOW`), and optional `notes`. Put scope, year, unit, scenario, and uncertainty inside the statement or notes.

`research/research_packet.md` summarizes the question, evidence lanes, counterpoints, uncertainty, candidate argument, and source IDs. It must not introduce facts absent from `facts.json`.

## AI workspace

U0 adds portable, non-sensitive AI workspace artifacts:

- `ai/settings.json`: desired model/effort, Codex thread/turn IDs, last stage, and connection status. Never store credentials, cookies, access tokens, API keys, or account email here.
- `ai/runs.json`: stage, prompt, requested/actual model, status, timing, structured error, and optional rate-limit snapshot.
- `ai/search_activity.json`: search/open/find activity emitted by the agent.
- `ai/source_cards.json`: UI-ready source summaries linked to an AI run and optional research source/fact IDs.
- `research/topic_candidates.json`: scored topic proposals linked to the run that produced them.
- `thesis/thesis_candidates.json`: supportable thesis options linked to facts and their producing run.
- `script/outline.json`: ordered structured outline sections linked to sources/claims and target duration.

Every run-owned item must reference an existing run in the same project. `packages/contracts/src/ai-schemas.ts` is authoritative for AI error codes, stage/status enums, collection schemas, and the structured output schemas for discover, research, thesis, outline, script, and storyboard.

## Thesis

Use `thesis/thesis_candidates.json` for 2–3 options during deliberation. Each candidate includes an ID, statement, supporting fact IDs, counterpoint, and falsifiability note.

Write the selected thesis to `thesis/thesis.json` only after the creator chooses:

```json
{"schemaVersion":1,"projectId":"project-id","updatedAt":"2026-01-01T00:00:00.000Z","statement":"A specific, supportable argument."}
```

## Script and claims

Write `script/outline.md`, the current `script/script_v<n>.md`, and `script/qa_report.md`. Preserve older approved versions.

`script/claims.json` items require `id`, `projectId`, `statement`, one or more valid `factIds`, positive `scriptVersion`, and `status`: `SUPPORTED`, `NEEDS_REVIEW`, or `REJECTED`. Every material number, date, causal assertion, or quotation in the script needs a claim entry.

## Storyboard

`storyboard/scenes.json` items require `id`, `projectId`, zero-based `order`, `title`, narration text, positive `durationSec`, and `claimIds`.

`storyboard/shots.json` items require `id`, `projectId`, valid `sceneId`, zero-based order within the scene, positive `durationSec`, `visualType`, and `visualPurpose`. Optional fields are `assetRoute`, `evidenceRequired`, `claimIds`, and `assetId`.

Allowed `visualType`: `AI_IMAGE`, `AI_VIDEO`, `STOCK`, `CHART`, `MAP`, `TEXT`, `EVIDENCE`.

Allowed `assetRoute`: `GOOGLE_FLOW`, `STOCK`, `LOCAL`, `GENERATED`, `NONE`.

Within each scene, shot durations must cover the narration duration. Use multiple shots when the visual argument changes; do not equate one scene with one image.

## Assets, voice, captions, and jobs

Use `assets/manifest.json`, `audio/narration/segments.json`, and `captions/captions.json` exactly as defined by `packages/contracts/src/schemas.ts`. Create/import media through the desktop workflow so probing, QA status, stale scopes, and versions remain consistent.

Use the Review & Render UI to create render jobs. It owns immutable input snapshots, target (`ROUGH` or `FINAL`), version, log, and output attachment. Do not insert or edit SQLite rows manually.
