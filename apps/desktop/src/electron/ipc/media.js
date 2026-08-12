'use strict';

const registerMediaFfmpegEditIpc = require('./media/ffmpeg-edit');
const registerMediaProjectsIpc = require('./media/projects');
const registerMediaVoiceCacheIpc = require('./media/voice-cache');
const registerMediaFiltersIpc = require('./media/filters');
const registerMediaProbeIpc = require('./media/probe');
const registerDepthAnythingIpc = require('./media/depth-anything');
const registerMediaDemuxIpc = require('./media/demux');
const registerAudioSeparationIpc = require('./media/audio-separation');

/**
 * Local media processing IPC (FFmpeg, ffprobe, file dialogs).
 *
 * Handler groups live in `electron/ipc/media/`:
 *   ffmpeg-edit.js  concat / trim / duration
 *   projects.js     video project files, media pickers, delete
 *   voice-cache.js  voice-changer IR asset cache
 *   filters.js      apply-video-filters (the CapCut export pipeline)
 *   probe.js        extract / ffprobe info / OS dialogs
 */
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
