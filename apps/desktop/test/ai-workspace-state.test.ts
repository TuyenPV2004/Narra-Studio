import {describe, expect, it} from 'vitest';
import {getAgentDelta, getTurnCompletion, summarizeRateLimits, toAiActivity} from '../src/renderer/ai-workspace-state.js';

describe('AI workspace event projection', () => {
  it('streams only the agent message delta and maps completion state', () => {
    expect(getAgentDelta({
      type: 'notification', method: 'item/agentMessage/delta', params: {delta: 'Evidence first.'},
    })).toBe('Evidence first.');
    expect(getAgentDelta({
      type: 'notification', method: 'item/reasoning/textDelta', params: {delta: 'private chain'},
    })).toBe('');
    expect(getTurnCompletion({
      type: 'notification', method: 'turn/completed', params: {turn: {status: 'interrupted'}},
    })).toBe('CANCELLED');
  });

  it('projects web searches into source activities and ignores reasoning', () => {
    expect(toAiActivity({
      type: 'notification',
      method: 'item/completed',
      params: {item: {id: 'search-1', type: 'webSearch', action: {type: 'openPage', url: 'https://example.com/source'}}},
    }, 1)).toMatchObject({kind: 'search', title: 'Opened source', url: 'https://example.com/source'});
    expect(toAiActivity({
      type: 'notification', method: 'item/reasoning/summaryTextDelta', params: {delta: 'summary'},
    }, 2)).toBeNull();
  });

  it('summarizes a rate-limit snapshot without exposing account data', () => {
    expect(summarizeRateLimits({rateLimits: {primary: {usedPercent: 17.6}}})).toBe('18% used in the current window');
    expect(summarizeRateLimits({})).toBe('Usage snapshot unavailable');
  });
});
