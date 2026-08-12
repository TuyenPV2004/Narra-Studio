'use strict';

function deinterleaveStereo(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length % 8 !== 0) {
    throw new Error('Stereo float32 PCM must contain complete interleaved frames.');
  }
  const sampleCount = buffer.length / 8;
  const left = new Float32Array(sampleCount);
  const right = new Float32Array(sampleCount);
  for (let index = 0; index < sampleCount; index += 1) {
    const offset = index * 8;
    left[index] = buffer.readFloatLE(offset);
    right[index] = buffer.readFloatLE(offset + 4);
  }
  return { left, right };
}

function sumStereoTracks(tracks) {
  if (!Array.isArray(tracks) || tracks.length === 0) throw new Error('At least one stereo track is required.');
  const sampleCount = tracks[0].left.length;
  const left = new Float32Array(sampleCount);
  const right = new Float32Array(sampleCount);
  for (const track of tracks) {
    if (track.left.length !== sampleCount || track.right.length !== sampleCount) {
      throw new Error('Audio separation tracks must have matching lengths.');
    }
    for (let index = 0; index < sampleCount; index += 1) {
      left[index] += track.left[index];
      right[index] += track.right[index];
    }
  }
  return { left, right };
}

function normalizeStereoTracksTogether(tracks, ceiling = 0.999) {
  let peak = 0;
  for (const track of tracks) {
    for (let index = 0; index < track.left.length; index += 1) {
      peak = Math.max(peak, Math.abs(track.left[index]), Math.abs(track.right[index]));
    }
  }
  if (peak <= ceiling || peak === 0) return { tracks, gain: 1 };
  const gain = ceiling / peak;
  for (const track of tracks) {
    for (let index = 0; index < track.left.length; index += 1) {
      track.left[index] *= gain;
      track.right[index] *= gain;
    }
  }
  return { tracks, gain };
}

async function writeInterleavedStereo(filePath, stereo, fsImpl = require('fs')) {
  const stream = fsImpl.createWriteStream(filePath);
  const framesPerChunk = 16_384;
  try {
    for (let start = 0; start < stereo.left.length; start += framesPerChunk) {
      const end = Math.min(stereo.left.length, start + framesPerChunk);
      const chunk = Buffer.allocUnsafe((end - start) * 8);
      for (let index = start; index < end; index += 1) {
        const offset = (index - start) * 8;
        chunk.writeFloatLE(stereo.left[index], offset);
        chunk.writeFloatLE(stereo.right[index], offset + 4);
      }
      if (!stream.write(chunk)) await onceDrain(stream);
    }
    stream.end();
    await new Promise((resolve, reject) => {
      stream.once('close', resolve);
      stream.once('error', reject);
    });
  } catch (error) {
    stream.destroy();
    throw error;
  }
}

function onceDrain(stream) {
  return new Promise((resolve, reject) => {
    stream.once('drain', resolve);
    stream.once('error', reject);
  });
}

module.exports = {
  deinterleaveStereo,
  normalizeStereoTracksTogether,
  sumStereoTracks,
  writeInterleavedStereo,
};
