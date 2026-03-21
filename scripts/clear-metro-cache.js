#!/usr/bin/env node
const os = require('os');
const path = require('path');
const fs = require('fs');

const cacheDir = path.join(os.tmpdir(), 'metro-cache');

function deleteDir(dirPath) {
  if (!fs.existsSync(dirPath)) return;
  for (const entry of fs.readdirSync(dirPath)) {
    const fullPath = path.join(dirPath, entry);
    if (fs.lstatSync(fullPath).isDirectory()) {
      deleteDir(fullPath);
      fs.rmdirSync(fullPath);
    } else {
      fs.unlinkSync(fullPath);
    }
  }
}

deleteDir(cacheDir);
console.log('Metro cache cleared:', cacheDir);
