import {describe, expect, it, vi} from 'vitest';
import {AvisProvider} from '../src/electron/avis-provider.js';

describe('AvisProvider', () => {
  it('reports configuration without exposing the API key', () => {
    const provider = new AvisProvider({apiBase: 'https://api.avis.xyz/', apiKey: 'secret-value'});
    expect(provider.status()).toEqual({
      configured: true,
      apiBase: 'https://api.avis.xyz',
      keySource: 'environment',
    });
    expect(JSON.stringify(provider.status())).not.toContain('secret-value');
  });

  it('uses the native Avis model endpoint and bearer authorization', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({success: true, data: {models: [{id: 'veo-3.1'}]}}), {
      status: 200,
      headers: {'Content-Type': 'application/json'},
    }));
    const provider = new AvisProvider({apiBase: 'https://api.avis.xyz/api/v1', apiKey: 'test-key', fetchImpl});

    await expect(provider.listModels()).resolves.toEqual([{id: 'veo-3.1'}]);
    expect(fetchImpl).toHaveBeenCalledWith('https://api.avis.xyz/api/v1/ai/models', expect.objectContaining({
      headers: expect.objectContaining({Authorization: 'Bearer test-key'}),
    }));
  });
});
