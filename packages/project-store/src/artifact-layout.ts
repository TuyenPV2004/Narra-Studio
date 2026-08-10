import {
  AiProjectSettingsSchema,
  AiRunCollectionSchema,
  AiSearchActivityCollectionSchema,
  AiSourceCardCollectionSchema,
  AssetCollectionSchema,
  CaptionCollectionSchema,
  ClaimCollectionSchema,
  FactCollectionSchema,
  SceneCollectionSchema,
  ShotCollectionSchema,
  SourceCollectionSchema,
  NarrationSegmentCollectionSchema,
  OutlineSectionCollectionSchema,
  ThesisCandidateCollectionSchema,
  TopicCandidateCollectionSchema,
} from '@narra/contracts';

export const PROJECT_DIRECTORIES = [
  'ai',
  'research',
  'thesis',
  'script',
  'storyboard',
  'assets/images',
  'assets/videos',
  'audio/narration',
  'audio/music',
  'captions',
  'renders/rough',
  'renders/final',
] as const;

export const COLLECTION_ARTIFACTS = [
  {path: 'ai/runs.json', schema: AiRunCollectionSchema},
  {path: 'ai/search_activity.json', schema: AiSearchActivityCollectionSchema},
  {path: 'ai/source_cards.json', schema: AiSourceCardCollectionSchema},
  {path: 'research/sources.json', schema: SourceCollectionSchema},
  {path: 'research/facts.json', schema: FactCollectionSchema},
  {path: 'research/topic_candidates.json', schema: TopicCandidateCollectionSchema},
  {path: 'thesis/thesis_candidates.json', schema: ThesisCandidateCollectionSchema},
  {path: 'script/claims.json', schema: ClaimCollectionSchema},
  {path: 'script/outline.json', schema: OutlineSectionCollectionSchema},
  {path: 'storyboard/scenes.json', schema: SceneCollectionSchema},
  {path: 'storyboard/shots.json', schema: ShotCollectionSchema},
  {path: 'assets/manifest.json', schema: AssetCollectionSchema},
  {path: 'audio/narration/segments.json', schema: NarrationSegmentCollectionSchema},
  {path: 'captions/captions.json', schema: CaptionCollectionSchema},
] as const;

export const OBJECT_ARTIFACTS = [
  {path: 'ai/settings.json', schema: AiProjectSettingsSchema},
] as const;

export const JSON_ARTIFACTS = [...COLLECTION_ARTIFACTS, ...OBJECT_ARTIFACTS] as const;

export const UPDATE_V1_ARTIFACT_PATHS = new Set([
  'ai/runs.json',
  'ai/search_activity.json',
  'ai/source_cards.json',
  'ai/settings.json',
  'research/topic_candidates.json',
  'thesis/thesis_candidates.json',
  'script/outline.json',
]);

export const CURRENT_ARTIFACT_SCHEMA_VERSION = 1;
