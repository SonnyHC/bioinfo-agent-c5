'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bioInfoBuddyDesktop', {
  platform: process.platform === 'win32' ? 'windows' : 'macos',
  installEnvironment: id => ipcRenderer.invoke('environment:install', id),
});
