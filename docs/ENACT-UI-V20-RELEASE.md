# Release UI Enact V20 — v20-enact-4.0

Date de build : **25 septembre 2026**.

## Périmètre

Cette révision travaille sur la base V20 indiquée par l’utilisateur et reste exclusivement sur la variante **Enact V20** :

- App ID : `com.iptv.webos.player`
- Version manifest : `4.0.0`
- Tag : `v20-enact-4.0`
- Branche : `react-ui-v20`
- Cible minimale déclarée : webOS TV 6.0+
- Build conservatif : Chromium 68 / syntaxe ES2019 ou plus ancienne
- Backend : Dexie V4 et catalogues réels V20

Le document technique utilisateur est conservé sans modification dans `enact-ui-v20/reference/stack-technique-iptv-webos-enact.md`. Les autres références UX sont également byte-identiques aux fichiers fournis.

## Nouveau design et shell partagé

La correction principale est l’intégration de toute l’application dans le shell V20 Enact. Les routes Home, Films, Séries, Favoris, Guide et Paramètres ne réutilisent plus l’ancien `NavigationRail`/`StatusBar` de `1.0.24`.

Le shell commun apporte :

- navigation IPTV supérieure ;
- accès Home via le logo ;
- onglets Chaînes TV, Films, Séries, Profils et Paramètres ;
- horloge et profil actif ;
- fond bleu nuit et palette cohérente avec le nouveau design ;
- contenu scrollable sans décalage laissé par l’ancien rail ;
- navigation Spotlight commune à tous les menus.

Les écrans existants restent branchés sur les données et actions réelles V20 : profils, Xtream/M3U, films, séries, favoris, EPG et lecteur.

## Live TV

La vue Live TV reprend la composition de référence :

- grille `348px | 1fr | 620px` à 1920×1080 ;
- catégories et compteurs dérivés du catalogue réel ;
- `VirtualList` pour les chaînes ;
- logos réels avec fallback d’initiales ;
- EPG courant/suivant et progression réels ;
- appui OK sur une chaîne réelle connecté au lecteur ;
- debounce de zapping de 250 ms pour éviter une cascade de chargements ;
- OSD télécommande : OK, navigation, changement de panneau, favoris, retour ;
- panneau visuel utilisant le logo réel de la chaîne sélectionnée ;
- état vide explicite si aucun catalogue Live n’est importé.

Aucun catalogue fictif, flux Mux, URL Unsplash, image distante ajoutée ou store Dexie V5 n’est utilisé.

## Consignes techniques appliquées

- Sandstone/Spotlight conservés pour l’expérience D-pad ;
- catalogues importants virtualisés ;
- items de liste mémoïsés ;
- animations limitées à `transform` et `opacity` ;
- pas de `backdrop-filter`, `aspect-ratio` ou blur dans la nouvelle UI ;
- build ciblé plus strictement que le plancher Chromium 79, via `chrome 68` ;
- lecteur Enact existant conservé afin de préserver son nettoyage média ;
- miroirs `device-react-v20` et `device-enact-v20` produits depuis le même build.

## Validation

Depuis `enact-ui-v20/` :

```text
npm ci --ignore-scripts --no-audit --no-fund
npm run lint       PASS — 0 erreur, 0 warning
npm run pack-p     PASS — build production ciblé Chromium 68
```

Depuis la racine V20 :

```text
npm test           PASS — 90/90 tests
```

Contrôles webOS :

```text
npx --yes --package=@webos-tools/cli@3.2.6 ares-package -c enact-ui-v20/dist
# no problems detected

npx --yes --package=@webos-tools/cli@3.2.6 ares-package -i releases/iptv-webos-enact-v20-4.0.ipk
# com.iptv.webos.player, version 4.0.0, architecture all

npx --yes --package=@webos-tools/cli@3.2.6 ares-package -I releases/iptv-webos-enact-v20-4.0.ipk
# webOS Package Format 2, main index.html
```

La validation sur téléviseur ou simulateur webOS réel reste à effectuer avec une cible disponible.

## Artefacts

| Artefact | Chemin | Taille | SHA-256 |
|---|---|---:|---|
| IPK webOS | `releases/iptv-webos-enact-v20-4.0.ipk` | 2 242 954 octets | `4e7f7bf5b3e3299a3902812bc9b404b38328dd80b217d7fe223d6ab7efa185bc` |
| Runtime ZIP | `releases/iptv-webos-enact-v20-4.0.zip` | 2 923 864 octets | `990c1f707215fa685443ece4f183f31e5f44ca7dba69ff2efe808871f78c7621` |
| Source ZIP | `releases/iptv-webos-enact-v20-4.0-source.zip` | 3 322 099 octets | `e7cf31a3e382251347b7c5e7101f9add8ee4cf327851f682db1c1863f779fa86` |
| Dossier brut `dist/` ZIP | `releases/iptv-webos-enact-v20-4.0-dist.zip` | 18 528 222 octets | `00c34ac75a97ef9ea0db565e21926a7299995153e8b374a4c96669207691c180` |
| Manifeste | `releases/iptv-webos-enact-v20-4.0-manifest.json` | 3 666 octets | `de11acf967d502f8586d98756f4ed1773833f2f17474f9a2359006f04543a75c` |

Dossiers générés :

```text
/home/user/iptv-webos-v20-ui/enact-ui-v20/dist/
/home/user/iptv-webos-v20-ui/device-react-v20/
/home/user/iptv-webos-v20-ui/device-enact-v20/
```

## Installation

```bash
npx --yes --package=@webos-tools/cli@3.2.6 \
  ares-install --device <device-name> releases/iptv-webos-enact-v20-4.0.ipk
npx --yes --package=@webos-tools/cli@3.2.6 \
  ares-launch --device <device-name> com.iptv.webos.player
```

## Publication GitHub

La release est publiée sur :

[https://github.com/ouagkamel/iptv-webos/releases/tag/v20-enact-4.0](https://github.com/ouagkamel/iptv-webos/releases/tag/v20-enact-4.0)

Les cinq fichiers du manifeste sont publiés comme assets : IPK, runtime ZIP, source ZIP, archive `dist/` et manifeste.
