import {
  AssetCollectionSchema,
  CaptionCollectionSchema,
  ClaimCollectionSchema,
  FactCollectionSchema,
  SceneCollectionSchema,
  ShotCollectionSchema,
  SourceCollectionSchema,
  NarrationSegmentCollectionSchema,
} from '@narra/contracts';

export const PROJECT_DIRECTORIES = [
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
  {path: 'research/sources.json', schema: SourceCollectionSchema},
  {path: 'research/facts.json', schema: FactCollectionSchema},
  {path: 'script/claims.json', schema: ClaimCollectionSchema},
  {path: 'storyboard/scenes.json', schema: SceneCollectionSchema},
  {path: 'storyboard/shots.json', schema: ShotCollectionSchema},
  {path: 'assets/manifest.json', schema: AssetCollectionSchema},
  {path: 'audio/narration/segments.json', schema: NarrationSegmentCollectionSchema},
  {path: 'captions/captions.json', schema: CaptionCollectionSchema},
] as const;

export const CURRENT_ARTIFACT_SCHEMA_VERSION = 1;
