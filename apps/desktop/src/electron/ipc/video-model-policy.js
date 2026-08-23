'use strict';

const KNOWN_PAYGATE_TIERS = new Set(['PAYGATE_TIER_ONE', 'PAYGATE_TIER_TWO']);

function requirePaygateTier(userPaygateTier) {
  if (!KNOWN_PAYGATE_TIERS.has(userPaygateTier)) {
    throw new Error('Không xác định được gói tài khoản Google Flow. Vui lòng đồng bộ lại tài khoản trước khi tạo video.');
  }
  return userPaygateTier;
}

function resolveVideoModelKey({ mode, videoModelKey, duration, aspectRatio, userPaygateTier }) {
  let dur = 8;
  if (typeof duration === 'number' && [4, 6, 8, 10].includes(duration)) {
    dur = duration;
  } else if (typeof duration === 'string') {
    const match = duration.match(/^(\d+)s?$/);
    if (match && [4, 6, 8, 10].includes(Number(match[1]))) dur = Number(match[1]);
  } else if (typeof videoModelKey === 'string') {
    const match = videoModelKey.match(/_(\d+)s$/);
    if (match && [4, 6, 8, 10].includes(Number(match[1]))) dur = Number(match[1]);
  }

  const isPortrait = aspectRatio === 'VIDEO_ASPECT_RATIO_PORTRAIT' || aspectRatio === 'portrait';
  const rawKey = typeof videoModelKey === 'string' ? videoModelKey.trim() : '';
  const isAbra = !rawKey || rawKey.startsWith('abra') || rawKey === 'default';
  const isVeo = rawKey.startsWith('veo_');

  switch (mode) {
    case 'image':
      if (isAbra) return `abra_i2v_${dur}s`;
      if (isVeo) {
        const tier = requirePaygateTier(userPaygateTier);
        if (tier === 'PAYGATE_TIER_ONE') {
          return isPortrait ? 'veo_3_1_i2v_s_fast_portrait' : 'veo_3_1_i2v_s_fast';
        }
        if (!rawKey.includes('lite')) {
          throw new Error(`Model ${rawKey} cho Image-to-Video Tier Two chưa được xác minh (yêu cầu tài khoản Tier One); yêu cầu đã dừng để tránh tiêu credit sai.`);
        }
        return 'veo_3_1_i2v_lite_low_priority';
      }
      if (rawKey.includes('t2v')) return rawKey.replace('t2v', 'i2v');
      return rawKey || `abra_i2v_${dur}s`;

    case 'startend':
      if (isAbra) return `abra_i2v_${dur}s`;
      if (isVeo) {
        const tier = requirePaygateTier(userPaygateTier);
        if (tier === 'PAYGATE_TIER_ONE') {
          return isPortrait ? 'veo_3_1_i2v_s_fast_portrait_fl' : 'veo_3_1_i2v_s_fast_fl';
        }
        if (!rawKey.includes('lite')) {
          throw new Error(`Model ${rawKey} cho Start/End Tier Two chưa được xác minh (yêu cầu tài khoản Tier One); yêu cầu đã dừng để tránh tiêu credit sai.`);
        }
        return 'veo_3_1_interpolation_lite_low_priority';
      }
      if (rawKey.includes('t2v')) return rawKey.replace('t2v', 'i2v');
      return rawKey || `abra_i2v_${dur}s`;

    case 'charsync':
    case 'reference':
      if (isAbra) return `abra_r2v_${dur}s`;
      if (isVeo) {
        const tier = requirePaygateTier(userPaygateTier);
        if (tier === 'PAYGATE_TIER_ONE') {
          return isPortrait ? 'veo_3_1_r2v_fast_portrait' : 'veo_3_1_r2v_fast';
        }
        return 'veo_3_1_r2v_fast_landscape_ultra_relaxed';
      }
      if (rawKey.includes('t2v')) return rawKey.replace('t2v', 'r2v');
      return rawKey || `abra_r2v_${dur}s`;

    case 'editvideo':
      if (isAbra || rawKey.includes('t2v') || rawKey.includes('i2v') || rawKey.includes('r2v')) return 'abra_edit';
      return rawKey || 'abra_edit';

    case 'text':
    default:
      if (isAbra) return `abra_t2v_${dur}s`;
      if (isVeo && (rawKey === 'veo_3_1_t2v_lite' || rawKey === 'veo_3_1_t2v_lite_low_priority')) {
        return 'veo_3_1_t2v_lite_low_priority';
      }
      return rawKey || `abra_t2v_${dur}s`;
  }
}

module.exports = { KNOWN_PAYGATE_TIERS, requirePaygateTier, resolveVideoModelKey };
