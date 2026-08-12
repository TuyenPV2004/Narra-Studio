/**
 * pitch-shifter.js — granular AudioWorklet pitch shifter.
 *
 * Why this exists:
 *   The Voice Changer's headline effect is pitch shift (Chipmunk +7 st,
 *   Movie Announcer -4 st, etc.). Web Audio has no built-in pitch shifter
 *   for streaming MediaElement sources — `AudioBufferSourceNode.detune`
 *   only works on pre-decoded buffers, and BiquadFilters can only EQ. So
 *   we run a small SOLA (Synchronous Overlap-Add) processor in an
 *   AudioWorklet to shift pitch in real time on the live <video> audio.
 *
 * Algorithm (granular SOLA):
 *   - Maintain a circular buffer of recent input samples.
 *   - Read TWO grains at a pitch-shifted rate (faster = higher pitch),
 *     half a grain apart, with Hann windows.
 *   - Sum the windowed grains. The overlap masks the discontinuities
 *     introduced by reading at a different rate from a fixed write rate.
 *
 * Quality is "good enough for live preview" — there are some artifacts
 * outside ±5 semitones but the character of the effect comes through
 * clearly. The actual export uses FFmpeg `asetrate+atempo` which is
 * sample-accurate.
 *
 * Parameter:
 *   pitch — playback rate ratio (2^(semitones/12)). 1.0 = bypass.
 */
class PitchShifter extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {
        name: 'pitch',
        defaultValue: 1.0,
        minValue: 0.25,   // -2 octaves
        maxValue: 4.0,    // +2 octaves
        automationRate: 'k-rate',
      },
    ];
  }

  constructor() {
    super();
    // Grain size — ~23 ms at 44.1 kHz. Smaller = more artifacts on low
    // pitches but lower latency.
    this.grainSize = 1024;
    // Circular buffer holds 8 grains so the read pointers always have
    // valid data even when the write pointer wraps.
    this.bufSize = this.grainSize * 8;
    this.buf = [
      new Float32Array(this.bufSize),
      new Float32Array(this.bufSize),
    ];
    this.writeIdx = 0;
    // Two read pointers offset by half a grain — when one is fading out,
    // the other is fading in, hiding seams.
    this.readIdxA = 0;
    this.readIdxB = this.grainSize / 2;
    // Pre-compute Hann window. Centered around mid-grain, zero at edges.
    this.window = new Float32Array(this.grainSize);
    for (let i = 0; i < this.grainSize; i++) {
      this.window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (this.grainSize - 1)));
    }
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!output || !output[0]) return true;
    const blockSize = output[0].length;
    if (!input || !input[0]) {
      // No input (yet) — emit silence but keep the processor alive.
      for (let ch = 0; ch < output.length; ch++) output[ch].fill(0);
      return true;
    }
    const pitch = parameters.pitch[0];
    const numCh = Math.min(input.length, output.length);

    // Bypass fast-path when no pitch shift requested. Keeps CPU low and
    // avoids artifacts on the "Original" preset.
    if (Math.abs(pitch - 1.0) < 0.005) {
      for (let ch = 0; ch < output.length; ch++) {
        const inCh = input[ch] || input[0];
        if (inCh) output[ch].set(inCh);
        // Still update write pointer so the buffer stays current for when
        // pitch changes back to non-bypass.
      }
      // Fast path: still advance the write pointer so the buffer stays warm.
      for (let i = 0; i < blockSize; i++) {
        for (let ch = 0; ch < numCh; ch++) {
          this.buf[ch][this.writeIdx] = (input[ch] || input[0])[i];
        }
        this.writeIdx = (this.writeIdx + 1) % this.bufSize;
      }
      return true;
    }

    for (let i = 0; i < blockSize; i++) {
      // Write current sample into the circular buffer.
      for (let ch = 0; ch < numCh; ch++) {
        this.buf[ch][this.writeIdx] = (input[ch] || input[0])[i];
      }

      // Two phase-offset read pointers, each windowed and summed. The
      // windows together approximate constant unity overlap — output level
      // stays roughly the same as input.
      for (let ch = 0; ch < output.length; ch++) {
        const buf = this.buf[ch] || this.buf[0];

        // Pointer A
        const aFloor = Math.floor(this.readIdxA);
        const aFrac = this.readIdxA - aFloor;
        const aWin = this.window[Math.floor((this.readIdxA % this.grainSize + this.grainSize) % this.grainSize)];
        const a0 = buf[aFloor % this.bufSize];
        const a1 = buf[(aFloor + 1) % this.bufSize];
        const aSample = (a0 + (a1 - a0) * aFrac) * aWin;

        // Pointer B
        const bFloor = Math.floor(this.readIdxB);
        const bFrac = this.readIdxB - bFloor;
        const bWin = this.window[Math.floor((this.readIdxB % this.grainSize + this.grainSize) % this.grainSize)];
        const b0 = buf[bFloor % this.bufSize];
        const b1 = buf[(bFloor + 1) % this.bufSize];
        const bSample = (b0 + (b1 - b0) * bFrac) * bWin;

        // Sum. Hann windows half-overlapped sum to ~1.0 average — no extra
        // gain compensation needed.
        output[ch][i] = aSample + bSample;
      }

      // Advance read pointers at pitch-shifted rate. Faster = higher pitch.
      this.readIdxA += pitch;
      this.readIdxB += pitch;

      // Wrap pointers within the circular buffer. Also reset their grain
      // phase so the windowing stays aligned to grain boundaries.
      if (this.readIdxA >= this.bufSize) this.readIdxA -= this.bufSize;
      if (this.readIdxB >= this.bufSize) this.readIdxB -= this.bufSize;

      // Advance the write pointer at the source's natural rate.
      this.writeIdx = (this.writeIdx + 1) % this.bufSize;

      // Keep the read pointers from drifting too far behind the write
      // pointer (otherwise we'd read empty buffer once the writer laps the
      // reader). Pull them forward to stay ~3 grains behind write.
      const desiredLagA = (this.writeIdx - this.grainSize * 3 + this.bufSize) % this.bufSize;
      const distA = (this.readIdxA - desiredLagA + this.bufSize) % this.bufSize;
      if (distA > this.bufSize / 2) {
        // We've lapped; snap back gently.
        this.readIdxA = desiredLagA;
        this.readIdxB = (desiredLagA + this.grainSize / 2) % this.bufSize;
      }
    }
    return true;
  }
}

registerProcessor('pitch-shifter', PitchShifter);
