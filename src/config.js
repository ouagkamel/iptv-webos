// src/config.js — constantes d'application (Sprint 0).
// NOTE : les modules de référence (ImportController, DataManager, workers) portent
// leurs propres constantes figées par la spec (§5.x, §7.x) — ce fichier alimente
// l'UI et le bootstrap, jamais un recalcul des valeurs opposables.
export const CONFIG = {
  APP_NAME: 'IPTV Player Pro',
  APP_ID: 'com.iptv.webos.player',
  VERSION: '1.0.0',
  // Respiration UI (bornes recommandées, §5.3 impose déjà setTimeout 16 ms hidden)
  UI_BREATHE_HIDDEN_MS: 16,
  // Pagination EPG à l'affichage : fenêtre de lecture
  EPG_WINDOW_MS: 6 * 3600 * 1000,
  // Recherche : plafond de résultats affichés (TV basse conso, §8.2 esprit)
  SEARCH_LIMIT: 200
};

// Playlist Xtream de démarrage demandée pour le device de test.
// ATTENTION : ces identifiants sont embarqués dans l'IPK et ne constituent pas
// un secret. La valeur sert uniquement à éviter une ressaisie au premier boot.
export const DEFAULT_PLAYLIST = {
  name: 'KDFGH — playlist par défaut',
  source: 'xtream',
  base: 'http://kdfgh.com:8080',
  username: 'qmjexhtx',
  password: 'rskxknar'
};
