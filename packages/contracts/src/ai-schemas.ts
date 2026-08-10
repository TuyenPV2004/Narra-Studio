import {z} from 'zod';
import {
  ClaimSchema,
  FactSchema,
  SceneSchema,
  ShotSchema,
  SourceSchema,
} from './schemas.js';

const IdSchema = z.string().min(1).regex(/^[a-z0-9][a-z0-9_-]*$/);
const IsoDateTimeSchema = z.string().datetime({offset: true});

export const AiStageSchema = z.enum([
  'DISCOVER',
  'RESEARCH',
  'THESIS',
  'OUTLINE',
  'SCRIPT',
  'STORYBOARD',
]);

export const AiReasoningEffortSchema = z.enum(['low', 'medium', 'high', 'xhigh']);
export const AiConnectionStatusSchema = z.enum([
  'UNKNOWN',
  'CODEX_NOT_FOUND',
  'SIGNED_OUT',
  'READY',
  'RATE_LIMITED',
  'ERROR',
]);
export const AiRunStatusSchema = z.enum([
  'QUEUED',
  'RUNNING',
  'WAITING_FOR_USER',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
]);
export const AiErrorCodeSchema = z.enum([
  'CODEX_NOT_FOUND',
  'SIGNED_OUT',
  'MODEL_UNAVAILABLE',
  'RATE_LIMITED',
  'NETWORK_ERROR',
  'TOOL_ERROR',
  'SCHEMA_INVALID',
  'TURN_CANCELLED',
  'APP_SERVER_ERROR',
  'UNKNOWN',
]);

export const AiWorkspacePreferencesSchema = z.object({
  schemaVersion: z.literal(1),
  desiredModel: z.string().min(1).default('gpt-5.6-sol'),
  desiredEffort: AiReasoningEffortSchema.default('medium'),
});

export const AiProjectSettingsSchema = z.object({
  schemaVersion: z.literal(1),
  projectId: IdSchema,
  updatedAt: IsoDateTimeSchema,
  desiredModel: z.string().min(1),
  desiredEffort: AiReasoningEffortSchema,
  threadId: z.string().min(1).nullable(),
  lastStage: AiStageSchema.nullable(),
  lastTurnId: z.string().min(1).nullable(),
  lastConnectionStatus: AiConnectionStatusSchema,
});

export const AiRunErrorSchema = z.object({
  code: AiErrorCodeSchema,
  message: z.string().min(1),
  retryable: z.boolean(),
  details: z.string().optional(),
});

export const AiUsageSnapshotSchema = z.object({
  capturedAt: IsoDateTimeSchema,
  limitId: z.string().min(1),
  usedPercent: z.number().min(0).max(100),
  windowDurationMins: z.number().positive().optional(),
  resetsAt: IsoDateTimeSchema.optional(),
});

export const AiRunSchema = z
  .object({
    id: IdSchema,
    projectId: IdSchema,
    stage: AiStageSchema,
    prompt: z.string().min(1),
    status: AiRunStatusSchema,
    requestedModel: z.string().min(1),
    requestedEffort: AiReasoningEffortSchema,
    actualModel: z.string().min(1).optional(),
    actualEffort: AiReasoningEffortSchema.optional(),
    threadId: z.string().min(1).nullable(),
    turnId: z.string().min(1).nullable(),
    startedAt: IsoDateTimeSchema.optional(),
    completedAt: IsoDateTimeSchema.optional(),
    updatedAt: IsoDateTimeSchema,
    error: AiRunErrorSchema.nullable(),
    usage: AiUsageSnapshotSchema.nullable(),
  })
  .superRefine((run, context) => {
    if (run.status === 'FAILED' && !run.error) {
      context.addIssue({code: 'custom', path: ['error'], message: 'A failed AI run requires an error'});
    }
    if (run.status !== 'FAILED' && run.error) {
      context.addIssue({code: 'custom', path: ['error'], message: 'Only a failed AI run may carry an error'});
    }
    if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(run.status) && !run.completedAt) {
      context.addIssue({code: 'custom', path: ['completedAt'], message: 'A terminal AI run requires completedAt'});
    }
  });

