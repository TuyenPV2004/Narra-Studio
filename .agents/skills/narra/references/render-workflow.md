# Local media and render workflow

## Assets

1. Create asset tasks from approved shots in the desktop app.
2. Let the creator produce or license media through Google Flow, stock, or another approved source.
3. Import media through Narra so technical metadata is probed.
4. Require a rights note and human QA before `QA_PASS`.
5. Never use generated imagery as evidence of a real event.

## Voice and captions

1. Sync narration segments from approved scenes.
2. Let the creator generate audio manually unless a provider integration is explicitly authorized.
3. Import one segment at a time; preserve unrelated segment versions.
4. Import SRT, VTT, or word timestamps and review missing key terms.
5. Fit scene/shot timing to actual narration audio; narration is the master timeline.

## Render

1. Approve prerequisite gates in the desktop app.
2. Queue a rough or final render to create an immutable versioned snapshot and log.
3. Use repository scripts and local Remotion/FFmpeg. A plugin or skill can guide authoring but is not the Remotion runtime.
4. Check `package.json` before choosing a `pnpm --filter @narra/render ...` command.
5. Attach the completed video to its queued job in the UI.
6. Probe the output and verify preset, duration, audio, captions, and visual completeness.
7. Never overwrite an approved render. Create the next version.

Automatic job execution, retry, cancel, and crash recovery belong to Phase 7. Until then, the creator starts the local render and attaches its result.
