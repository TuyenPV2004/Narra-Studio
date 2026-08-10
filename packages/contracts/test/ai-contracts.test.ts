import {describe, expect, it} from 'vitest';
import {
  AiProjectSettingsSchema,
  AiRunSchema,
  AiSearchActivitySchema,
  AiWorkspaceBundleSchema,
  DiscoverOutputSchema,
  OutlineOutputSchema,
  ResearchOutputSchema,
  ScriptOutputSchema,
  StoryboardOutputSchema,
  ThesisOutputSchema,
} from '../src/index.js';

const now = '2026-08-10T00:00:00.000Z';
const projectId = 'project-one';
const runId = 'run-one';

const source = {
  id: 'source-one', projectId, title: 'Primary source', url: 'https://example.com/source',
  publisher: 'Example Institute', sourceType: 'PRIMARY' as const, accessedAt: now,
};
const fact = {
  id: 'fact-one', projectId, statement: 'A supported fact.', sourceIds: [source.id], confidence: 'HIGH' as const,
};
const sourceCard = {
  id: 'source-card-one', projectId, runId, sourceId: source.id, title: source.title, url: source.url,
  publisher: source.publisher, summary: 'This source supports the central fact.', supportsFactIds: [fact.id], accessedAt: now,
};
const topic = {
  id: 'topic-one', projectId, runId, title: 'A documentary topic', hook: 'A surprising opening.',
  angle: 'Follow the evidence.', rationale: 'The source base and visual potential are strong.',
  scores: {viewPotential: 80, storyDepth: 85, visualPotential: 75, sourceQuality: 90, evergreenValue: 70, originalAngle: 78, adSafety: 95},
  recommendationRank: 1, sourceIds: [source.id], risks: ['The evidence window may change.'],
};
const thesis = {
  id: 'thesis-one', projectId, runId, statement: 'The evidence supports a specific argument.',
  supportingFactIds: [fact.id], counterpoint: 'A credible counterpoint exists.',
  falsifiabilityNote: 'A later primary dataset could disprove the trend.',
};
const outlineSection = {
  id: 'outline-one', projectId, runId, order: 0, title: 'Opening', objective: 'Establish the question.',
  claimIds: [], sourceIds: [source.id], targetDurationSec: 60,
};

describe('AI workspace contracts', () => {
  it('accepts project AI settings without storing credentials', () => {
    const result = AiProjectSettingsSchema.safeParse({
      schemaVersion: 1, projectId, updatedAt: now, desiredModel: 'gpt-5.6-sol', desiredEffort: 'medium',
      threadId: null, lastStage: null, lastTurnId: null, lastConnectionStatus: 'UNKNOWN',
    });
    expect(result.success).toBe(true);
  });

  it('requires actionable error metadata for failed AI runs', () => {
    const result = AiRunSchema.safeParse({
      id: runId, projectId, stage: 'RESEARCH', prompt: 'Research the topic.', status: 'FAILED',
      requestedModel: 'gpt-5.6-sol', requestedEffort: 'medium', threadId: null, turnId: null,
      updatedAt: now, completedAt: now, error: null, usage: null,
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.some(({path}) => path.join('.') === 'error')).toBe(true);
  });

  it('rejects incomplete web-search activity', () => {
    const result = AiSearchActivitySchema.safeParse({
      id: 'search-one', projectId, runId, action: 'SEARCH', status: 'STARTED', startedAt: now,
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.some(({path}) => path.join('.') === 'query')).toBe(true);
  });

  it('accepts structured outputs for every editorial stage', () => {
    expect(DiscoverOutputSchema.safeParse({topicCandidates: [topic, {...topic, id: 'topic-two', recommendationRank: 2}]}).success).toBe(true);
    expect(ResearchOutputSchema.safeParse({
      sources: [source], facts: [fact], sourceCards: [sourceCard], researchSummary: 'Evidence summary.',
      counterpoints: ['A counterpoint.'], openQuestions: ['What changes next?'],
    }).success).toBe(true);
    expect(ThesisOutputSchema.safeParse({candidates: [thesis, {...thesis, id: 'thesis-two'}]}).success).toBe(true);
    expect(OutlineOutputSchema.safeParse({sections: [outlineSection]}).success).toBe(true);
    expect(ScriptOutputSchema.safeParse({
      scriptMarkdown: '# Opening\n\nA sourced statement.', claims: [],
      qa: {unsupportedClaimIds: [], warnings: [], estimatedDurationSec: 60},
    }).success).toBe(true);
    expect(StoryboardOutputSchema.safeParse({
      scenes: [{id: 'scene-one', projectId, order: 0, title: 'Opening', narration: 'Narration.', durationSec: 5, claimIds: []}],
      shots: [{id: 'shot-one', projectId, sceneId: 'scene-one', order: 0, durationSec: 5, visualType: 'TEXT', visualPurpose: 'Opening text'}],
    }).success).toBe(true);
  });

  it('rejects storyboard output with a broken scene reference', () => {
    const result = StoryboardOutputSchema.safeParse({
      scenes: [{id: 'scene-one', projectId, order: 0, title: 'Opening', narration: 'Narration.', durationSec: 5, claimIds: []}],
      shots: [{id: 'shot-one', projectId, sceneId: 'scene-missing', order: 0, durationSec: 5, visualType: 'TEXT', visualPurpose: 'Opening text'}],
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.some(({message}) => message.includes('unknown scene'))).toBe(true);
  });

  it('rejects AI workspace artifacts that reference an unknown run', () => {
    const result = AiWorkspaceBundleSchema.safeParse({
      settings: {
        schemaVersion: 1, projectId, updatedAt: now, desiredModel: 'gpt-5.6-sol', desiredEffort: 'medium',
        threadId: null, lastStage: null, lastTurnId: null, lastConnectionStatus: 'UNKNOWN',
      },
      runs: [], searchActivities: [], sourceCards: [sourceCard], topicCandidates: [], thesisCandidates: [], outlineSections: [],
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.some(({message}) => message.includes('unknown run'))).toBe(true);
  });
});
