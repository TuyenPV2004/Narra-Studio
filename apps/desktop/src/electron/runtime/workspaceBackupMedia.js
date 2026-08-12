'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const https = require('https');
const { brand } = require('./brand');

const MAX_REDIRECTS = 6;
const REQUEST_TIMEOUT_MS = 45_000;

function removePartialFile(filePath) {
  return fs.promises.unlink(filePath).catch(error => {
    if (error?.code !== 'ENOENT') throw error;
  });
}

function requestMedia(sourceUrl, destinationPath, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    let parsedUrl;
    try {
      parsedUrl = new URL(sourceUrl);
      if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        throw new Error(`Unsupported media protocol: ${parsedUrl.protocol}`);
      }
    } catch (error) {
      reject(error);
      return;
    }

    const client = parsedUrl.protocol === 'https:' ? https : http;
    const request = client.get(parsedUrl, {
      headers: {
        Accept: '*/*',
        'User-Agent': `${brand.id}-Workspace-Backup/1.0`,
      },
    }, response => {
      const statusCode = Number(response.statusCode || 0);
      const location = response.headers.location;
      if (statusCode >= 300 && statusCode < 400 && location) {
        response.resume();
        if (redirectCount >= MAX_REDIRECTS) {
          reject(new Error(`Too many redirects while downloading ${parsedUrl.hostname}`));
          return;
        }
        const nextUrl = new URL(location, parsedUrl).href;
        resolve(requestMedia(nextUrl, destinationPath, redirectCount + 1));
        return;
      }
      if (statusCode < 200 || statusCode >= 300) {
        response.resume();
        reject(new Error(`HTTP ${statusCode || 'unknown'}`));
        return;
      }

      const output = fs.createWriteStream(destinationPath, { flags: 'w' });
      const checksum = crypto.createHash('sha256');
      let size = 0;
      let settled = false;
      const fail = error => {
        if (settled) return;
        settled = true;
        response.destroy();
        output.destroy();
        reject(error);
      };

      response.on('data', chunk => {
        checksum.update(chunk);
        size += chunk.length;
      });
      response.once('aborted', () => fail(new Error('Media response was interrupted')));
      response.once('error', fail);
      output.once('error', fail);
      output.once('finish', () => {
        if (settled) return;
        settled = true;
        const rawContentType = response.headers['content-type'];
        const contentType = Array.isArray(rawContentType) ? rawContentType[0] : rawContentType || '';
        resolve({
          contentType: String(contentType),
          size,
          sha256: checksum.digest('hex'),
          finalUrl: parsedUrl.href,
        });
      });
      response.pipe(output);
    });

    request.setTimeout(REQUEST_TIMEOUT_MS, () => {
      request.destroy(new Error(`Media download timed out after ${REQUEST_TIMEOUT_MS / 1000}s`));
    });
    request.once('error', reject);
  });
}

async function downloadRemoteMediaToFile(sourceUrl, destinationPath) {
  await removePartialFile(destinationPath);
  try {
    return await requestMedia(sourceUrl, destinationPath);
  } catch (error) {
    await removePartialFile(destinationPath);
    throw error;
  }
}

module.exports = {
  downloadRemoteMediaToFile,
};
