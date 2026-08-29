'use strict';

module.exports = function registerMediaVoiceCacheIpc(dependencies) {
  const {
    app,
    ipcMain,
    net,
    path,
    https,
    fs,
  } = dependencies;

const VOICE_ASSET_MIRRORS = {
  'ir-cathedral': {
    filename: 'cathedral-york-minster.wav',
    urls: [
      'https://www.openair.hosted.york.ac.uk/wp-content/uploads/2010/05/yorkminsterstereo.wav',
    ],
  },
  'ir-auditorium': {
    filename: 'auditorium-st-andrews.wav',
    urls: [
      'https://www.openair.hosted.york.ac.uk/wp-content/uploads/2010/02/st-andrews-church.wav',
    ],
  },
  'ir-small-room': {
    filename: 'small-room.wav',
    urls: [
      'https://www.openair.hosted.york.ac.uk/wp-content/uploads/2014/07/small-bedroom.wav',
    ],
  },
  'ir-mermaid': {
    filename: 'mermaid-underwater-chamber.wav',
    urls: [
      'https://www.openair.hosted.york.ac.uk/wp-content/uploads/2017/03/underwater-chamber.wav',
    ],
  },
};

function getVoiceAssetsDir() {
  const dir = path.join(app.getPath('userData'), 'voice-assets');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

ipcMain.handle('list-voice-assets-cached', async () => {
  const dir = getVoiceAssetsDir();
  const result = {};
  for (const [assetId, meta] of Object.entries(VOICE_ASSET_MIRRORS)) {
    const filePath = path.join(dir, meta.filename);
    if (fs.existsSync(filePath)) {
      const stat = fs.statSync(filePath);

      if (stat.size > 2048) {
        result[assetId] = { path: filePath, size: stat.size };
      } else {
        try { fs.unlinkSync(filePath); } catch (_) {  }
      }
    }
  }
  return result;
});

ipcMain.handle('download-voice-asset', async (event, { assetId }) => {
  const meta = VOICE_ASSET_MIRRORS[assetId];
  if (!meta) throw new Error(`Unknown voice asset: ${assetId}`);

  const dir = getVoiceAssetsDir();
  const outPath = path.join(dir, meta.filename);

  if (fs.existsSync(outPath)) {
    const stat = fs.statSync(outPath);
    if (stat.size > 2048) {
      return { path: outPath, size: stat.size };
    }
  }

  const { net } = require('electron');
  const sender = event.sender;

  const tryDownload = (url) => new Promise((resolve, reject) => {
    console.log(`[VOICE-ASSET] Downloading ${assetId} from ${url}`);
    const req = net.request({ url, method: 'GET' });
    req.setHeader('User-Agent', 'NarraStudio/1.0 (voice-asset-fetcher)');
    let totalBytes = 0;
    let bytesDownloaded = 0;
    const chunks = [];

    req.on('response', (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers['location']) {
        const loc = Array.isArray(res.headers['location']) ? res.headers['location'][0] : res.headers['location'];
        return resolve(tryDownload(loc));
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        return reject(new Error(`HTTP ${res.statusCode} from ${url}`));
      }
      const cl = res.headers['content-length'];
      totalBytes = cl ? parseInt(Array.isArray(cl) ? cl[0] : cl, 10) : 0;

      res.on('data', (chunk) => {
        chunks.push(chunk);
        bytesDownloaded += chunk.length;

        if (!sender.isDestroyed() && (bytesDownloaded === chunk.length || Date.now() - (req._lastEmit || 0) > 100)) {
          req._lastEmit = Date.now();
          sender.send('voice-asset-progress', { assetId, bytesDownloaded, totalBytes });
        }
      });
      res.on('end', () => {
        if (!sender.isDestroyed()) {
          sender.send('voice-asset-progress', { assetId, bytesDownloaded, totalBytes: totalBytes || bytesDownloaded });
        }
        resolve(Buffer.concat(chunks));
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });

  let lastErr = null;
  for (const url of meta.urls) {
    try {
      const buffer = await tryDownload(url);
      if (buffer.length < 2048) {
        throw new Error(`Suspicious payload size (${buffer.length} bytes) — treating as failed`);
      }
      fs.writeFileSync(outPath, buffer);
      console.log(`[VOICE-ASSET] Saved ${assetId} → ${outPath} (${(buffer.length / 1024).toFixed(0)} KB)`);
      return { path: outPath, size: buffer.length };
    } catch (err) {
      console.warn(`[VOICE-ASSET] Mirror failed (${url}):`, err.message);
      lastErr = err;
    }
  }
  throw new Error(`All mirrors failed for ${assetId}: ${lastErr?.message || 'unknown error'}`);
});
};
