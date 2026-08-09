import {existsSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {
  AssetCollectionSchema,
  CaptionCollectionSchema,
  ClaimCollectionSchema,
  FactCollectionSchema,
  NarrationSegmentCollectionSchema,
  ProjectSchema,
  SceneCollectionSchema,
  ShotCollectionSchema,
  SourceCollectionSchema,
  ThesisSchema,
} from '../../../../packages/contracts/src/index.ts';

type Stage = 'init' | 'research' | 'thesis' | 'script' | 'storyboard' | 'assets' | 'voice' | 'full';
type ParsedCollection = {projectId: string; items: Array<{id: string; [key: string]: unknown}>};

const args = process.argv.slice(2);
const valueFor = (flag: string): string | undefined => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};
const projectArgument = valueFor('--project');
const stage = (valueFor('--stage') ?? 'full') as Stage;
if (!projectArgument) throw new Error('Usage: validate-artifacts.ts --project <path> [--stage <stage>]');

const projectRoot = path.resolve(projectArgument);
const failures: string[] = [];
const checked: string[] = [];
const readJson = (relativePath: string): unknown => JSON.parse(readFileSync(path.join(projectRoot, ...relativePath.split('/')), 'utf8')) as unknown;
const requireText = (relativePath: string): void => {
  const filePath = path.join(projectRoot, ...relativePath.split('/'));
  if (!existsSync(filePath) || readFileSync(filePath, 'utf8').trim().length === 0) failures.push(`${relativePath}: expected non-empty text`);
  else checked.push(relativePath);
};
const parse = <T>(relativePath: string, schema: {safeParse: (value: unknown) => {success: boolean; data?: T; error?: {issues: Array<{path: PropertyKey[]; message: string}>}}}): T | null => {
  try {
    const result = schema.safeParse(readJson(relativePath));
    if (!result.success) {
      for (const issue of result.error?.issues ?? []) failures.push(`${relativePath}:${issue.path.join('.')}: ${issue.message}`);
      return null;
    }
    checked.push(relativePath);
    return result.data ?? null;
  } catch (error) {
    failures.push(`${relativePath}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
};

const project = parse('project.json', ProjectSchema);
const includes = (...stages: Stage[]): boolean => stage === 'full' || stages.includes(stage);
const sources = includes('research', 'thesis', 'script', 'storyboard') ? parse('research/sources.json', SourceCollectionSchema) : null;
const facts = includes('research', 'thesis', 'script', 'storyboard') ? parse('research/facts.json', FactCollectionSchema) : null;
if (includes('research', 'thesis', 'script', 'storyboard')) requireText('research/research_packet.md');
const thesis = includes('thesis', 'script', 'storyboard') ? parse('thesis/thesis.json', ThesisSchema) : null;
const claims = includes('script', 'storyboard') ? parse('script/claims.json', ClaimCollectionSchema) : null;
if (includes('script', 'storyboard')) requireText('script/script_v1.md');
const scenes = includes('storyboard') ? parse('storyboard/scenes.json', SceneCollectionSchema) : null;
const shots = includes('storyboard') ? parse('storyboard/shots.json', ShotCollectionSchema) : null;
if (includes('assets')) parse('assets/manifest.json', AssetCollectionSchema);
if (includes('voice')) {
  parse('audio/narration/segments.json', NarrationSegmentCollectionSchema);
  parse('captions/captions.json', CaptionCollectionSchema);
}

const projectId = project?.id;
for (const collection of [sources, facts, claims, scenes, shots] as Array<ParsedCollection | null>) {
  if (collection && projectId && collection.projectId !== projectId) failures.push(`Collection projectId ${collection.projectId} does not match ${projectId}`);
}
if (thesis && projectId && thesis.projectId !== projectId) failures.push(`thesis/thesis.json projectId ${thesis.projectId} does not match ${projectId}`);

const sourceIds = new Set(sources?.items.map(({id}) => id) ?? []);
for (const fact of facts?.items ?? []) for (const sourceId of fact.sourceIds) if (!sourceIds.has(sourceId)) failures.push(`Fact ${fact.id} references unknown source ${sourceId}`);
const factIds = new Set(facts?.items.map(({id}) => id) ?? []);
for (const claim of claims?.items ?? []) for (const factId of claim.factIds) if (!factIds.has(factId)) failures.push(`Claim ${claim.id} references unknown fact ${factId}`);
const claimIds = new Set(claims?.items.map(({id}) => id) ?? []);
for (const scene of scenes?.items ?? []) for (const claimId of scene.claimIds) if (!claimIds.has(claimId)) failures.push(`Scene ${scene.id} references unknown claim ${claimId}`);
const sceneIds = new Set(scenes?.items.map(({id}) => id) ?? []);
for (const shot of shots?.items ?? []) {
  if (!sceneIds.has(shot.sceneId)) failures.push(`Shot ${shot.id} references unknown scene ${shot.sceneId}`);
  for (const claimId of shot.claimIds ?? []) if (!claimIds.has(claimId)) failures.push(`Shot ${shot.id} references unknown claim ${claimId}`);
}
if (stage === 'storyboard' || stage === 'full') {
  if ((scenes?.items.length ?? 0) === 0) failures.push('storyboard/scenes.json: expected at least one scene');
  if ((shots?.items.length ?? 0) === 0) failures.push('storyboard/shots.json: expected at least one shot');
}

if (failures.length > 0) {
  console.error(JSON.stringify({status: 'INVALID', stage, projectRoot, checked, failures}, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({status: 'VALID', stage, projectRoot, checked}, null, 2));
}
