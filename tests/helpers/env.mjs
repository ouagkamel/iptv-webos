// tests/helpers/env.mjs — shims navigateur minimaux pour Node.
// Objectif : exécuter les modules RÉELS (DataManager, ImportController, workers…)
// sans réimplémenter leur logique. window = EventTarget (CustomEvent natif Node 20).
import {
  indexedDB as fakeIndexedDB,
  IDBKeyRange, IDBTransaction, IDBCursorWithValue, IDBCursor, IDBIndex,
  IDBObjectStore, IDBRequest, IDBOpenDBRequest, IDBDatabase, IDBFactory,
  IDBVersionChangeEvent
} from 'fake-indexeddb';

class WindowShim extends EventTarget {}

const win = new WindowShim();
globalThis.window = win;
globalThis.self = globalThis;

// IMPORTANT : posé AVANT tout module src (Dexie capture indexedDB à l'évaluation).
globalThis.indexedDB = fakeIndexedDB;
globalThis.IDBKeyRange = IDBKeyRange;
globalThis.IDBTransaction = IDBTransaction;
globalThis.IDBCursorWithValue = IDBCursorWithValue;
globalThis.IDBCursor = IDBCursor;
globalThis.IDBIndex = IDBIndex;
globalThis.IDBObjectStore = IDBObjectStore;
globalThis.IDBRequest = IDBRequest;
globalThis.IDBOpenDBRequest = IDBOpenDBRequest;
globalThis.IDBDatabase = IDBDatabase;
globalThis.IDBFactory = IDBFactory;
globalThis.IDBVersionChangeEvent = IDBVersionChangeEvent;
win.indexedDB = fakeIndexedDB; // typeof indexedDB !== 'undefined' (garde §3, tests dbx)

globalThis.requestAnimationFrame = function (fn) { return setTimeout(function () { fn(Date.now()); }, 0); };
globalThis.cancelAnimationFrame = function (h) { clearTimeout(h); };

// document minimal : hidden=false (respiration §5.3), body classList, createElement
// pour les composants DOM (VirtualList, PlayerOSD) via tests/helpers/dom.mjs.
import { makeDom } from './dom.mjs';
const dom = makeDom();
globalThis.document = dom.document;
globalThis.__dom = dom;

// MediaSource/SourceBuffer absents → hasMSE false, cohérent (le fallback est testé
// par stub hls.js, pas par un vrai MSE en Node).
win.MediaSource = undefined;
win.SourceBuffer = undefined;

// fetch des fixtures : routeur alimenté par tests/helpers/fixtures.mjs
import { installFetchRouter } from './fetchRouter.mjs';
installFetchRouter(globalThis);
