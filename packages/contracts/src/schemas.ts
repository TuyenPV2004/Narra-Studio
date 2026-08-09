import {z} from 'zod';

const IdSchema = z.string().min(1).regex(/^[a-z0-9][a-z0-9_-]*$/);
const IsoDateTimeSchema = z.string().datetime({offset: true});
const RelativePathSchema = z
  .string()
  .min(1)
  .refine((value) => !value.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(value), {
    message: 'Expected a project-relative path',
  })
  .refine((value) => !value.split(/[\\/]/).includes('..'), {
    message: 'Path traversal is not allowed',
  });

export const ProjectStatusSchema = z.enum([
  'NEW',
  'TOPIC_SELECTED',
  'RESEARCH_READY',
  'THESIS_APPROVED',
  'SCRIPT_APPROVED',
  'STORYBOARD_APPROVED',
  'ASSETS_READY',
  'VOICE_READY',
  'CAPTIONS_READY',
  'ROUGH_CUT_READY',
  'ROUGH_CUT_APPROVED',
  'FINAL_APPROVED',
  'EXPORTED',
]);

export const ProjectSchema = z.object({
  schemaVersion: z.literal(1),
  id: IdSchema,
  title: z.string().min(1),
  question: z.string().min(1),
  status: ProjectStatusSchema,
  targetDurationSec: z.number().int().min(60).max(3600),
  language: z.string().min(2),
  aspectRatio: z.enum(['16:9', '9:16', '1:1']),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});

export const SourceSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  title: z.string().min(1),
  url: z.string().url(),
  publisher: z.string().min(1),
  publishedAt: IsoDateTimeSchema.optional(),
  sourceType: z.enum(['PRIMARY', 'OFFICIAL', 'ACADEMIC', 'REPUTABLE_SECONDARY']),
  accessedAt: IsoDateTimeSchema,
});

export const FactSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  statement: z.string().min(1),
  sourceIds: z.array(IdSchema).min(1),
  confidence: z.enum(['HIGH', 'MEDIUM', 'LOW']),
  notes: z.string().optional(),
});

export const ClaimSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  statement: z.string().min(1),
  factIds: z.array(IdSchema).min(1),
  scriptVersion: z.number().int().positive(),
  status: z.enum(['SUPPORTED', 'NEEDS_REVIEW', 'REJECTED']),
});

export const ThesisSchema = z.object({
  schemaVersion: z.literal(1),
  projectId: IdSchema,
  updatedAt: IsoDateTimeSchema,
  statement: z.string(),
});

export const SceneSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  order: z.number().int().nonnegative(),
  title: z.string().min(1),
  narration: z.string().min(1),
  durationSec: z.number().positive(),
  claimIds: z.array(IdSchema),
});

export const ShotSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  sceneId: IdSchema,
  order: z.number().int().nonnegative(),
  durationSec: z.number().positive(),
  visualType: z.enum(['AI_IMAGE', 'AI_VIDEO', 'STOCK', 'CHART', 'MAP', 'TEXT', 'EVIDENCE']),
  visualPurpose: z.string().min(1),
  assetRoute: z.enum(['GOOGLE_FLOW', 'STOCK', 'LOCAL', 'GENERATED', 'NONE']).optional(),
  evidenceRequired: z.boolean().optional(),
  claimIds: z.array(IdSchema).optional(),
  assetId: IdSchema.optional(),
});

export const MediaMetadataSchema = z.object({
  format: z.string().min(1),
  mimeType: z.string().min(1),
  durationSec: z.number().nonnegative().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  aspectRatio: z.string().min(1).optional(),
  videoCodec: z.string().min(1).optional(),
  audioCodec: z.string().min(1).optional(),
  sampleRate: z.number().int().positive().optional(),
  channels: z.number().int().positive().optional(),
  fileSizeBytes: z.number().int().nonnegative(),
  probedAt: IsoDateTimeSchema,
});

export const AssetTaskSchema = z.object({
  provider: z.enum(['GOOGLE_FLOW', 'STOCK', 'LOCAL', 'OTHER']),
  brief: z.string().min(1),
  prompt: z.string().min(1),
  negativePrompt: z.string().optional(),
  createdAt: IsoDateTimeSchema,
});

