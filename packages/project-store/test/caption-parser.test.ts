import type {NarrationSegment} from '@narra/contracts';
import {describe, expect, it} from 'vitest';
import {compareNarrationTranscript, parseTimedText, parseWordTimestamps} from '../src/caption-parser.js';

describe('caption parser and transcript QA', () => {
  it('parses SRT and WebVTT cue timing into milliseconds', () => {
    const srt = `1\n00:00:01,250 --> 00:00:03,500\nFirst caption.\n\n2\n00:00:04,000 --> 00:00:05,250\nSecond caption.`;
    const vtt = `WEBVTT\n\n00:00:00.500 --> 00:00:01.750 align:center\nA WebVTT cue.`;
    expect(parseTimedText(srt, 'project-one')).toMatchObject([
      {startMs: 1250, endMs: 3500, text: 'First caption.'},
      {startMs: 4000, endMs: 5250, text: 'Second caption.'},
    ]);
    expect(parseTimedText(vtt, 'project-one')[0]).toMatchObject({startMs: 500, endMs: 1750});
  });

  it('groups word timestamps and reports missing narration key terms', () => {
    const captions = parseWordTimestamps({words: [
      {word: 'Electricity', start: 0, end: 0.4, segment_id: 'vo-scene-one'},
      {word: 'powers', start: 0.4, end: 0.7, segment_id: 'vo-scene-one'},
      {word: 'systems.', start: 0.7, end: 1, segment_id: 'vo-scene-one'},
    ]}, 'project-one');
    const segments: NarrationSegment[] = [{
      id: 'vo-scene-one', projectId: 'project-one', sceneId: 'scene-one', order: 0,
      text: 'Electricity powers critical infrastructure systems.', plannedDurationSec: 1,
      status: 'IMPORTED', version: 1,
    }];
    const issues = compareNarrationTranscript(segments, captions);
    expect(captions[0]?.words).toHaveLength(3);
    expect(issues[0]?.missingTerms).toContain('critical');
    expect(issues[0]?.severity).toBe('ERROR');
  });
});
