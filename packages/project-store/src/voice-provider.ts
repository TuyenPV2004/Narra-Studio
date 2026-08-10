import {spawn} from 'node:child_process';
import {existsSync, mkdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import type {VoicePreset, VoiceRuntimeStatus} from './types.js';

export type PronunciationEntry = {term: string; spokenAs: string};

export type VoiceSynthesisInput = {
  text: string;
  presetId: string;
  speed: number;
  pronunciationNotes?: string;
  outputDirectory: string;
};

export type VoiceSynthesisResult = {
  outputPath: string;
  preset: VoicePreset;
  normalizedText: string;
  pronunciationDictionary: PronunciationEntry[];
  modelVersion: string;
  sampleRate: number;
  channels: number;
  loudnessTargetLufs: number;
  generationDurationMs: number;
};

export interface VoiceProvider {
  readonly id: 'KOKORO_ONNX';
  readonly presets: VoicePreset[];
  getRuntimeStatus(): VoiceRuntimeStatus;
  synthesize(input: VoiceSynthesisInput): Promise<VoiceSynthesisResult>;
}

export const KOKORO_PRESETS: VoicePreset[] = [
  {id: 'documentary-neutral-us', label: 'Documentary neutral · US', description: 'Balanced female narration for most documentary scenes.', voice: 'af_heart', language: 'en-us', defaultSpeed: 1},
  {id: 'documentary-warm-us', label: 'Documentary warm · US', description: 'Warmer female delivery for reflective passages.', voice: 'af_bella', language: 'en-us', defaultSpeed: 0.96},
  {id: 'documentary-male-us', label: 'Documentary male · US', description: 'Measured male narration for explanatory passages.', voice: 'am_michael', language: 'en-us', defaultSpeed: 0.98},
  {id: 'documentary-neutral-uk', label: 'Documentary neutral · UK', description: 'Clear British female narration.', voice: 'bf_emma', language: 'en-gb', defaultSpeed: 0.98},
];

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const parsePronunciationNotes = (notes?: string): PronunciationEntry[] => {
  if (!notes?.trim()) return [];
  const entries: PronunciationEntry[] = [];
  for (const item of notes.split(/[;\n]+/)) {
    const separator = item.indexOf('=');
    if (separator < 1) continue;
    const term = item.slice(0, separator).trim();
    const spokenAs = item.slice(separator + 1).trim();
    if (term && spokenAs) entries.push({term, spokenAs});
  }
  return entries;
};

export const normalizeEnglishNarration = (text: string, dictionary: PronunciationEntry[]): string => {
  let normalized = text
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/…/g, '...')
    .replace(/(\d+(?:\.\d+)?)\s*%/g, '$1 percent')
    .replace(/(\d+(?:\.\d+)?)\s*(km|kg|gb|tb|mw|gw)\b/gi, (_match, value: string, unit: string) => {
      const units: Record<string, string> = {km: 'kilometers', kg: 'kilograms', gb: 'gigabytes', tb: 'terabytes', mw: 'megawatts', gw: 'gigawatts'};
      return `${value} ${units[unit.toLowerCase()]}`;
    });
  for (const {term, spokenAs} of [...dictionary].sort((left, right) => right.term.length - left.term.length)) {
    normalized = normalized.replace(new RegExp(`\\b${escapeRegExp(term)}\\b`, 'gi'), spokenAs);
  }
  const spokenInitialisms = new Set(['AI', 'API', 'CPU', 'GPU', 'URL', 'HTTP', 'HTTPS', 'CEO', 'CO2']);
  normalized = normalized.replace(/\b[A-Z][A-Z0-9]{1,5}\b/g, (value) =>
    spokenInitialisms.has(value) ? value.split('').join(' ') : value,
  );
  return normalized.replace(/\s+/g, ' ').trim();
};

type ProcessResult = {stdout: string; stderr: string};

const runProcess = (
  file: string,
  args: string[],
  options: {cwd: string; env?: NodeJS.ProcessEnv; timeoutMs?: number},
): Promise<ProcessResult> => new Promise((resolve, reject) => {
  const child = spawn(file, args, {
    cwd: options.cwd,
    windowsHide: true,
    env: options.env ?? process.env,
  });
  let stdout = '';
  let stderr = '';
  const timeout = setTimeout(() => {
    child.kill();
    reject(new Error(`Voice process timed out after ${options.timeoutMs ?? 600000} ms.`));
  }, options.timeoutMs ?? 600000);
  child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
  child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
  child.once('error', (error) => {
    clearTimeout(timeout);
    reject(error);
  });
  child.once('exit', (code) => {
    clearTimeout(timeout);
    if (code === 0) resolve({stdout, stderr});
    else reject(new Error(stderr.trim() || stdout.trim() || `Voice process exited with code ${code ?? 'unknown'}.`));
  });
});

export type KokoroOnnxProviderOptions = {
  repositoryRoot: string;
  runtimeRoot?: string;
  pythonExecutable?: string;
  nodeExecutable?: string;
};

