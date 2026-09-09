// tests/helpers/workerHost.mjs — exécute le VRAI code des workers (src/data/*.worker.js)
// dans un hôte Node : objet `self` minimal + livraison asynchrone des messages dans
// les deux sens (setTimeout 0), comme un Worker réel. Aucune logique dupliquée.
import fs from 'node:fs';
import path from 'node:path';

export class FakeWorker {
  constructor(srcPath) {
    const code = fs.readFileSync(srcPath, 'utf8');
    const selfObj = {
      onmessage: null,
      postMessage: (data) => {
        setTimeout(() => {
          if (!this._terminated && typeof this.onmessage === 'function') {
            this.onmessage({ data: data });
          }
        }, 0);
      },
      addEventListener: () => {}, removeEventListener: () => {}
    };
    // eslint-disable-next-line no-new-func
    new Function('self', code + '\n//# sourceURL=' + srcPath)(selfObj);
    this._self = selfObj;
    this._terminated = false;
    this.onmessage = null; // posé par DataManager (comme dans le navigateur)
  }
  // main → worker
  postMessage(msg) {
    if (this._terminated) throw new Error('worker terminated');
    const handler = this._self.onmessage;
    setTimeout(() => { if (handler && !this._terminated) handler({ data: msg }); }, 0);
  }
  terminate() { this._terminated = true; }
}

export const WORKERS = {
  m3u: path.join(process.cwd(), 'src/data/m3u.worker.js'),
  epg: path.join(process.cwd(), 'src/data/epg.worker.js'),
  xtream: path.join(process.cwd(), 'src/data/xtream.worker.js')
};
