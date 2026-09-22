# Release UI Enact V20 — v20-enact-3.0

Date de build : **22 septembre 2026**.

## Périmètre

Cette révision part de la release V20 réelle (`v20`) et reste exclusivement sur la variante **Enact V20** :

- App ID : `com.iptv.webos.player`
- Version manifest : `3.0.0`
- Tag : `v20-enact-3.0`
- Branche : `react-ui-v20`
- Cible : Chromium 68 / webOS 5+
- Backend : Dexie V4 et catalogues réels V20

La référence UX fournie est conservée sans modification dans `enact-ui-v20/reference/`. Aucun catalogue de démonstration, flux Mux, URL Unsplash, Google Font ajouté ou store Dexie V5 n’est utilisé par cette variante.

## Adaptation du nouveau design Live TV

La vue `enact-ui-v20/src/views/LiveTv/LiveTv.js` reprend la composition de la nouvelle capture :

- fond bleu nuit `#080e19` et panneaux `#0d1625` ;
- navigation IPTV supérieure avec **Chaînes TV** actif ;
- grille desktop `348px | 1fr | 620px` à 1920×1080 ;
- catégories issues des groupes réels, avec compteurs réels ;
- liste centrale virtualisée avec numéro, logo réel, nom, programme, progression et favori ;
- logo de la chaîne sélectionnée réutilisé dans le panneau de détail, sans image distante inventée ;
- EPG courant/suivant et barre de progression issus de l’EPG réel ;
- bouton EPG, guide, lecture et navigation profils réellement branchés ;
- appui OK sur une chaîne réelle connecté au lecteur V20 ;
- raccourcis OSD : OK, navigation verticale, changement de panneau, favoris et retour ;
- état vide explicite si aucun catalogue Live n’est importé.

La vue est affichée directement par `App.js` en plein écran afin de ne pas conserver l’ancien habillage global autour du nouveau menu. Home, Films, Séries, Favoris, Guide, profils, réglages et lecteur restent accessibles.

## Compatibilité et performance

- `VirtualList` et containers Spotlight conservés ;
- aucun rendu de catalogue fictif pour remplir l’écran ;
- animations limitées à `transform` et `opacity` ;
- pas de `backdrop-filter` ni `aspect-ratio` dans la nouvelle vue ;
- layout de repli conservé pour les largeurs plus petites ;
- `device-react-v20/` et `device-enact-v20/` générés depuis le même build Enact ;
- schéma Dexie V4 inchangé.

## Validation

Depuis `enact-ui-v20/` :

```text
npm ci --ignore-scripts --no-audit --no-fund
npm run lint       PASS — 0 erreur, 0 warning
npm run pack-p     PASS — build production Chromium 68
```

Depuis la racine V20 :

```text
npm test           PASS — 90/90 tests
```

Contrôles webOS :

```text
npx --yes --package=@webos-tools/cli@3.2.6 ares-package -c enact-ui-v20/dist
# no problems detected

npx --yes --package=@webos-tools/cli@3.2.6 ares-package -i releases/iptv-webos-enact-v20-3.0.ipk
# com.iptv.webos.player, version 3.0.0, architecture all

npx --yes --package=@webos-tools/cli@3.2.6 ares-package -I releases/iptv-webos-enact-v20-3.0.ipk
# webOS Package Format 2, main index.html
```

La validation sur téléviseur ou simulateur webOS réel reste à effectuer avec une cible disponible.

## Artefacts

| Artefact | Chemin | Taille | SHA-256 |
|---|---|---:|---|
| IPK webOS | `releases/iptv-webos-enact-v20-3.0.ipk` | 2 244 714 octets | `9d7822a6fff19058eea6f20793b802778a02a604500c76696e7628a98c5c37e2` |
| Runtime ZIP | `releases/iptv-webos-enact-v20-3.0.zip` | 2 925 017 octets | `740c569e1a08c1642fc48233e7d3f1deb5ff7bf7e807502f57aef0ab30893154` |
| Source ZIP | `releases/iptv-webos-enact-v20-3.0-source.zip` | 3 317 005 octets | `ff4eeecb61f4281130ad42a895b4478d426b6ab8472127d6fbe3f3b9b21a9a84` |
| Dossier brut `dist/` ZIP | `releases/iptv-webos-enact-v20-3.0-dist.zip` | 18 529 375 octets | `b8bc87e5436ab46b085246f6cd574133f1ce1017b087bd42f06c4fdbbd75f7d5` |
| Manifeste | `releases/iptv-webos-enact-v20-3.0-manifest.json` | 3 094 octets | `db349706e54ed55052713add80ca877b58c352c4d46241532995ca2cde2d165b` |

Dossiers générés :

```text
/home/user/iptv-webos-v20-ui/enact-ui-v20/dist/
/home/user/iptv-webos-v20-ui/device-react-v20/
/home/user/iptv-webos-v20-ui/device-enact-v20/
```

## Installation

```bash
npx --yes --package=@webos-tools/cli@3.2.6 \
  ares-install --device <device-name> releases/iptv-webos-enact-v20-3.0.ipk
npx --yes --package=@webos-tools/cli@3.2.6 \
  ares-launch --device <device-name> com.iptv.webos.player
```

## Publication GitHub

Release publiée sur :

[https://github.com/ouagkamel/iptv-webos/releases/tag/v20-enact-3.0](https://github.com/ouagkamel/iptv-webos/releases/tag/v20-enact-3.0)

Les cinq fichiers du manifeste sont publiés comme assets : IPK, runtime ZIP, source ZIP, archive `dist/` et manifeste.
