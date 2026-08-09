import {contextBridge} from 'electron';

contextBridge.exposeInMainWorld('narra', {
  runtime: 'electron',
  version: 1,
});

