---
name: narra
description: Build and validate local Narra Studio documentary artifacts from a project ID or project folder. Use for topic discovery, sourced research, thesis selection, script and claim mapping, storyboard and shot planning, asset tasks, voice/caption preparation, Remotion render preparation, stage review, or advancing a Narra project to its next approval gate. Do not use for unrelated video projects, automatic publishing, or paid API calls.
---

# Narra

Operate Narra Studio as a local, artifact-first documentary workflow. Preserve provenance, stop at human approval gates, and never call the OpenAI API.

## Resolve the request

1. Resolve the project from an explicit path or `projects/<project-id>` relative to the repository root.
2. Read `.agent/AGENTS.md`, `docs/Tong_quan.md`, the Phase 6 section of `docs/Ke_Hoach_V1.md`, and `project.json` when present.
3. Interpret the requested stage from `stage=<name>` or plain language. Use `pipeline` only when the user asks to continue through multiple stages.
4. Inspect approval and stale state through the application/store when available. Never edit SQLite directly.
5. Ask only for a genuinely blocking creative choice. Otherwise use documented defaults and state assumptions.

Supported stages: `init`, `discover`, `research`, `thesis`, `script`, `storyboard`, `assets`, `voice`, `render`, `review`, `pipeline`.

## Load only the needed references

- Read [artifact-contracts.md](references/artifact-contracts.md) before creating or changing structured artifacts.
- Read [quality-gates.md](references/quality-gates.md) for `research`, `thesis`, `script`, `storyboard`, `review`, or `pipeline`.
- Read [render-workflow.md](references/render-workflow.md) only for `assets`, `voice`, `render`, rough-cut review, or final review.

## Execute a stage

1. Verify the prerequisite gate and required upstream artifacts.
2. Preserve stable IDs. Increment document/render versions instead of overwriting an approved result.
3. For current or niche facts, browse the web. Prefer primary, official, and academic sources; open the actual source page before using it.
4. Separate sourced fact, inference, uncertainty, and counterpoint. Never invent a URL, quotation, date, number, or validation result.
5. Write only the outputs owned by the requested stage. Mark affected downstream artifacts stale through the project store or desktop workflow.
6. Run the validator for the completed stage:

```powershell
pnpm exec tsx .agents/skills/narra/scripts/validate-artifacts.ts --project <project-path> --stage <stage>
```

7. Report changed artifacts, sources used, validation command/result, unresolved findings, and the next human gate. Never approve a creative gate on the user's behalf.

## Stage ownership

| Stage | Required input | Owned output | Stop condition |
|---|---|---|---|
| `discover` | niche/audience | `research/topic_candidates.json` | creator selects topic |
| `research` | approved topic/question | `sources.json`, `facts.json`, `research_packet.md` | evidence checklist passes |
| `thesis` | research packet | `thesis_candidates.json`; selected `thesis.json` only after user choice | `THESIS` approval |
| `script` | approved thesis | `outline.md`, `script_v<n>.md`, `claims.json`, `qa_report.md` | `SCRIPT` approval |
| `storyboard` | approved script | `scenes.json`, `shots.json`, coverage report | `STORYBOARD` approval |
| `assets` | approved shots | asset tasks/manifest and prompt packages | asset QA |
| `voice` | approved script/scenes | narration segments, pronunciation notes, caption QA | creator imports/reviews media |
| `render` | validated render snapshot | versioned render/log/media report | rough/final review |
| `review` | requested scope | findings only unless user explicitly asks for fixes | creator decision |

For `pipeline`, run only until the next unapproved creative gate. Do not silently pass `TOPIC`, `THESIS`, `SCRIPT`, `STORYBOARD`, `ASSETS`, `ROUGH_CUT`, or `FINAL`.

## Model and tool policy

- Use the model active in the Codex task. The project recommendation is GPT-5.6 Sol with Medium reasoning; the user selects it through `/model` and `/reasoning` because a skill cannot switch models itself.
- Use ChatGPT/Codex subscription capacity, not the OpenAI API.
- Use local Remotion/FFmpeg commands. If a Remotion skill is available, follow it; otherwise use the repository's tested render scripts.
- Treat Google Flow, TTS/STT providers, and YouTube upload as manual import/export steps unless the user explicitly authorizes a configured integration.
- Do not read or print `.env`, credentials, cookies, or tokens.

## Compare two runs

Keep evaluation runs in separate project directories, then run:

```powershell
pnpm exec tsx .agents/skills/narra/scripts/compare-runs.ts --left <run-a> --right <run-b>
```

Use the comparison to assess source overlap, fact overlap, thesis divergence, script length, and scene/shot coverage. Prefer a justified difference over nondeterministic wording changes.

## Invocation examples

```text
$narra stage=research project=projects/ai-grid
$narra stage=storyboard project=projects/ai-grid
$narra review claims and provenance for projects/ai-grid
$narra pipeline projects/ai-grid until the next approval gate
```