export const AssetSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  shotId: IdSchema,
  kind: z.enum(['IMAGE', 'VIDEO', 'AUDIO', 'CAPTION', 'DOCUMENT']),
  status: z.enum(['PLANNED', 'AWAITING_HUMAN', 'IMPORTED', 'SELECTED', 'QA_PASS', 'QA_FAIL', 'REJECTED']),
  path: RelativePathSchema.optional(),
  sourceId: IdSchema.optional(),
  rightsNote: z.string().min(1),
  task: AssetTaskSchema.optional(),
  metadata: MediaMetadataSchema.optional(),
  qaNote: z.string().optional(),
});

export const NarrationSegmentSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  sceneId: IdSchema,
  order: z.number().int().nonnegative(),
  text: z.string().min(1),
  plannedDurationSec: z.number().positive(),
  durationSec: z.number().positive().optional(),
  audioPath: RelativePathSchema.optional(),
  audioMetadata: MediaMetadataSchema.optional(),
  status: z.enum(['PLANNED', 'IMPORTED', 'READY', 'NEEDS_REVIEW']),
  version: z.number().int().positive(),
  pronunciationNotes: z.string().optional(),
});

export const WordTimestampSchema = z.object({
  word: z.string().min(1),
  startMs: z.number().nonnegative(),
  endMs: z.number().positive(),
  confidence: z.number().min(0).max(1).optional(),
}).refine(({startMs, endMs}) => endMs > startMs, {message: 'Word endMs must be greater than startMs'});

export const CaptionCueSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  segmentId: IdSchema.optional(),
  startMs: z.number().nonnegative(),
  endMs: z.number().positive(),
  text: z.string().min(1),
  words: z.array(WordTimestampSchema).optional(),
}).refine(({startMs, endMs}) => endMs > startMs, {message: 'Caption endMs must be greater than startMs'});

export const JobSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  type: z.enum(['PROBE', 'PROXY', 'RENDER', 'POST_PROCESS']),
  status: z.enum(['QUEUED', 'RUNNING', 'COMPLETED', 'RETRYABLE_FAILED', 'TERMINAL_FAILED', 'CANCELLED']),
  inputSnapshotPath: RelativePathSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});

export const ApprovalSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  gate: z.enum(['TOPIC', 'THESIS', 'SCRIPT', 'STORYBOARD', 'ASSETS', 'ROUGH_CUT', 'FINAL']),
  status: z.enum(['PENDING', 'APPROVED', 'REVOKED']),
  artifactVersion: z.number().int().positive(),
  approvedAt: IsoDateTimeSchema.optional(),
  note: z.string().optional(),
});

const artifactCollection = <T extends z.ZodType>(itemSchema: T) =>
  z.object({
    schemaVersion: z.literal(1),
    projectId: IdSchema,
    updatedAt: IsoDateTimeSchema,
    items: z.array(itemSchema),
  });

export const SourceCollectionSchema = artifactCollection(SourceSchema);
export const FactCollectionSchema = artifactCollection(FactSchema);
export const ClaimCollectionSchema = artifactCollection(ClaimSchema);
export const SceneCollectionSchema = artifactCollection(SceneSchema);
export const ShotCollectionSchema = artifactCollection(ShotSchema);
export const AssetCollectionSchema = artifactCollection(AssetSchema);
export const NarrationSegmentCollectionSchema = artifactCollection(NarrationSegmentSchema);
export const CaptionCollectionSchema = artifactCollection(CaptionCueSchema);

