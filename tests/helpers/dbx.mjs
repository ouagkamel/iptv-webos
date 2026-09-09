// tests/helpers/dbx.mjs — préparation d'une base fraîche par test + fabrique de paires.
// NB : indexedDB (fake) est posé par helpers/env.mjs via le --import du harnais,
// avant l'évaluation de tout module src (Dexie le capture à l'import).
import { db } from '../../src/data/db.js';
import { DataManager } from '../../src/data/DataManager.js';
import { ImportController } from '../../src/data/ImportController.js';
import { FakeWorker, WORKERS } from './workerHost.mjs';

export { db };

export async function freshDb() {
  await db.delete();
  await db.open();
  return db;
}

export function makePair(workerKind, targetTable) {
  const worker = new FakeWorker(WORKERS[workerKind]);
  const dataManager = new DataManager(worker, targetTable || 'channels');
  const controller = new ImportController(worker, dataManager);
  return { worker, dataManager, controller };
}

export async function addImportRow(dbx, playlistId, kind) {
  return dbx.imports.add({ playlistId: playlistId, kind: kind, status: 'running', createdAt: Date.now() });
}

export async function addPlaylist(dbx, name, extra) {
  const row = Object.assign({ name: name, updatedAt: Date.now() }, extra || {});
  const id = await dbx.playlists.add(row);
  return id;
}

/** Attend un événement window unique avec matching importId. */
export function onceWindow(type, importId) {
  return new Promise(function (resolve, reject) {
    function handler(e) {
      if (importId != null && (!e.detail || e.detail.importId !== importId)) return;
      window.removeEventListener(type, handler);
      resolve(e.detail || {});
    }
    window.addEventListener(type, handler);
  });
}
