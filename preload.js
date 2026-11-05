'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const call = (ch) => (...a) => ipcRenderer.invoke(ch, ...a);

contextBridge.exposeInMainWorld('host', {
  info: call('app:info'),
  ffmpegEncoders: call('ffmpeg:encoders'),
  saveSession: call('session:save'),
  openSession: call('session:open'),
  exportBegin: call('export:begin'),
  exportWrite: call('export:write'),
  exportFrame: call('export:frame'),
  exportPng: call('export:png'),
  exportFinish: call('export:finish'),
  exportAbort: call('export:abort'),
  show: call('shell:show'),
  quit: call('app:quit'),
  fullscreen: call('app:fullscreen'),
  benchWrite: call('bench:write'),
  log: call('log'),
});
