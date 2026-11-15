// Runs after electron-builder copies Electron, before the installer is made.
// Removes dxcompiler.dll (24 MB): it serves only WebGPU. ZeroPy draws with
// WebGL, which uses Direct3D 11 and d3dcompiler_47.dll, so nothing changes.
const fs = require('node:fs');
const path = require('node:path');

exports.default = async function afterPack(context) {
  for (const name of ['dxcompiler.dll', 'dxil.dll']) {
    const file = path.join(context.appOutDir, name);
    if (fs.existsSync(file)) {
      fs.rmSync(file);
      console.log(`  • removed ${name} (WebGPU only, not used)`);
    }
  }
};
