export type AiActivityKind = 'message' | 'search' | 'tool' | 'system' | 'error';

export type AiActivity = {
  id: string;
  kind: AiActivityKind;
  title: string;
  detail: string;
  url?: string;
};

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? value as Record<string, unknown> : {};

const text = (value: unknown): string => typeof value === 'string' ? value : '';

export const getAgentDelta = (event: Record<string, unknown>): string => {
  if (event.type !== 'notification' || event.method !== 'item/agentMessage/delta') return '';
  return text(record(event.params).delta);
};

export const getTurnCompletion = (event: Record<string, unknown>): 'COMPLETED' | 'FAILED' | 'CANCELLED' | null => {
  if (event.type !== 'notification' || event.method !== 'turn/completed') return null;
  const status = text(record(record(event.params).turn).status);
  if (status === 'completed') return 'COMPLETED';
  if (status === 'interrupted') return 'CANCELLED';
  return 'FAILED';
};

export const toAiActivity = (event: Record<string, unknown>, sequence: number): AiActivity | null => {
  if (event.type === 'error') {
    return {id: `error-${sequence}`, kind: 'error', title: 'Codex error', detail: text(event.message) || 'Unknown error'};
  }
  if (event.type === 'status') {
    return {id: `status-${sequence}`, kind: 'system', title: 'Connection', detail: text(event.status) || 'Updated'};
  }
  if (event.type !== 'notification') return null;
  const method = text(event.method);
  const params = record(event.params);
  if (method.startsWith('item/reasoning/')) return null;
  if (method === 'turn/started') {
    return {id: `turn-${sequence}`, kind: 'system', title: 'Run started', detail: 'Codex is working on the prompt.'};
  }
  if (method === 'turn/completed') {
    const turn = record(params.turn);
    return {id: `turn-${sequence}`, kind: text(turn.status) === 'failed' ? 'error' : 'system', title: 'Run finished', detail: text(turn.status) || 'completed'};
  }
  if (method === 'error') {
    return {id: `error-${sequence}`, kind: 'error', title: 'Run error', detail: text(record(params.error).message) || 'Codex reported an error.'};
  }
  if (method === 'warning' || method === 'configWarning') {
    return {id: `warning-${sequence}`, kind: 'error', title: 'Warning', detail: text(params.message) || text(params.summary)};
  }
  if (method === 'item/started' || method === 'item/completed') {
    const item = record(params.item);
    const itemType = text(item.type);
    if (itemType === 'reasoning' || itemType === 'agentMessage' || itemType === 'userMessage') return null;
    if (itemType === 'webSearch') {
      const action = record(item.action);
      const url = text(action.url);
      const query = text(action.query) || text(item.query) || (Array.isArray(action.queries) ? action.queries.join(', ') : 'Web research');
      return {
        id: text(item.id) || `search-${sequence}`,
        kind: 'search',
        title: text(action.type) === 'openPage' ? 'Opened source' : 'Web search',
        detail: url || query,
        ...(url ? {url} : {}),
      };
    }
    const status = method === 'item/completed' ? 'Completed' : 'Started';
    return {
      id: `${text(item.id) || itemType || 'tool'}-${method}-${sequence}`,
      kind: 'tool',
      title: itemType ? itemType.replace(/([A-Z])/g, ' $1').replace(/^./, (value) => value.toUpperCase()) : 'Tool activity',
      detail: status,
    };
  }
  return null;
};

export const summarizeRateLimits = (value: unknown): string => {
  const root = record(value);
  const limits = record(root.rateLimits);
  const primary = record(limits.primary);
  const usedPercent = typeof primary.usedPercent === 'number' ? primary.usedPercent : null;
  if (usedPercent === null) return 'Usage snapshot unavailable';
  return `${Math.round(usedPercent)}% used in the current window`;
};
