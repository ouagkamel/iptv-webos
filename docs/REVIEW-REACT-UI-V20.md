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
| Favoris | Lecture facultative du store V5 lorsqu’une base plus récente l’expose ; avec V20, l’état vide reste explicite. |
| Images | Logo réel en priorité, fallback Unsplash uniquement pour la présentation lorsqu’aucun logo réel n’existe. |
| Progression de connexion | Remplacée par l’écriture réelle du profil ; aucune progression artificielle d’import n’est simulée. |

## Garde-fous V20

- L’adaptateur ne lit que `activeImportId` et `activeEpgImportId` du profil actif.
- Les catégories V20 sont utilisées pour reconstituer l’ordre serveur avant `sortIdx`.
- Le détail d’une série est lazy et utilise le même endpoint Xtream `get_series_info` que le contrat V20 ; un échec ne bloque pas l’écran.
- Le fichier de référence conservé contient des constantes `MOCK_*`, mais elles ne sont ni importées ni incluses dans `src/` ou le bundle runtime.
- L’import, la purge lazy, le budget de chunks et le lecteur webOS restent ceux du backend V20 ; cette variante ne crée pas de second protocole.
- Aucun contenu fictif n’est ajouté pour remplir une carte manquante.

## Validation attendue

```text
reference/codeui.txt byte-identique       PASS
aucun MOCK_* dans react-ui-v20/src        PASS
npm install --ignore-scripts                PASS
npm run build                               PASS — cible chrome68
```

La validation navigateur/webOS doit être réalisée dans la preview ou le simulateur. Si aucune donnée n’est visible, vérifier que l’origine de la preview possède bien sa propre base `IPTVDatabase` : IndexedDB est isolée par origine.
