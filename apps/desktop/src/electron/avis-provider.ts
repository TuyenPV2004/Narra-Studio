import {mkdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import type {AvisGenerationRequest, AvisGenerationResult, AvisStatus} from './provider-types.js';

type FetchLike = typeof fetch;

const unwrap = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object') return {};
  const record = value as Record<string, unknown>;
  if (record.success === true && record.data && typeof record.data === 'object') return record.data as Record<string, unknown>;
  return record;
};

const asText = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null;

const hostRoot = (apiBase: string): string => apiBase
  .trim()
  .replace(/\/+$/, '')
  .replace(/\/chat\/completions$/i, '')
  .replace(/\/api\/(openai|anthropic|gemini)(\/v1(?:beta)?)?$/i, '')
  .replace(/\/api\/v1$/i, '')
  .replace(/\/+$/, '');

export class AvisProvider {
  private readonly apiBase: string;
  private readonly apiKey: string;
  private readonly fetchImpl: FetchLike;

  constructor(options: {apiBase?: string; apiKey?: string; fetchImpl?: FetchLike} = {}) {
    this.apiBase = (options.apiBase || process.env.AVIS_API_BASE || 'https://api.avis.xyz').replace(/\/+$/, '');
    this.apiKey = (options.apiKey || process.env.AVIS_API_KEY || '').trim();
    this.fetchImpl = options.fetchImpl || fetch;
  }

  status(): AvisStatus {
    return {configured: Boolean(this.apiKey), apiBase: this.apiBase, keySource: this.apiKey ? 'environment' : 'none'};
  }

  async listModels(): Promise<unknown[]> {
    const data = await this.request('/api/v1/ai/models', {method: 'GET'});
    const models = Array.isArray(data) ? data : Array.isArray(data.models) ? data.models : [];
    return models;
  }

  async generate(input: AvisGenerationRequest): Promise<AvisGenerationResult> {
    if (!this.apiKey) throw new Error('AVIS_API_KEY chưa được cấu hình trong môi trường chạy Narra.');
    if (!input.prompt.trim()) throw new Error('Avis prompt không được để trống.');
    mkdirSync(input.outputDirectory, {recursive: true});
    return input.kind === 'IMAGE' ? this.generateImage(input) : this.generateVideo(input);
  }

  private async generateImage(input: AvisGenerationRequest): Promise<AvisGenerationResult> {
    const model = input.model?.trim() || 'gpt-image-2';
    const content: Array<Record<string, unknown>> = [{type: 'text', text: input.prompt.trim()}];
    for (const value of [input.firstFrameDataUrl, input.lastFrameDataUrl, input.referenceImageDataUrl]) {
      if (value) content.push({type: 'imageBase64', data: value});
    }
    const created = await this.request('/api/v1/image/generations/async', {
      method: 'POST',
      body: JSON.stringify({model, prompt: input.prompt.trim(), content, ...(input.size ? {size: input.size} : {})}),
    });
    const jobId = asText(created.generationId) || asText(created.id);
    if (!jobId) throw new Error('Avis không trả về generationId cho tác vụ ảnh.');
    const completed = await this.poll(`/api/v1/image/generations/async/${encodeURIComponent(jobId)}`);
    const images = Array.isArray(completed.images) ? completed.images as Array<Record<string, unknown>> : [];
    const sourceUrl = asText(images[0]?.downloadUrl) || asText(images[0]?.url) || asText(completed.outputUrl);
    if (!sourceUrl) throw new Error('Avis hoàn tất tác vụ nhưng không trả URL ảnh.');
    const outputPath = await this.download(sourceUrl, input.outputDirectory, `${input.assetId}-${randomUUID()}.png`);
    return {provider: 'AVIS', jobId, model, outputPath, sourceUrl};
  }

  private async generateVideo(input: AvisGenerationRequest): Promise<AvisGenerationResult> {
    const model = input.model?.trim() || 'veo-3.1';
    const content: Array<Record<string, unknown>> = [{type: 'text', text: input.prompt.trim()}];
    if (input.firstFrameDataUrl) content.push({type: 'imageBase64', data: input.firstFrameDataUrl, role: 'firstFrame'});
    if (input.lastFrameDataUrl) content.push({type: 'imageBase64', data: input.lastFrameDataUrl, role: 'lastFrame'});
    if (input.referenceImageDataUrl) content.push({type: 'imageBase64', data: input.referenceImageDataUrl, role: 'referenceImage'});
    const created = await this.request('/api/v1/video/generations', {
      method: 'POST',
      body: JSON.stringify({
        model,
        content,
        ...(input.durationSec ? {duration: Math.round(input.durationSec)} : {}),
        ...(input.ratio ? {ratio: input.ratio} : {}),
        watermark: false,
      }),
    });
    const jobId = asText(created.taskId) || asText(created.id);
    if (!jobId) throw new Error('Avis không trả về taskId cho tác vụ video.');
    const completed = await this.poll(`/api/v1/video/tasks/${encodeURIComponent(jobId)}`);
    const sourceUrl = asText(completed.videoUrl) || asText(completed.downloadUrl) || asText(completed.outputUrl);
    if (!sourceUrl) throw new Error('Avis hoàn tất tác vụ nhưng không trả URL video.');
    const outputPath = await this.download(sourceUrl, input.outputDirectory, `${input.assetId}-${randomUUID()}.mp4`);
    return {provider: 'AVIS', jobId, model, outputPath, sourceUrl};
  }

  private async poll(route: string): Promise<Record<string, unknown>> {
    const deadline = Date.now() + 30 * 60 * 1000;
    while (Date.now() < deadline) {
      const value = await this.request(route, {method: 'GET'});
      const status = String(value.status || value.state || '').toUpperCase();
      if (['COMPLETED', 'SUCCEEDED', 'SUCCESS', 'DONE'].includes(status)) return value;
      if (['FAILED', 'ERROR', 'CANCELLED'].includes(status)) {
        throw new Error(asText(value.error) || asText(value.message) || `Avis job kết thúc với trạng thái ${status}.`);
      }
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
    throw new Error('Avis job quá thời gian chờ 30 phút.');
  }

  private async download(url: string, directory: string, fileName: string): Promise<string> {
    const response = await this.fetchImpl(url, {headers: {Authorization: `Bearer ${this.apiKey}`}});
    if (!response.ok) throw new Error(`Không thể tải Avis output: HTTP ${response.status}.`);
    const outputPath = path.join(directory, fileName);
    writeFileSync(outputPath, Buffer.from(await response.arrayBuffer()));
    return outputPath;
  }

  private async request(route: string, init: RequestInit): Promise<Record<string, unknown>> {
    const response = await this.fetchImpl(`${hostRoot(this.apiBase)}${route}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        ...(init.headers || {}),
      },
    });
    const text = await response.text();
    const body: unknown = (() => {
      try { return text ? JSON.parse(text) : {}; }
      catch { return {message: text}; }
    })();
    const data = unwrap(body);
    if (!response.ok) throw new Error(asText(data.message) || asText(data.error) || `Avis API HTTP ${response.status}.`);
    return data;
  }
}
