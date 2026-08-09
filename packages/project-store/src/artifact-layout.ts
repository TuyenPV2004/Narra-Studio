import {
  AssetCollectionSchema,
  ClaimCollectionSchema,
  FactCollectionSchema,
  SceneCollectionSchema,
  ShotCollectionSchema,
  SourceCollectionSchema,
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
] as const;

export const CURRENT_ARTIFACT_SCHEMA_VERSION = 1;
