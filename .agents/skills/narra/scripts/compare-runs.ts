import {readFileSync} from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const valueFor = (flag: string): string => {
  const index = args.indexOf(flag);
  if (index < 0 || !args[index + 1]) throw new Error('Usage: compare-runs.ts --left <project-path> --right <project-path>');
  return path.resolve(args[index + 1]);
};
const leftRoot = valueFor('--left');
const rightRoot = valueFor('--right');
const json = <T>(root: string, relative: string): T => JSON.parse(readFileSync(path.join(root, ...relative.split('/')), 'utf8')) as T;
const text = (root: string, relative: string): string => readFileSync(path.join(root, ...relative.split('/')), 'utf8').trim();
const words = (value: string): number => value.split(/\s+/).filter(Boolean).length;
const overlap = (left: string[], right: string[]): number => {
  const a = new Set(left.map((value) => value.toLowerCase()));
  const b = new Set(right.map((value) => value.toLowerCase()));
  const union = new Set([...a, ...b]);
  return union.size === 0 ? 1 : [...a].filter((value) => b.has(value)).length / union.size;
};

type Collection<T> = {items: T[]};
const leftSources = json<Collection<{url: string}>>(leftRoot, 'research/sources.json').items;
const rightSources = json<Collection<{url: string}>>(rightRoot, 'research/sources.json').items;
const leftFacts = json<Collection<{statement: string}>>(leftRoot, 'research/facts.json').items;
const rightFacts = json<Collection<{statement: string}>>(rightRoot, 'research/facts.json').items;
const leftThesis = json<{statement: string}>(leftRoot, 'thesis/thesis.json').statement;
const rightThesis = json<{statement: string}>(rightRoot, 'thesis/thesis.json').statement;
const leftScenes = json<Collection<unknown>>(leftRoot, 'storyboard/scenes.json').items.length;
const rightScenes = json<Collection<unknown>>(rightRoot, 'storyboard/scenes.json').items.length;
const leftShots = json<Collection<unknown>>(leftRoot, 'storyboard/shots.json').items.length;
const rightShots = json<Collection<unknown>>(rightRoot, 'storyboard/shots.json').items.length;

console.log(JSON.stringify({
  left: leftRoot,
  right: rightRoot,
  sourceUrlJaccard: Number(overlap(leftSources.map(({url}) => url), rightSources.map(({url}) => url)).toFixed(3)),
  factStatementJaccard: Number(overlap(leftFacts.map(({statement}) => statement), rightFacts.map(({statement}) => statement)).toFixed(3)),
  thesis: {same: leftThesis === rightThesis, left: leftThesis, right: rightThesis},
  scriptWords: {left: words(text(leftRoot, 'script/script_v1.md')), right: words(text(rightRoot, 'script/script_v1.md'))},
  coverage: {left: {scenes: leftScenes, shots: leftShots}, right: {scenes: rightScenes, shots: rightShots}},
}, null, 2));