export class KokoroOnnxProvider implements VoiceProvider {
  readonly id = 'KOKORO_ONNX' as const;
  readonly presets = KOKORO_PRESETS;
  readonly modelVersion = '1.0';
  private readonly repositoryRoot: string;
  private readonly runtimeRoot: string;
  private readonly pythonExecutable: string;
  private readonly nodeExecutable: string;

  constructor(options: KokoroOnnxProviderOptions) {
    this.repositoryRoot = path.resolve(options.repositoryRoot);
    this.runtimeRoot = path.resolve(options.runtimeRoot ?? path.join(this.repositoryRoot, '.runtime/voice'));
    this.pythonExecutable = options.pythonExecutable ?? path.join(
      this.runtimeRoot,
      '.venv',
      process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
    );
    this.nodeExecutable = options.nodeExecutable ?? process.execPath;
  }

  getRuntimeStatus(): VoiceRuntimeStatus {
    const required = [
      {label: 'Python environment', filePath: this.pythonExecutable},
      {label: 'Kokoro model', filePath: path.join(this.runtimeRoot, 'models/kokoro-v1.0.onnx')},
      {label: 'Kokoro voices', filePath: path.join(this.runtimeRoot, 'models/voices-v1.0.bin')},
      {label: 'Runtime diagnostic marker', filePath: path.join(this.runtimeRoot, 'runtime-ready.json')},
      {label: 'Narra voice worker', filePath: path.join(this.repositoryRoot, 'scripts/voice/kokoro_worker.py')},
      {label: 'Remotion FFmpeg CLI', filePath: path.join(this.repositoryRoot, 'remotion/node_modules/@remotion/cli/remotion-cli.js')},
    ];
    const missing = required.filter(({filePath}) => !existsSync(filePath)).map(({label}) => label);
    return {
      provider: this.id,
      available: missing.length === 0,
      modelVersion: this.modelVersion,
      missing,
      setupCommand: 'powershell -ExecutionPolicy Bypass -File scripts/setup-voice-runtime.ps1',
      licenseSummary: 'kokoro-onnx: MIT; Kokoro-82M model: Apache-2.0. Voice/data attribution remains documented by the upstream model card.',
    };
  }

  async synthesize(input: VoiceSynthesisInput): Promise<VoiceSynthesisResult> {
    const status = this.getRuntimeStatus();
    if (!status.available) throw new Error(`Kokoro runtime is not ready (${status.missing.join(', ')}). Run: ${status.setupCommand}`);
    const preset = this.presets.find(({id}) => id === input.presetId);
    if (!preset) throw new Error(`Unknown Kokoro voice preset: ${input.presetId}`);
    if (input.speed < 0.8 || input.speed > 1.2) throw new Error('Voice speed must be between 0.8 and 1.2.');
    mkdirSync(input.outputDirectory, {recursive: true});
    const dictionary = parsePronunciationNotes(input.pronunciationNotes);
    const normalizedText = normalizeEnglishNarration(input.text, dictionary);
    if (!normalizedText) throw new Error('Narration text is empty after normalization.');
    const textPath = path.join(input.outputDirectory, 'narration.txt');
    const rawPath = path.join(input.outputDirectory, 'kokoro-raw.wav');
    const outputPath = path.join(input.outputDirectory, 'narration-48khz-stereo.wav');
    writeFileSync(textPath, normalizedText, 'utf8');
    const startedAt = Date.now();
    await runProcess(this.pythonExecutable, [
      path.join(this.repositoryRoot, 'scripts/voice/kokoro_worker.py'),
      '--model', path.join(this.runtimeRoot, 'models/kokoro-v1.0.onnx'),
      '--voices', path.join(this.runtimeRoot, 'models/voices-v1.0.bin'),
      '--text-file', textPath,
      '--output', rawPath,
      '--voice', preset.voice,
      '--speed', String(input.speed),
      '--language', preset.language,
    ], {cwd: this.runtimeRoot});
    await runProcess(this.nodeExecutable, [
      path.join(this.repositoryRoot, 'remotion/node_modules/@remotion/cli/remotion-cli.js'),
      'ffmpeg', '-y', '-i', rawPath,
      '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11',
      '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', outputPath,
    ], {
      cwd: this.repositoryRoot,
      env: {...process.env, ELECTRON_RUN_AS_NODE: '1'},
    });
    return {
      outputPath,
      preset,
      normalizedText,
      pronunciationDictionary: dictionary,
      modelVersion: this.modelVersion,
      sampleRate: 48000,
      channels: 2,
      loudnessTargetLufs: -16,
      generationDurationMs: Date.now() - startedAt,
    };
  }
}

export class UnavailableVoiceProvider implements VoiceProvider {
  readonly id = 'KOKORO_ONNX' as const;
  readonly presets = KOKORO_PRESETS;
  getRuntimeStatus(): VoiceRuntimeStatus {
    return {
      provider: this.id,
      available: false,
      modelVersion: '1.0',
      missing: ['Voice provider configuration'],
      setupCommand: 'Configure KokoroOnnxProvider when creating ProjectStore.',
      licenseSummary: 'kokoro-onnx: MIT; Kokoro-82M model: Apache-2.0.',
    };
  }
  async synthesize(): Promise<VoiceSynthesisResult> {
    throw new Error('Local voice provider is not configured.');
  }
}
