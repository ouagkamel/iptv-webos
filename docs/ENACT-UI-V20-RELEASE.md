# Release UI Enact V20 — v20-enact-2.0

Date de validation du build : **21 septembre 2026**.

## Périmètre

Cette release concerne exclusivement la variante **Enact V20**, le backend V20 réel et l’identifiant webOS conservé :

- App ID : `com.iptv.webos.player`
- Version manifest : `2.0.0`
- Tag : `v20-enact-2.0`
- Branche : `react-ui-v20`
- Cible : Chromium 68 / webOS 5+
- Références UX copiées sans modification : `enact-ui-v20/reference/markdown_v20.10.md` et `enact-ui-v20/reference/live-tv-design-v20.png`

Les références utilisateur servent uniquement de référence UX. Aucun écran de démonstration, catalogue fictif, URL Unsplash, flux Mux, Google Font ou donnée inventée n’est embarqué dans le runtime.

## Live TV livré

`enact-ui-v20/src/views/LiveTv/LiveTv.js` et `LiveTv.module.less` livrent une vue plein écran bleu nuit, activée directement par `App.js` sans le rail/header global historique :

- navigation IPTV supérieure avec **Chaînes TV** actif ;
- grille `348px | 1fr | 620px` à 1920×1080 ;
- catégories dérivées des groupes réels du catalogue ;
- chaînes virtualisées avec numéro, logo réel, fallback d’initiales, nom, qualité et favori ;
- programme courant, progression et prochain programme depuis l’EPG réel ;
- états vides explicites sans remplissage artificiel ;
- boutons de lecture et guide reliés au lecteur/Guide V20 ;
- profils, Films, Séries, Favoris, Paramètres et retour Home conservés ;
- navigation Spotlight/Sandstone et raccourcis OSD télécommande conservés.

La lecture reste conditionnée par `channel.streamUrl` fourni par l’import Xtream/M3U réel. Le lecteur existant conserve son branchement vidéo et ses mécanismes webOS.

## Données et compatibilité

- Dexie V4 conservé ; aucun store Favoris V5 ajouté ;
- catalogues importants lus via les fonctions backend existantes et chaînes rendues avec `VirtualList` ;
- pas de re-render global déclenché par les appuis rapides ;
- animations limitées aux propriétés compatibles (`transform`/`opacity`) ;
- aucun `backdrop-filter`, `aspect-ratio` ou dépendance CDN dans la nouvelle vue ;
- `device-react-v20/` et `device-enact-v20/` utilisent le même bundle Enact et le même `appinfo.id`.

## Validation exécutée

Depuis `enact-ui-v20/` :

```text
npm ci --ignore-scripts --no-audit --no-fund
npm run lint       PASS — 0 erreur, 0 warning
npm run pack-p     PASS — build production ciblé Chrome 68
```

Depuis la racine V20 :

```text
npm ci --ignore-scripts --no-audit --no-fund
npm test           PASS — 90 tests
```

Contrôles webOS :

```text
npx --yes --package=@webos-tools/cli@3.2.6 ares-package -c enact-ui-v20/dist
# no problems detected

npx --yes --package=@webos-tools/cli@3.2.6 ares-package -i releases/iptv-webos-enact-v20-2.0.ipk
# com.iptv.webos.player, version 2.0.0, architecture all

npx --yes --package=@webos-tools/cli@3.2.6 ares-package -I releases/iptv-webos-enact-v20-2.0.ipk
# webOS Package Format 2, main index.html
```

La validation sur téléviseur/simulateur réel reste à effectuer lorsqu’une cible webOS est disponible. La présence d’un IPK valide ne remplace pas cette validation matérielle.

## Artefacts

| Artefact | Chemin | Taille | SHA-256 |
|---|---|---:|---|
| IPK webOS | `releases/iptv-webos-enact-v20-2.0.ipk` | 2 244 396 octets | `715cfb18b44b72ee1ba4d4ccc1b93c56bf461bfa86cc3768e285b6bebb4f4cf0` |
| Runtime ZIP | `releases/iptv-webos-enact-v20-2.0.zip` | 2 924 875 octets | `45d21c0d2ee0fc7d46be0954b8ad5336501f0ee2dc94b81713df96bf04886d8a` |
| Source ZIP | `releases/iptv-webos-enact-v20-2.0-source.zip` | 3 316 862 octets | `3248c690f2afdad56b29c9ae68e9e13dc4c776036fe6d3fd911f4e4bb78c6f51` |
| Dossier brut `dist/` ZIP | `releases/iptv-webos-enact-v20-2.0-dist.zip` | 18 529 233 octets | `3af74d8814a4576a39013bc3093e95cbcd79ae9fd37345f3bfd2c5afcb313490` |
| Manifeste | `releases/iptv-webos-enact-v20-2.0-manifest.json` | 2 986 octets | calculé dans le fichier |

Le dossier de build non archivé est :

```text
/home/user/iptv-webos-v20-ui/enact-ui-v20/dist/
```

Le miroir simulator est :

```text
/home/user/iptv-webos-v20-ui/device-react-v20/
```

Les deux miroirs `device-react-v20/` et `device-enact-v20/` sont contrôlés byte-identiques pour le bundle, les styles et le manifeste.

## Installation

```bash
npx --yes --package=@webos-tools/cli@3.2.6 \
  ares-install --device <device-name> releases/iptv-webos-enact-v20-2.0.ipk
npx --yes --package=@webos-tools/cli@3.2.6 \
  ares-launch --device <device-name> com.iptv.webos.player
```

Pour créer un paquet depuis le dossier brut :

```bash
unzip -q releases/iptv-webos-enact-v20-2.0-dist.zip
npx --yes --package=@webos-tools/cli@3.2.6 ares-package dist -o dist-package
```

## Publication GitHub

La release cible est :

`https://github.com/ouagkamel/iptv-webos/releases/tag/v20-enact-2.0`

Les cinq fichiers listés dans le manifeste sont publiés comme assets de cette release : IPK, runtime ZIP, source ZIP, archive `dist/` et manifeste. Publication effectuée le 21 septembre 2026.
