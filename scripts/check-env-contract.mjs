import fs from 'node:fs';

function keysFrom(file) {
  return new Set(fs.readFileSync(file, 'utf8').split(/\r?\n/)
    .map(line => line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=/)?.[1])
    .filter(Boolean));
}

const example = keysFrom('.env.example');
const local = keysFrom('.env');
const missingFromLocal = [...example].filter(key => !local.has(key));
const missingFromExample = [...local].filter(key => !example.has(key));
const obsolete = [...example, ...local].filter(key => /^(AVIS|KYC|CLOUDFLARE|EZAI|OLLAMA)_/.test(key)
  || ['AI_API_KEY', 'ELEVENLABS_API_KEY', 'GOOGLE_FLOW_API_KEY', 'ITERA102_API_KEY', 'ITERA102_KEY_FILE', 'LIP_SYNC_API_KEY', 'NARRA_STORAGE_ROOT', 'NARRA_WORKSPACE_ROOT', 'NARRA_DATABASE_ROOT', 'NARRA_VOICE_RUNTIME_ROOT', 'NARRA_VOICE_PYTHON', 'NARRA_FLOW_ACCOUNT_SLOTS', 'SYNC_API_KEY', 'VEO3_LIPSYNC_API_KEY'].includes(key));

if (missingFromLocal.length || missingFromExample.length || obsolete.length) {
  console.error(JSON.stringify({ missingFromLocal, missingFromExample, obsolete }, null, 2));
  process.exit(1);
}

console.log(`Environment contract passed (${example.size} keys).`);
