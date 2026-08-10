/* global process, setTimeout, console */
import {CodexBridge} from '../apps/desktop/dist-electron/codex-bridge.js';

const bridge = new CodexBridge();
let completed = false;
bridge.on('notification', (event) => {
  if (event.method === 'turn/completed') completed = true;
});

try {
  const account = await bridge.readAccount();
  const models = await bridge.listModels();
  await bridge.assertModelAvailable();
  const thread = await bridge.startThread({cwd: process.cwd()});
  await bridge.startTurn({
    threadId: thread.threadId,
    cwd: process.cwd(),
    text: 'Reply with exactly NARRA_U1_OK. Do not call tools and do not modify files.',
  });

  const deadline = Date.now() + 120_000;
  while (!completed && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!completed) throw new Error('Timed out waiting for turn/completed.');

  console.log(JSON.stringify({
    signedIn: account.signedIn,
    targetModelAvailable: models.some(({id}) => id === 'gpt-5.6-sol'),
    completed,
  }));
} finally {
  bridge.close();
}
