import type {Asset, MediaMetadata} from '@narra/contracts';
import {ALL_FORMATS, FilePathSource, Input} from 'mediabunny';
import {readFileSync, statSync} from 'node:fs';
import path from 'node:path';

const greatestCommonDivisor = (left: number, right: number): number => {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b !== 0) [a, b] = [b, a % b];
  return a || 1;
};

const aspectRatio = (width?: number, height?: number): string | undefined => {
  if (!width || !height) return undefined;
  const divisor = greatestCommonDivisor(width, height);
  return `${width / divisor}:${height / divisor}`;
};

const imageMimeType = (extension: string): string => {
  if (extension === '.png') return 'image/png';
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.svg') return 'image/svg+xml';
  if (extension === '.webp') return 'image/webp';
  return 'application/octet-stream';
};

const jpegDimensions = (buffer: Buffer): {width?: number; height?: number} => {
  let offset = 2;
  const startOfFrameMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  while (offset + 8 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    if (marker === undefined || marker === 0xd9 || marker === 0xda) break;
    const segmentLength = buffer.readUInt16BE(offset + 2);
    if (startOfFrameMarkers.has(marker)) {
      return {height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7)};
    }
    if (segmentLength < 2) break;
    offset += 2 + segmentLength;
  }
  return {};
};

const probeImage = (filePath: string): MediaMetadata => {
  const extension = path.extname(filePath).toLowerCase();
  const buffer = readFileSync(filePath);
  let width: number | undefined;
  let height: number | undefined;

  if (extension === '.png' && buffer.length >= 24) {
    width = buffer.readUInt32BE(16);
    height = buffer.readUInt32BE(20);
  } else if (extension === '.jpg' || extension === '.jpeg') {
    ({width, height} = jpegDimensions(buffer));
  } else if (extension === '.svg') {
    const svg = buffer.toString('utf8');
    const widthMatch = /\bwidth=["']([0-9.]+)/i.exec(svg);
    const heightMatch = /\bheight=["']([0-9.]+)/i.exec(svg);
    const viewBoxMatch = /\bviewBox=["']([^"']+)["']/i.exec(svg);
    const viewBox = viewBoxMatch?.[1]?.trim().split(/[ ,]+/).map(Number);
    width = widthMatch ? Math.round(Number(widthMatch[1])) : viewBox?.[2] ? Math.round(viewBox[2]) : undefined;
    height = heightMatch ? Math.round(Number(heightMatch[1])) : viewBox?.[3] ? Math.round(viewBox[3]) : undefined;
  }

  return {
    format: extension.slice(1).toUpperCase() || 'IMAGE',
    mimeType: imageMimeType(extension),
    width,
    height,
    aspectRatio: aspectRatio(width, height),
    fileSizeBytes: statSync(filePath).size,
    probedAt: new Date().toISOString(),
  };
};

export const probeMedia = async (filePath: string, kind: Asset['kind']): Promise<MediaMetadata> => {
  if (kind === 'IMAGE') return probeImage(filePath);
  if (kind !== 'VIDEO' && kind !== 'AUDIO') {
    throw new Error(`Media probing is not supported for asset kind ${kind}.`);
  }

  const input = new Input({formats: ALL_FORMATS, source: new FilePathSource(filePath)});
  try {
    if (!(await input.canRead())) throw new Error(`Unsupported or unreadable media file: ${path.basename(filePath)}.`);
    const format = await input.getFormat();
    const videoTrack = await input.getPrimaryVideoTrack();
    const audioTrack = await input.getPrimaryAudioTrack();
    if (kind === 'AUDIO' && !audioTrack) throw new Error(`Media file has no readable audio track: ${path.basename(filePath)}.`);
    const durationSec = (await input.getDurationFromMetadata(undefined, {skipLiveWait: true})) ?? undefined;
    const width = videoTrack ? await videoTrack.getDisplayWidth() : undefined;
    const height = videoTrack ? await videoTrack.getDisplayHeight() : undefined;

    return {
      format: format.name,
      mimeType: await input.getMimeType(),
      durationSec,
      width,
      height,
      aspectRatio: aspectRatio(width, height),
      videoCodec: (await videoTrack?.getCodec()) ?? undefined,
      audioCodec: (await audioTrack?.getCodec()) ?? undefined,
      sampleRate: audioTrack ? await audioTrack.getSampleRate() : undefined,
      channels: audioTrack ? await audioTrack.getNumberOfChannels() : undefined,
      fileSizeBytes: statSync(filePath).size,
      probedAt: new Date().toISOString(),
    };
  } finally {
    input.dispose();
  }
};
