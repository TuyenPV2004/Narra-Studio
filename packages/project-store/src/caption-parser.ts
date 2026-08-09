import {CaptionCueSchema, type CaptionCue, type NarrationSegment} from '@narra/contracts';

export type VoiceQaIssue = {
  segmentId: string;
  severity: 'WARNING' | 'ERROR';
  message: string;
  missingTerms: string[];
  similarity: number;
};

const parseTimestamp = (value: string): number => {
  const normalized = value.trim().replace(',', '.');
  const parts = normalized.split(':').map(Number);
  if (parts.some(Number.isNaN) || parts.length < 2 || parts.length > 3) throw new Error(`Invalid caption timestamp ${value}.`);
  const seconds = parts.length === 3
    ? (parts[0] ?? 0) * 3600 + (parts[1] ?? 0) * 60 + (parts[2] ?? 0)
    : (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
  return Math.round(seconds * 1000);
};

const cleanCueText = (lines: string[]): string => lines
  .join(' ')
  .replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>')
  .replace(/\s+/g, ' ')
  .trim();

export const parseTimedText = (content: string, projectId: string): CaptionCue[] => {
  const blocks = content.replace(/^\uFEFF/, '').replace(/\r/g, '').split(/\n{2,}/);
  const cues: CaptionCue[] = [];
  for (const block of blocks) {
    const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
    if (lines.length === 0 || lines[0]?.startsWith('WEBVTT') || lines[0]?.startsWith('NOTE')) continue;
    const timingIndex = lines.findIndex((line) => line.includes('-->'));
    if (timingIndex === -1) continue;
    const timing = lines[timingIndex]?.split('-->');
    const startValue = timing?.[0];
    const endValue = timing?.[1]?.trim().split(/\s+/)[0];
    if (!startValue || !endValue) throw new Error('Caption cue is missing a start or end timestamp.');
    const text = cleanCueText(lines.slice(timingIndex + 1));
    if (!text) continue;
    cues.push(CaptionCueSchema.parse({
      id: `caption-${cues.length + 1}`,
      projectId,
      startMs: parseTimestamp(startValue),
      endMs: parseTimestamp(endValue),
      text,
    }));
  }
  if (cues.length === 0) throw new Error('No valid SRT/WebVTT caption cues were found.');
  return cues;
};

type LooseWord = {
  word?: unknown;
  text?: unknown;
  start?: unknown;
  end?: unknown;
  startMs?: unknown;
  endMs?: unknown;
  confidence?: unknown;
  segmentId?: unknown;
  segment_id?: unknown;
};

const milliseconds = (explicitMs: unknown, seconds: unknown): number | undefined => {
  if (typeof explicitMs === 'number') return Math.round(explicitMs);
  if (typeof seconds === 'number') return Math.round(seconds * 1000);
  return undefined;
};

export const parseWordTimestamps = (value: unknown, projectId: string): CaptionCue[] => {
  const candidate = value && typeof value === 'object' && !Array.isArray(value) && 'words' in value
    ? (value as {words: unknown}).words
    : value;
  if (!Array.isArray(candidate)) throw new Error('Word timestamp JSON must be an array or an object containing a words array.');
  const words = candidate.map((item, index) => {
    const word = item as LooseWord;
    const text = typeof word.word === 'string' ? word.word : typeof word.text === 'string' ? word.text : undefined;
    const startMs = milliseconds(word.startMs, word.start);
    const endMs = milliseconds(word.endMs, word.end);
    const segmentId = typeof word.segmentId === 'string' ? word.segmentId : typeof word.segment_id === 'string' ? word.segment_id : undefined;
    if (!text || startMs === undefined || endMs === undefined || endMs <= startMs) {
      throw new Error(`Invalid word timestamp at index ${index}.`);
    }
    return {word: text, startMs, endMs, confidence: typeof word.confidence === 'number' ? word.confidence : undefined, segmentId};
  });

  const cues: CaptionCue[] = [];
  for (let index = 0; index < words.length;) {
    const first = words[index];
    if (!first) break;
    const group = [first];
    index += 1;
    while (index < words.length && group.length < 8) {
      const next = words[index];
      if (!next || next.segmentId !== first.segmentId) break;
      group.push(next);
      index += 1;
      if (/[.!?]$/.test(next.word)) break;
    }
    const last = group[group.length - 1] ?? first;
    cues.push(CaptionCueSchema.parse({
      id: `caption-${cues.length + 1}`,
      projectId,
      segmentId: first.segmentId,
      startMs: first.startMs,
      endMs: last.endMs,
      text: group.map(({word}) => word).join(' '),
      words: group.map((word) => ({
        word: word.word,
        startMs: word.startMs,
        endMs: word.endMs,
        confidence: word.confidence,
      })),
    }));
  }
  if (cues.length === 0) throw new Error('No valid word timestamps were found.');
  return cues;
};

const tokens = (value: string): string[] => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .match(/[a-z0-9]+/g) ?? [];

export const compareNarrationTranscript = (
  segments: NarrationSegment[],
  captions: CaptionCue[],
): VoiceQaIssue[] => segments.flatMap((segment) => {
  const segmentCues = captions.filter(({segmentId, words}) => segmentId === segment.id && words?.length);
  if (segmentCues.length === 0) return [];
  const expected = tokens(segment.text);
  const actual = tokens(segmentCues.map(({text}) => text).join(' '));
  const remaining = new Map<string, number>();
  for (const token of actual) remaining.set(token, (remaining.get(token) ?? 0) + 1);
  let matches = 0;
  for (const token of expected) {
    const count = remaining.get(token) ?? 0;
    if (count > 0) {
      matches += 1;
      remaining.set(token, count - 1);
    }
  }
  const similarity = expected.length === 0 ? 1 : matches / Math.max(expected.length, actual.length, 1);
  const actualSet = new Set(actual);
  const missingTerms = [...new Set(expected.filter((token) => (token.length >= 6 || /^\d+$/.test(token)) && !actualSet.has(token)))];
  if (similarity >= 0.9 && missingTerms.length === 0) return [];
  return [{
    segmentId: segment.id,
    severity: missingTerms.length > 0 ? 'ERROR' as const : 'WARNING' as const,
    message: missingTerms.length > 0
      ? `Transcript is missing key terms: ${missingTerms.join(', ')}.`
      : `Transcript similarity is ${Math.round(similarity * 100)}%; review pronunciation or wording.`,
    missingTerms,
    similarity,
  }];
});