export const AiSearchActivitySchema = z
  .object({
    id: IdSchema,
    projectId: IdSchema,
    runId: IdSchema,
    action: z.enum(['SEARCH', 'OPEN_PAGE', 'FIND_IN_PAGE']),
    query: z.string().min(1).optional(),
    url: z.string().url().optional(),
    pattern: z.string().min(1).optional(),
    status: z.enum(['STARTED', 'COMPLETED', 'FAILED']),
    startedAt: IsoDateTimeSchema,
    completedAt: IsoDateTimeSchema.optional(),
    errorMessage: z.string().min(1).optional(),
  })
  .superRefine((activity, context) => {
    if (activity.action === 'SEARCH' && !activity.query) {
      context.addIssue({code: 'custom', path: ['query'], message: 'Search activity requires a query'});
    }
    if (activity.action !== 'SEARCH' && !activity.url) {
      context.addIssue({code: 'custom', path: ['url'], message: `${activity.action} activity requires a URL`});
    }
    if (activity.action === 'FIND_IN_PAGE' && !activity.pattern) {
      context.addIssue({code: 'custom', path: ['pattern'], message: 'Find-in-page activity requires a pattern'});
    }
    if (activity.status !== 'STARTED' && !activity.completedAt) {
      context.addIssue({code: 'custom', path: ['completedAt'], message: 'Finished search activity requires completedAt'});
    }
    if (activity.status === 'FAILED' && !activity.errorMessage) {
      context.addIssue({code: 'custom', path: ['errorMessage'], message: 'Failed search activity requires an error message'});
    }
  });

export const AiSourceCardSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  runId: IdSchema,
  sourceId: IdSchema.optional(),
  title: z.string().min(1),
  url: z.string().url(),
  publisher: z.string().min(1).optional(),
  summary: z.string().min(1),
  supportsFactIds: z.array(IdSchema),
  accessedAt: IsoDateTimeSchema,
});

const ScoreSchema = z.number().min(0).max(100);
export const TopicCandidateSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  runId: IdSchema,
  title: z.string().min(1),
  hook: z.string().min(1),
  angle: z.string().min(1),
  rationale: z.string().min(1),
  scores: z.object({
    viewPotential: ScoreSchema,
    storyDepth: ScoreSchema,
    visualPotential: ScoreSchema,
    sourceQuality: ScoreSchema,
    evergreenValue: ScoreSchema,
    originalAngle: ScoreSchema,
    adSafety: ScoreSchema,
  }),
  recommendationRank: z.number().int().positive(),
  sourceIds: z.array(IdSchema),
  risks: z.array(z.string().min(1)),
  selected: z.boolean().optional(),
});

export const ThesisCandidateSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  runId: IdSchema,
  statement: z.string().min(1),
  supportingFactIds: z.array(IdSchema).min(1),
  counterpoint: z.string().min(1),
  falsifiabilityNote: z.string().min(1),
});

export const OutlineSectionSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  runId: IdSchema,
  order: z.number().int().nonnegative(),
  title: z.string().min(1),
  objective: z.string().min(1),
  claimIds: z.array(IdSchema),
  sourceIds: z.array(IdSchema),
  targetDurationSec: z.number().positive(),
  contentNotes: z.string().optional(),
});

const artifactCollection = <T extends z.ZodType>(itemSchema: T) =>
  z.object({
    schemaVersion: z.literal(1),
    projectId: IdSchema,
    updatedAt: IsoDateTimeSchema,
    items: z.array(itemSchema),
  }).superRefine((collection, context) => {
    for (const [index, item] of collection.items.entries()) {
      if (item && typeof item === 'object' && 'projectId' in item && item.projectId !== collection.projectId) {
        context.addIssue({
          code: 'custom',
          path: ['items', index, 'projectId'],
          message: `AI artifact belongs to project ${String(item.projectId)}, expected ${collection.projectId}`,
        });
      }
    }
  });

export const AiRunCollectionSchema = artifactCollection(AiRunSchema);
export const AiSearchActivityCollectionSchema = artifactCollection(AiSearchActivitySchema);
export const AiSourceCardCollectionSchema = artifactCollection(AiSourceCardSchema);
export const TopicCandidateCollectionSchema = artifactCollection(TopicCandidateSchema);
export const ThesisCandidateCollectionSchema = artifactCollection(ThesisCandidateSchema);
export const OutlineSectionCollectionSchema = artifactCollection(OutlineSectionSchema);

export const AiWorkspaceBundleSchema = z
  .object({
    settings: AiProjectSettingsSchema,
    runs: z.array(AiRunSchema),
    searchActivities: z.array(AiSearchActivitySchema),
    sourceCards: z.array(AiSourceCardSchema),
    topicCandidates: z.array(TopicCandidateSchema),
    thesisCandidates: z.array(ThesisCandidateSchema),
    outlineSections: z.array(OutlineSectionSchema),
  })
  .superRefine((workspace, context) => {
    const projectId = workspace.settings.projectId;
    const items = [
      ...workspace.runs,
      ...workspace.searchActivities,
      ...workspace.sourceCards,
      ...workspace.topicCandidates,
      ...workspace.thesisCandidates,
      ...workspace.outlineSections,
    ];
    for (const item of items) {
      if (item.projectId !== projectId) {
        context.addIssue({code: 'custom', message: `AI artifact ${item.id} belongs to a different project`});
      }
    }
    const runIds = new Set(workspace.runs.map(({id}) => id));
    const runOwnedItems = [
      ...workspace.searchActivities,
      ...workspace.sourceCards,
      ...workspace.topicCandidates,
      ...workspace.thesisCandidates,
      ...workspace.outlineSections,
    ];
    for (const item of runOwnedItems) {
      if (!runIds.has(item.runId)) {
        context.addIssue({code: 'custom', message: `AI artifact ${item.id} references unknown run ${item.runId}`});
      }
    }
  });

