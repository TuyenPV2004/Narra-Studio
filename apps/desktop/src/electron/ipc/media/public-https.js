'use strict';

const dns = require('node:dns');
const nodeNet = require('node:net');

function remoteSourceError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function isPrivateAddress(address) {
  if (!address) return true;
  const normalized = String(address).toLowerCase().split('%')[0];
  if (nodeNet.isIPv4(normalized)) {
    const octets = normalized.split('.').map(Number);
    return octets[0] === 10
      || octets[0] === 127
      || octets[0] === 0
      || (octets[0] === 169 && octets[1] === 254)
      || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
      || (octets[0] === 192 && octets[1] === 168)
      || (octets[0] === 192 && octets[1] === 0)
      || (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127)
      || (octets[0] === 198 && (octets[1] === 18 || octets[1] === 19))
      || (octets[0] === 198 && octets[1] === 51 && octets[2] === 100)
      || (octets[0] === 203 && octets[1] === 0 && octets[2] === 113)
      || octets[0] >= 224;
  }
  if (nodeNet.isIPv6(normalized)) {
    if (normalized.startsWith('::ffff:')) {
      return isPrivateAddress(normalized.slice('::ffff:'.length));
    }
    return normalized === '::'
      || normalized === '::1'
      || normalized.startsWith('fc')
      || normalized.startsWith('fd')
      || normalized.startsWith('fe8')
      || normalized.startsWith('fe9')
      || normalized.startsWith('fea')
      || normalized.startsWith('feb')
      || normalized.startsWith('2001:db8:');
  }
  return true;
}

function parsePublicHttpsUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw remoteSourceError('INVALID_SOURCE', 'Nguồn video không phải đường dẫn local hoặc HTTPS hợp lệ.');
  }
  if (parsed.protocol !== 'https:') {
    throw remoteSourceError('UNSAFE_REMOTE_SOURCE', 'Chỉ hỗ trợ nguồn video từ HTTPS.');
  }
  if (parsed.username || parsed.password) {
    throw remoteSourceError('UNSAFE_REMOTE_SOURCE', 'URL video không được chứa thông tin đăng nhập.');
  }
  if (!parsed.hostname || parsed.hostname.toLowerCase() === 'localhost') {
    throw remoteSourceError('UNSAFE_REMOTE_SOURCE', 'Không cho phép tải video từ địa chỉ nội bộ.');
  }
  if (nodeNet.isIP(parsed.hostname) && isPrivateAddress(parsed.hostname)) {
    throw remoteSourceError('UNSAFE_REMOTE_SOURCE', 'Không cho phép tải video từ địa chỉ nội bộ.');
  }
  return parsed;
}

function normalizePublicRecords(records) {
  const normalized = records.map(record => ({
    address: String(record?.address || ''),
    family: Number(record?.family),
  }));
  if (
    !normalized.length
    || normalized.some(record => ![4, 6].includes(record.family) || isPrivateAddress(record.address))
  ) {
    throw remoteSourceError('UNSAFE_REMOTE_SOURCE', 'Tên miền video trỏ tới địa chỉ nội bộ hoặc không hợp lệ.');
  }
  return normalized;
}

async function resolvePublicAddresses(hostname, lookup = dns.promises.lookup) {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return normalizePublicRecords(records);
}

function createPinnedLookup(records) {
  const vetted = normalizePublicRecords(records);
  return (_hostname, rawOptions, callback) => {
    const options = typeof rawOptions === 'number'
      ? { family: rawOptions }
      : rawOptions || {};
    const requestedFamily = Number(options.family) || 0;
    const eligible = requestedFamily
      ? vetted.filter(record => record.family === requestedFamily)
      : vetted;
    if (!eligible.length) {
      const error = remoteSourceError('ENOTFOUND', 'Không tìm thấy địa chỉ IP public phù hợp cho nguồn video.');
      callback(error);
      return;
    }
    if (options.all) {
      callback(null, eligible.map(record => ({ ...record })));
      return;
    }
    callback(null, eligible[0].address, eligible[0].family);
  };
}

module.exports = {
  createPinnedLookup,
  isPrivateAddress,
  normalizePublicRecords,
  parsePublicHttpsUrl,
  resolvePublicAddresses,
};
