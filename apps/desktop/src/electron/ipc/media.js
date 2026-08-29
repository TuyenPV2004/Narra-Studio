'use strict';

const registerMediaFfmpegEditIpc = require('./media/ffmpeg-edit');
const registerMediaProjectsIpc = require('./media/projects');
const registerMediaVoiceCacheIpc = require('./media/voice-cache');
const registerMediaFiltersIpc = require('./media/filters');
const registerMediaProbeIpc = require('./media/probe');
const registerDepthAnythingIpc = require('./media/depth-anything');
const registerMediaDemuxIpc = require('./media/demux');
const registerAudioSeparationIpc = require('./media/audio-separation');

module.exports = function registerMediaIpc(dependencies) {
  registerMediaFfmpegEditIpc(dependencies);
  registerMediaProjectsIpc(dependencies);
  registerMediaVoiceCacheIpc(dependencies);
  registerMediaFiltersIpc(dependencies);
  registerMediaProbeIpc(dependencies);
  registerDepthAnythingIpc(dependencies);
  registerMediaDemuxIpc(dependencies);
  registerAudioSeparationIpc(dependencies);
};
