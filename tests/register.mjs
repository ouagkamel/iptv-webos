// tests/register.mjs — prélogue des tests Node (harnais maison, plan Q4) :
// 1) shims DOM minimaux (window/document/rAF) ;
// 2) hooks de résolution pour remplacer 'hls.js' et 'webostvjs' par des stubs
//    (les paquets réels visent le navigateur — inutiles et coûteux en Node).
// fake-indexeddb est importé par les fichiers de test AVANT db.js (side-effect auto).
import { register } from 'node:module';
import './helpers/env.mjs';

register('./loader.mjs', import.meta.url);
