'use strict';

importScripts('protocol.js');

const BRIDGE_URL = 'ws://127.0.0.1:17773';
const RETRY_DELAYS_MS = Object.freeze([1000, 2000, 5000, 10000]);
const FLOW_ORIGIN = 'https://labs.google';

let socket = null;
let retryIndex = 0;
let retryTimer = null;

function send(message) {
  if (socket?.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify(message));
  return true;
}

function getFlowProjectSegments(pathname) {
  const segments = pathname.split('/').filter(Boolean);
  if (segments[0] !== 'fx') return null;
  const toolsIndex = segments[1] === 'tools' ? 1 : 2;
  if (segments[toolsIndex] !== 'tools' || segments[toolsIndex + 1] !== 'flow') return null;
  return segments.slice(toolsIndex + 2);
}

function getFlowTabState(tab) {
  try {
    const url = new URL(tab.url || '');
    if (url.origin !== FLOW_ORIGIN) return null;
    const projectSegments = getFlowProjectSegments(url.pathname);
    if (!projectSegments) return null;
    return {
      tab,
      labsProjectOpen: projectSegments.length > 0,
    };
  } catch {
    return null;
  }
}

async function getFlowStatus() {
  const tabs = await chrome.tabs.query({url: 'https://labs.google/*'});
  const flowTabs = tabs.map(getFlowTabState).filter(Boolean);
  const selected = flowTabs.find(item => item.labsProjectOpen && item.tab.active)
    || flowTabs.find(item => item.labsProjectOpen)
    || flowTabs.find(item => item.tab.active)
    || flowTabs[0]
    || null;
  return {
    labsTabOpen: flowTabs.length > 0,
    labsProjectOpen: !!selected?.labsProjectOpen,
    labsTabUrl: selected?.tab.url || null,
    selectedTabId: selected?.tab.id ?? null,
  };
}

async function sendStatus() {
  try {
    const status = await getFlowStatus();
    send({
      type: 'status',
      labsTabOpen: status.labsTabOpen,
      labsProjectOpen: status.labsProjectOpen,
      labsTabUrl: status.labsTabUrl,
    });
  } catch {
    send({type: 'status', labsTabOpen: false, labsProjectOpen: false, labsTabUrl: null});
  }
}

async function requestPageToken(action) {
  const status = await getFlowStatus();
  if (!status.labsProjectOpen || !Number.isSafeInteger(status.selectedTabId)) {
    throw new Error('Google Flow project is not open');
  }
  const target = {tabId: status.selectedTabId};
  await chrome.scripting.executeScript({
    target,
    world: 'MAIN',
    files: ['page-token.js'],
  });
  const results = await chrome.scripting.executeScript({
    target,
    world: 'MAIN',
    args: [action],
    func: async (requestedAction) => (
      globalThis.NarraCaptchaPageToken.requestToken(requestedAction)
    ),
  });
  const token = results?.[0]?.result;
  if (typeof token !== 'string' || token.length <= 20) {
    throw new Error('reCAPTCHA token unavailable');
  }
  return token;
}

async function handleMessage(raw) {
  const message = NarraCaptchaProtocol.parseBridgeMessage(raw);
  if (!message) return;
  if (message.type === 'ping') {
    send({type: 'pong', t: message.t});
    return;
  }
  if (message.type !== 'captcha_request') return;

  const responseId = Number.isSafeInteger(message.id) && message.id > 0 ? message.id : null;
  try {
    const request = NarraCaptchaProtocol.validateCaptchaRequest(message);
    const token = await requestPageToken(request.action);
    send({type: 'captcha_response', id: request.id, token});
  } catch (error) {
    if (responseId !== null) {
      send({
        type: 'captcha_response',
        id: responseId,
        error: NarraCaptchaProtocol.toSafeError(error),
      });
    }
  }
}

function scheduleReconnect() {
  if (retryTimer !== null) clearTimeout(retryTimer);
  const delay = RETRY_DELAYS_MS[Math.min(retryIndex, RETRY_DELAYS_MS.length - 1)];
  retryIndex += 1;
  retryTimer = setTimeout(connect, delay);
}

function connect() {
  const client = new WebSocket(BRIDGE_URL);
  socket = client;
  client.onopen = () => {
    if (socket !== client) return;
    retryIndex = 0;
    send({
      type: 'hello',
      client: 'narra-captcha-bridge',
      version: NarraCaptchaProtocol.VERSION,
    });
    void sendStatus();
  };
  client.onmessage = event => {
    if (socket === client) void handleMessage(event.data);
  };
  client.onclose = () => {
    if (socket !== client) return;
    socket = null;
    scheduleReconnect();
  };
  client.onerror = () => client.close?.();
}

for (const event of [
  chrome.tabs.onActivated,
  chrome.tabs.onCreated,
  chrome.tabs.onRemoved,
  chrome.tabs.onUpdated,
]) {
  event.addListener(() => void sendStatus());
}

connect();