export const DiscoverOutputSchema = z.object({
  topicCandidates: z.array(TopicCandidateSchema).min(2),
});

export const ResearchOutputSchema = z.object({
  researchQuestions: z.array(z.string().min(1)).min(1),
  sources: z.array(SourceSchema).min(1),
  facts: z.array(FactSchema).min(1),
  sourceCards: z.array(AiSourceCardSchema).min(1),
  researchSummary: z.string().min(1),
  counterpoints: z.array(z.string().min(1)),
  openQuestions: z.array(z.string().min(1)),
  evidenceChecklist: z.array(z.object({
    label: z.string().min(1),
    passed: z.boolean(),
    note: z.string().min(1),
  })).min(1),
});

export const ThesisOutputSchema = z.object({
  candidates: z.array(ThesisCandidateSchema).min(2).max(3),
});

export const OutlineOutputSchema = z.object({
  sections: z.array(OutlineSectionSchema).min(1),
});

export const ScriptOutputSchema = z.object({
  scriptMarkdown: z.string().min(1),
  claims: z.array(ClaimSchema),
  qa: z.object({
    unsupportedClaimIds: z.array(IdSchema),
    warnings: z.array(z.string().min(1)),
    estimatedDurationSec: z.number().positive(),
  }),
});

export const StoryboardOutputSchema = z
  .object({
    scenes: z.array(SceneSchema).min(1),
    shots: z.array(ShotSchema).min(1),
  })
  .superRefine(({scenes, shots}, context) => {
    const sceneIds = new Set(scenes.map(({id}) => id));
    for (const shot of shots) {
      if (!sceneIds.has(shot.sceneId)) {
        context.addIssue({code: 'custom', path: ['shots'], message: `Shot ${shot.id} references unknown scene ${shot.sceneId}`});
      }
    }
  });

export const getAiStageOutputSchema = (stage: AiStage) => {
  switch (stage) {
    case 'DISCOVER': return DiscoverOutputSchema;
    case 'RESEARCH': return ResearchOutputSchema;
    case 'THESIS': return ThesisOutputSchema;
    case 'OUTLINE': return OutlineOutputSchema;
    case 'SCRIPT': return ScriptOutputSchema;
    case 'STORYBOARD': return StoryboardOutputSchema;
  }
};

export const getAiStageJsonSchema = (stage: AiStage): Record<string, unknown> =>
  makeStructuredOutputSchema(
    z.toJSONSchema(getAiStageOutputSchema(stage), {target: 'draft-7'}) as Record<string, unknown>,
  );

const makeStructuredOutputSchema = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value as Record<string, unknown>;
  const source = value as Record<string, unknown>;
  const next = Object.fromEntries(Object.entries(source).map(([key, item]) => [
    key,
    Array.isArray(item) ? item.map((entry) => entry && typeof entry === 'object' ? makeStructuredOutputSchema(entry) : entry)
      : item && typeof item === 'object' ? makeStructuredOutputSchema(item) : item,
  ]));
  if (source.properties && typeof source.properties === 'object' && !Array.isArray(source.properties)) {
    const properties = next.properties as Record<string, unknown>;
    const originallyRequired = new Set(Array.isArray(source.required) ? source.required : []);
    for (const key of Object.keys(properties)) {
      if (!originallyRequired.has(key)) properties[key] = {anyOf: [properties[key], {type: 'null'}]};
    }
    next.required = Object.keys(properties);
  }
  return next;
};

export const normalizeAiStageOutput = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(normalizeAiStageOutput);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== null)
    .map(([key, item]) => [key, normalizeAiStageOutput(item)]));
};

export type AiProjectSettings = z.infer<typeof AiProjectSettingsSchema>;
export type AiStage = z.infer<typeof AiStageSchema>;
export type AiReasoningEffort = z.infer<typeof AiReasoningEffortSchema>;
export type AiRun = z.infer<typeof AiRunSchema>;
export type AiSearchActivity = z.infer<typeof AiSearchActivitySchema>;
export type AiSourceCard = z.infer<typeof AiSourceCardSchema>;
export type TopicCandidate = z.infer<typeof TopicCandidateSchema>;
export type ThesisCandidate = z.infer<typeof ThesisCandidateSchema>;
export type OutlineSection = z.infer<typeof OutlineSectionSchema>;
export type AiWorkspaceBundle = z.infer<typeof AiWorkspaceBundleSchema>;
