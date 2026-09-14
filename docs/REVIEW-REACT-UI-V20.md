# Revue — UI fournie adaptée au backend V20

**Base exacte :** release `v20`, commit `9cd8ddf85490be0360490bb05aa29ad71c1528ea`
**Référence visuelle :** `react-ui-v20/reference/codeui.txt`
**Date :** 2026-09-14

## Décision de périmètre

La référence utilisateur est conservée byte par byte dans `reference/codeui.txt`. Elle n’est pas réécrite. Une variante React distincte reprend sa composition visuelle et reçoit les données via `src/iptvDb.js`, sans ajouter de données de démonstration au runtime.

Le cœur natif V20 — `src/app.js`, les workers, `PlaylistManager`, `DataManager`, `MediaAdapter` et le protocole d’import — n’est pas modifié par cette variante.

## Correspondance UI → backend

| UI de la référence | Adaptation réelle |
|---|---|
| Écran profils | Lecture de `playlists` et création d’un vrai profil Xtream/M3U dans `IPTVDatabase`. |
| Grille chaînes | Store `channels` de l’import actif, `streamUrl` réel, catégories V20 et ordre `sortIdx`. |
| Lecteur live | `<video>` natif avec le `streamUrl` persistant ; aucun flux de démo. |
| Guide TV | Store `epg` filtré par `activeEpgImportId`, programmes et heures XMLTV réels. |
| Films | Store `vod` de l’import actif ; état vide explicite si aucune donnée. |
| Séries | Store `series`, cache `series_info`, état vide explicite si le fournisseur ne fournit pas de séries. |
| Favoris | État vide explicite ; le contrat V20 ne possède pas encore de store favoris. |
| Images | Logo réel en priorité, fallback Unsplash uniquement pour la présentation lorsqu’aucun logo réel n’existe. |
| Progression de connexion | Remplacée par l’écriture réelle du profil ; aucune progression artificielle d’import n’est simulée. |

## Garde-fous V20

- L’adaptateur ne lit que `activeImportId` et `activeEpgImportId` du profil actif.
- Les catégories V20 sont utilisées pour reconstituer l’ordre serveur avant `sortIdx`.
- Le détail d’une série est lazy et utilise le même endpoint Xtream `get_series_info` que le contrat V20 ; un échec ne bloque pas l’écran.
- Le fichier de référence conservé contient des constantes `MOCK_*`, mais elles ne sont ni importées ni incluses dans `src/` ou le bundle runtime.
- L’import, la purge lazy, le budget de chunks et le lecteur webOS restent ceux du backend V20 ; cette variante ne crée pas de second protocole.
- Aucun contenu fictif n’est ajouté pour remplir une carte manquante.

## Preview et paquet simulateur

La preview Vite sert `react-ui-v20/dist` sur `localhost:5173`. Elle ne change pas le paquet natif lancé par le simulateur. Pour obtenir le même rendu dans le simulateur, `device-react-v20/` place le bundle React à la racine de l’application, conserve le même `appinfo.id` (`com.iptv.webos.player`) et utilise un script classique IIFE au lieu d’un module ES.

Le paquet device doit remplacer l’installation V20 précédente, puis l’application doit être relancée. Le même identifiant permet de conserver l’origine et la base IndexedDB V20 ; une installation sous un autre identifiant ne verrait pas les mêmes profils.

## Validation exécutée

```text
reference/codeui.txt byte-identique       PASS
aucun MOCK_* dans react-ui-v20/src        PASS
npm install --ignore-scripts                PASS
npm run build                               PASS — React, IIFE, script defer, cible chrome68
npm run gate:syntax (backend V20)           PASS — 25 fichiers
npm test (backend V20)                      PASS — 90/90
package device-react-v20                    PASS — index + bundle + appinfo
```

Si aucune donnée n’est visible, vérifier que l’installation conserve bien `com.iptv.webos.player` : IndexedDB est isolée par origine.
