'use strict';

const AUDIO_SEPARATION_MODELS = Object.freeze({
  demucsHtdemucsEmbedded: Object.freeze({
    id: 'htdemucs-embedded',
    displayName: 'Demucs HTDemucs Embedded',
    runtime: 'demucs-web',
    fileName: 'htdemucs_embedded.onnx',
    url: 'https://huggingface.co/timcsy/demucs-web-onnx/resolve/main/htdemucs_embedded.onnx',
    size: 180_534_758,
    sha256: 'e5e425c17683f163a472462eb5f5a4ffcd11c31858d57fbd0833b012d8b88077',
    sampleRate: 44_100,
    outputTracks: Object.freeze(['drums', 'bass', 'other', 'vocals']),
  }),
  uvrMdxNetInstHq3: Object.freeze({
    id: 'uvr-mdx-net-inst-hq-3',
    displayName: 'UVR-MDX-NET-Inst_HQ_3',
    runtime: 'mdx-net-onnx',
    fileName: 'UVR-MDX-NET-Inst_HQ_3.onnx',
    url: 'https://huggingface.co/Politrees/UVR_resources/resolve/536b5b651001fbf49b7c865cd1243b42b35e65a7/MDX_Net_Models/UVR-MDX-NET-Inst_HQ_3.onnx',
    size: 66_759_214,
    sha256: '317554b07fe1ea5279a77f2b1520a41ea4b93432560c4ffd08792c30fddf9adc',
    sampleRate: 44_100,
    inputShape: Object.freeze([1, 4, 3072, 256]),
    nFft: 6144,
    hopLength: 1024,
    dimF: 3072,
    dimT: 8,
    compensation: 1.022,
  }),
});

const DEFAULT_AUDIO_SEPARATION_MODEL = AUDIO_SEPARATION_MODELS.demucsHtdemucsEmbedded;

module.exports = {
  AUDIO_SEPARATION_MODELS,
  DEFAULT_AUDIO_SEPARATION_MODEL,
};
