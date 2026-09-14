# VisionTV React Glass UI — backend V20

Variante séparée basée sur la **release native V20** (`9cd8ddf`) et adaptée à la référence UI fournie dans `reference/codeui.txt`.

## Règle de conservation de la référence

Le fichier `reference/codeui.txt` est une copie byte-identique du fichier fourni par l’utilisateur. Il n’est pas modifié et n’est pas importé par le bundle. Le runtime React reprend sa composition visuelle, ses surfaces glassmorphism, ses couleurs, ses états TV et ses fallbacks visuels, mais remplace les données et les transitions fictives par l’adaptateur réel.

## Backend utilisé

`src/iptvDb.js` ouvre la base `IPTVDatabase` du backend V20 :

- profils `playlists` réels ;
- imports actifs via `activeImportId` ;
- chaînes `channels` avec `streamUrl` ;
- films `vod` avec `streamUrl` ;
- séries `series` et cache lazy `series_info` ;
- catégories serveur V20, avec l’ordre du backend ;
- EPG XMLTV via `activeEpgImportId` ;
- favoris V5 lus seulement si la base les expose, sans dépendance pour V20.

Les images Unsplash restent uniquement des fallbacks esthétiques lorsque le catalogue réel ne fournit pas de logo. Elles ne représentent aucun contenu IPTV fictif.

## Lancer la preview

```bash
npm install
npm run dev -- --host 0.0.0.0
```

Le profil et les catalogues doivent déjà exister dans `IPTVDatabase` sur la même origine. La création du profil écrit un vrai profil Dexie ; l’import V20 reste celui du backend natif, conformément au choix de ne pas réimplémenter l’import dans cette variante UI.

## Validation

```text
npm install --ignore-scripts  PASS
npm run build                PASS — cible chrome68
MOCK_* dans src              absent
reference/codeui.txt         byte-identique au fichier fourni
```

Cette variante ne modifie aucun fichier de l’application native V20 et ne remplace pas son importeur, son lecteur webOS ou son protocole worker.