export const ProjectBundleSchema = z
  .object({
    project: ProjectSchema,
    sources: z.array(SourceSchema),
    facts: z.array(FactSchema),
    claims: z.array(ClaimSchema),
    scenes: z.array(SceneSchema).min(1),
    shots: z.array(ShotSchema).min(1),
    assets: z.array(AssetSchema),
    narrationSegments: z.array(NarrationSegmentSchema).default([]),
    captions: z.array(CaptionCueSchema).default([]),
    jobs: z.array(JobSchema),
    approvals: z.array(ApprovalSchema),
  })
  .superRefine((bundle, context) => {
    const projectId = bundle.project.id;
    const collections = [
      ...bundle.sources,
      ...bundle.facts,
      ...bundle.claims,
      ...bundle.scenes,
      ...bundle.shots,
      ...bundle.assets,
      ...bundle.narrationSegments,
      ...bundle.captions,
      ...bundle.jobs,
      ...bundle.approvals,
    ];

    for (const item of collections) {
      if (item.projectId !== projectId) {
        context.addIssue({code: 'custom', message: `Artifact ${item.id} belongs to a different project`});
      }
    }

    const sourceIds = new Set(bundle.sources.map(({id}) => id));
    const factIds = new Set(bundle.facts.map(({id}) => id));
    const sceneIds = new Set(bundle.scenes.map(({id}) => id));
    const shotIds = new Set(bundle.shots.map(({id}) => id));
    const assetIds = new Set(bundle.assets.map(({id}) => id));
    const narrationSegmentIds = new Set(bundle.narrationSegments.map(({id}) => id));

    for (const fact of bundle.facts) {
      for (const sourceId of fact.sourceIds) {
        if (!sourceIds.has(sourceId)) {
          context.addIssue({code: 'custom', message: `Fact ${fact.id} references unknown source ${sourceId}`});
        }
      }
    }

    for (const claim of bundle.claims) {
      for (const factId of claim.factIds) {
        if (!factIds.has(factId)) {
          context.addIssue({code: 'custom', message: `Claim ${claim.id} references unknown fact ${factId}`});
        }
      }
    }

    for (const shot of bundle.shots) {
      if (!sceneIds.has(shot.sceneId)) {
        context.addIssue({code: 'custom', message: `Shot ${shot.id} references unknown scene ${shot.sceneId}`});
      }
      if (shot.assetId && !assetIds.has(shot.assetId)) {
        context.addIssue({code: 'custom', message: `Shot ${shot.id} references unknown asset ${shot.assetId}`});
      }
    }

    for (const asset of bundle.assets) {
      if (!shotIds.has(asset.shotId)) {
        context.addIssue({code: 'custom', message: `Asset ${asset.id} references unknown shot ${asset.shotId}`});
      }
    }

    for (const segment of bundle.narrationSegments) {
      if (!sceneIds.has(segment.sceneId)) {
        context.addIssue({code: 'custom', message: `Narration segment ${segment.id} references unknown scene ${segment.sceneId}`});
      }
    }

    for (const caption of bundle.captions) {
      if (caption.segmentId && !narrationSegmentIds.has(caption.segmentId)) {
        context.addIssue({code: 'custom', message: `Caption ${caption.id} references unknown narration segment ${caption.segmentId}`});
      }
    }
  });

export type Project = z.infer<typeof ProjectSchema>;
export type ProjectBundle = z.infer<typeof ProjectBundleSchema>;
export type Scene = z.infer<typeof SceneSchema>;
export type Shot = z.infer<typeof ShotSchema>;
export type Asset = z.infer<typeof AssetSchema>;
export type MediaMetadata = z.infer<typeof MediaMetadataSchema>;
export type NarrationSegment = z.infer<typeof NarrationSegmentSchema>;
export type CaptionCue = z.infer<typeof CaptionCueSchema>;
export type SourceCollection = z.infer<typeof SourceCollectionSchema>;
export type FactCollection = z.infer<typeof FactCollectionSchema>;
export type ClaimCollection = z.infer<typeof ClaimCollectionSchema>;
export type Thesis = z.infer<typeof ThesisSchema>;
export type SceneCollection = z.infer<typeof SceneCollectionSchema>;
export type ShotCollection = z.infer<typeof ShotCollectionSchema>;
export type AssetCollection = z.infer<typeof AssetCollectionSchema>;
export type NarrationSegmentCollection = z.infer<typeof NarrationSegmentCollectionSchema>;
export type CaptionCollection = z.infer<typeof CaptionCollectionSchema>;
