import {
  editorClipDuration,
  type EditorClip,
  type EditorProject,
  type EditorTrack,
} from "@/services/electron-api/editor";

export const defaultEditorTracks = (): EditorTrack[] => [
  {
    id: `track-video-${crypto.randomUUID()}`,
    name: "Video 1",
    trackType: "video",
  },
  {
    id: `track-audio-${crypto.randomUUID()}`,
    name: "Audio 1",
    trackType: "audio",
  },
];

export const projectTracks = (project: EditorProject): EditorTrack[] => {
  if (project.tracks?.length) return project.tracks;
  return [
    { id: "legacy-video-track", name: "Video 1", trackType: "video" },
    { id: "legacy-audio-track", name: "Audio 1", trackType: "audio" },
  ];
};

export const ensureTimelineProject = (
  project: EditorProject,
): EditorProject => {
  if (project.tracks?.length && project.clips.every((clip) => clip.trackId))
    return project;
  const tracks = projectTracks(project);
  const videoId = tracks.find((track) => track.trackType === "video")!.id;
  const audioId = tracks.find((track) => track.trackType === "audio")!.id;
  let sequentialStart = 0;
  return {
    ...project,
    tracks,
    clips: project.clips.map((clip) => {
      const startTime = clip.startTime ?? sequentialStart;
      if (clip.trackType !== "audio")
        sequentialStart = startTime + editorClipDuration(clip);
      return {
        ...clip,
        trackId:
          clip.trackId ?? (clip.trackType === "audio" ? audioId : videoId),
        startTime,
      };
    }),
  };
};

export const timelineDuration = (clips: EditorClip[]): number =>
  clips.reduce(
    (duration, clip) =>
      Math.max(duration, (clip.startTime ?? 0) + editorClipDuration(clip)),
    0,
  );

const curveTimelineSeconds = (
  clip: EditorClip,
  sourceFraction: number,
): number => {
  const sourceDuration = Math.max(
    0,
    (clip.sourceEnd ?? clip.duration) - (clip.sourceStart ?? 0),
  );
  const keyframes = (clip.speedCurveKeyframes ?? [])
    .filter((item) => Number.isFinite(item.t) && Number.isFinite(item.s))
    .map((item) => ({
      t: Math.max(0, Math.min(1, item.t)),
      s: Math.max(0.0625, Math.min(16, item.s)),
    }))
    .sort((left, right) => left.t - right.t);
  if (!clip.speedCurve || clip.speedCurve === "none" || keyframes.length < 2)
    return (
      (sourceDuration * Math.max(0, Math.min(1, sourceFraction))) /
      Math.max(0.25, clip.speed ?? 1)
    );
  const first = keyframes[0]!;
  const last = keyframes[keyframes.length - 1]!;
  const points = [
    ...(first.t > 0 ? [{ t: 0, s: first.s }] : []),
    ...keyframes,
    ...(last.t < 1 ? [{ t: 1, s: last.s }] : []),
  ];
  const limit = Math.max(0, Math.min(1, sourceFraction));
  let seconds = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index]!;
    const end = points[index + 1]!;
    if (limit <= start.t) break;
    const segmentEnd = Math.min(limit, end.t);
    const fraction = segmentEnd - start.t;
    if (fraction <= 0) continue;
    const ratio = fraction / Math.max(0.000001, end.t - start.t);
    const endSpeed = start.s + (end.s - start.s) * ratio;
    const integral =
      Math.abs(endSpeed - start.s) < 0.000001
        ? fraction / start.s
        : (fraction * Math.log(endSpeed / start.s)) / (endSpeed - start.s);
    seconds += integral * sourceDuration;
    if (segmentEnd >= limit) break;
  }
  return seconds;
};

export const sourceOffsetAtTimelineTime = (
  clip: EditorClip,
  timelineSeconds: number,
): number => {
  const sourceDuration = Math.max(
    0,
    (clip.sourceEnd ?? clip.duration) - (clip.sourceStart ?? 0),
  );
  const duration = editorClipDuration(clip);
  if (duration <= 0 || sourceDuration <= 0) return 0;
  const target = Math.max(0, Math.min(duration, timelineSeconds));
  let low = 0;
  let high = 1;
  for (let iteration = 0; iteration < 36; iteration += 1) {
    const middle = (low + high) / 2;
    if (curveTimelineSeconds(clip, middle) < target) low = middle;
    else high = middle;
  }
  return ((low + high) / 2) * sourceDuration;
};

export const flattenVisibleVideoTimeline = (
  project: EditorProject,
): EditorClip[] => {
  const tracks = projectTracks(project);
  const videoTracks = tracks.filter(
    (track) => track.trackType === "video" && !track.hidden,
  );
  const trackPriority = new Map(
    videoTracks.map((track, index) => [track.id, index]),
  );
  const clips = project.clips.filter(
    (clip) =>
      clip.trackType !== "audio" &&
      trackPriority.has(clip.trackId ?? videoTracks[0]?.id ?? ""),
  );
  if (
    !clips.some((clip) => (clip.startTime ?? 0) > 0) &&
    new Set(clips.map((clip) => clip.trackId)).size <= 1
  )
    return clips;
  const boundaries = [
    ...new Set(
      clips.flatMap((clip) => [
        clip.startTime ?? 0,
        (clip.startTime ?? 0) + editorClipDuration(clip),
      ]),
    ),
  ].sort((left, right) => left - right);
  const slices: EditorClip[] = [];
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const start = boundaries[index]!;
    const end = boundaries[index + 1]!;
    if (end - start < 0.001) continue;
    const active = clips
      .filter(
        (clip) =>
          (clip.startTime ?? 0) <= start + 0.0001 &&
          (clip.startTime ?? 0) + editorClipDuration(clip) >= end - 0.0001,
      )
      .sort(
        (left, right) =>
          (trackPriority.get(left.trackId ?? "") ?? Number.MAX_SAFE_INTEGER) -
          (trackPriority.get(right.trackId ?? "") ?? Number.MAX_SAFE_INTEGER),
      );
    const clip = active[0];
    if (!clip) continue;
    const sourceStart =
      (clip.sourceStart ?? 0) +
      sourceOffsetAtTimelineTime(clip, start - (clip.startTime ?? 0));
    const sourceEnd =
      (clip.sourceStart ?? 0) +
      sourceOffsetAtTimelineTime(clip, end - (clip.startTime ?? 0));
    const previous = slices.at(-1);
    if (
      previous?.id === clip.id &&
      Math.abs((previous.sourceEnd ?? 0) - sourceStart) < 0.001
    ) {
      previous.sourceEnd = sourceEnd;
      continue;
    }
    const { transitionOut: _transition, ...slice } = clip;
    slices.push({ ...slice, sourceStart, sourceEnd, startTime: start });
  }
  return slices;
};
