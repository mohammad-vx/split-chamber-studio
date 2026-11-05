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
  gateDone: call('gate:done'),
  studio: {
    info: call('studio:info'), settings: call('studio:settings'),
    lock: call('library:lock'), unlock: call('library:unlock'), list: call('library:list'), get: call('library:get'),
    writeStatus: call('library:write-status'), update: call('library:update'), usage: call('library:usage'),
    id: call('library:id'), path: call('library:path'), writeFile: call('library:write-file'),
    removeMedia: call('library:remove-media'), remove: call('library:delete'), rejectLog: call('library:reject-log'),
    seenSeeds: call('library:seen-seeds'), queue: call('library:queue'),
    audioReport: call('media:audio'), videoReport: call('media:video'), dhash: call('media:dhash'),
    thumb: call('media:thumb'), quality: call('media:quality'),
    powerBlock: call('power:block'), powerState: call('power:state'), cliDone: call('cli:done'),
  },
});
