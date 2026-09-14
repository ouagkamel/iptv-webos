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
- favoris : état vide explicite, car le contrat V20 ne possède pas encore le store favoris.

Les images Unsplash restent uniquement des fallbacks esthétiques lorsque le catalogue réel ne fournit pas de logo. Elles ne représentent aucun contenu IPTV fictif.

## Lancer la preview

```bash
npm install
npm run dev -- --host 0.0.0.0
```

À la validation du formulaire, le profil est écrit dans `IPTVDatabase`, puis l’adaptateur exécute automatiquement la séquence réelle :

1. authentification Xtream ou téléchargement M3U ;
2. import et écriture des chaînes ;
3. import et écriture des films VOD ;
4. import et écriture des séries ;
5. import et écriture de l’EPG XMLTV ;
6. activation des `activeImportId` et `activeEpgImportId` uniquement après écriture réussie.

Les écritures utilisent `bulkAdd` par lots de 2 000, au maximum deux lots en vol, avec respiration entre les lots. Les anciens imports restent protégés pendant le swap et sont supprimés par une purge différée. La modal affiche la phase et la progression. En cas d’erreur EPG, le catalogue déjà importé reste conservé et le message est affiché.

## Installation dans le simulateur webOS

La preview Vite et l’application native V20 sont deux entrées différentes. Le dossier `device-react-v20/` est le paquet installable qui place le build React à la racine (`index.html` + bundle classique ciblé Chromium 68). Il conserve le même `appinfo.id` que V20 afin de retrouver la base `IPTVDatabase` de l’application installée. Il faut installer ce paquet à la place de l’ancien paquet V20, puis relancer l’application.

Le build device n’utilise pas un `<script type="module">` : Vite produit une IIFE et le plugin transforme le script en `defer`, ce qui évite le blocage des modules sur l’origine `file://` du simulateur/webOS.

## Validation

```text
npm install --ignore-scripts  PASS
npm run build                PASS — cible chrome68
MOCK_* dans src              absent
reference/codeui.txt         byte-identique au fichier fourni
```

Cette variante ne modifie aucun fichier de l’application native V20 et ne remplace pas son importeur, son lecteur webOS ou son protocole worker.
