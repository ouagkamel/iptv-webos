# Release UI Enact V20 — 1.0.24

Date de validation de cette révision : **20 septembre 2026**.

## Périmètre

Cette révision concerne exclusivement la variante **Enact V20**, son backend V20 réel et l’identifiant webOS conservé :

- App ID : `com.iptv.webos.player`
- Version applicative : `1.0.24`
- Branche : `react-ui-v20`
- Cible de build : Chromium/Chrome 68, définie dans `enact-ui-v20/package.json`
- Référence utilisateur préservée : `/home/user/uploads/codeui.txt`
- Copie de référence embarquée dans la source : `enact-ui-v20/reference/codeui.txt`
- SHA-256 de la copie : `9bb541c5f9d3a0cd84a74753f032fa59b2b002ffede99e553d215359cdd6bcb9`

La référence utilisateur n’a pas été utilisée comme runtime. L’adaptation est séparée dans `src/views/Home/`, `src/components/MediaCards.js` et `src/services/importer.js`.

## Adaptation de la Home

La Home Enact reprend la direction « Salon Prestige » sans injecter les données fictives de la référence :

- en-tête premium déjà intégré au Shell avec statut du catalogue, horloge et état D-Pad ;
- section **En Direct Maintenant** avec le nombre réel de chaînes et le bouton vers la grille EPG ;
- section **Collection Masterpieces** avec le nombre réel de films ;
- cartes Live alimentées par `data.channels` et le programme courant de `data.epg` ;
- progression calculée depuis `startTime`/`stopTime` de l’EPG réel, jamais depuis une valeur inventée ;
- posters VOD alimentés par `data.movies` et leurs artworks/rating/qualité réels ;
- dock inférieur lié au canal sélectionné et à `onPlay` ;
- navigation Spotlight au D-Pad via les containers Enact ;
- virtualisation conservée avec `VirtualList` et `VirtualGridList` ;
- états vides explicites si le catalogue réel est vide ou non synchronisé.

Aucune constante `LIVE_CHANNELS`, `MASTERPIECES`, `MOCK_CHANNELS`, `MOCK_MOVIES` ou `mockData.js` n’est embarquée dans le runtime. Les URLs Unsplash, flux Mux, profils fictifs et télémétrie inventée de la référence ne sont pas utilisés par l’application. Les URLs de lecture et les images restent celles importées depuis le profil Xtream/M3U réel.

## Données et parcours conservés

Les profils, le modal Xtream/M3U, l’import progressif, Live TV, Films, Séries, Favoris, Guide EPG et le lecteur restent branchés sur la base Dexie V20. Le schéma Dexie V4 est conservé ; aucun store Favoris V5 n’est créé. Sans données réelles, l’interface affiche un état vide au lieu de fabriquer un catalogue.

La progression EPG et les métadonnées de qualité ajoutées dans l’importeur sont dérivées des lignes Xtream/XMLTV ou restent absentes lorsque le fournisseur ne les transmet pas.

## Compatibilité et performance

- cible Enact : `chrome 68` ;
- bootstrap `window.globalThis` conservé dans `src/index.html` et présent dans `dist/index.html` avant `main.js` ;
- CSS de cette Home sans `backdrop-filter`, `aspect-ratio` ou dépendance CDN ;
- transitions de focus limitées à `transform`/`opacity` dans les cartes ;
- grandes listes et grilles virtualisées ;
- pas de re-render artificiel lié aux appuis rapides de télécommande.

Le build Enact complet génère environ 72 Mo de locales iLib dans `dist/node_modules/ilib`. Pour le runtime webOS, les deux dossiers device utilisent le sous-ensemble français/anglais déjà validé (environ 8,6 Mo décompressés) ; les deux dossiers sont byte-identiques. Le bundle compilé reste le même : `main.js` ~1,26 Mo et `main.css` ~456,55 Ko.

## Validation exécutée

Depuis `enact-ui-v20/` :

```text
npm ci --ignore-scripts
npm run lint       PASS
npm run pack-p     PASS — build production ciblé Chrome 68
```

Depuis la racine V20 :

```text
npm ci --ignore-scripts
npm test           PASS — 90 tests
```

Contrôles de contenu :

```text
grep -RInE 'LIVE_CHANNELS|MASTERPIECES|mockData|MOCK_CHANNELS|MOCK_MOVIES|unsplash|mux\.com' enact-ui-v20/src
# aucune occurrence

cmp -s device-react-v20/main.js device-enact-v20/main.js
# identique
```

Le paquet a été créé avec **`@webos-tools/cli@3.2.6 ares-package`**, puis contrôlé avec les deux commandes demandées :

```text
npx --yes --package=@webos-tools/cli@3.2.6 ares-package -i releases/iptv-webos-enact-v20-1.0.24.ipk
npx --yes --package=@webos-tools/cli@3.2.6 ares-package -I releases/iptv-webos-enact-v20-1.0.24.ipk
```

Résultat : package `com.iptv.webos.player`, version `1.0.24`, architecture `all`, webOS Package Format 2, `main: index.html`.

## Artefacts locaux

| Artefact | Chemin | Taille | SHA-256 |
|---|---|---:|---|
| IPK webOS | `releases/iptv-webos-enact-v20-1.0.24.ipk` | 2 235 452 octets | `8fad1c89a19b4bf9345282af0e89076d8fd877425b5a708dc4f45df2608d7a43` |
| Runtime ZIP | `releases/iptv-webos-enact-v20-1.0.24.zip` | 2 860 631 octets | `869158e8d38fb19641eeb77777ea267baed199ed44cceea86deb3495682c619f` |
| Source ZIP | `releases/iptv-webos-enact-v20-1.0.24-source.zip` | 1 839 600 octets | `d5623b6d5d4a82d8c9f4eb4f10be2cda99ba63df10097996aa39e9c43b9cfb8b` |
| Manifeste | `releases/iptv-webos-enact-v20-1.0.24-manifest.json` | 2 838 octets | `90ff0b858156f1a4838dc4fedde9c46df7637b6376aa47b0633fca771c6184f6` |

Le dossier de preview compilé est `enact-ui-v20/dist/`. Les deux miroirs destinés au device/simulateur sont `device-react-v20/` et `device-enact-v20/`.

## Déploiement

```text
# Depuis /home/user/iptv-webos-v20-ui
npx --yes --package=@webos-tools/cli@3.2.6 ares-device --list
npx --yes --package=@webos-tools/cli@3.2.6 ares-install --device <device-name> releases/iptv-webos-enact-v20-1.0.24.ipk
npx --yes --package=@webos-tools/cli@3.2.6 ares-launch --device <device-name> com.iptv.webos.player
```

## Diagnostic écran noir

L’écran noir TV **n’est pas déclaré résolu** par cette release. Le bootstrap `globalThis` est bien présent dans la source et le bundle, mais la console applicative sur le téléviseur/simulateur reste la validation déterminante. Après installation et lancement :

```text
npx --yes --package=@webos-tools/cli@3.2.6 ares-inspect com.iptv.webos.player --device <device-name> --open
```

Vérifier dans l’inspecteur : erreurs JavaScript au boot, chargement de `index.html`, `main.js`, `main.css`, et requêtes des locales iLib. Ne pas conclure à la résolution de l’écran noir avant cette vérification.

## Publication GitHub

Release cible : `v20-enact-1.0.24` sur `https://github.com/ouagkamel/iptv-webos/releases/tag/v20-enact-1.0.24`.

Les trois artefacts compilés et le manifeste doivent être envoyés comme assets de cette release avec l’API GitHub disponible dans l’environnement. Le manifeste contient les chemins, tailles, hashes, commandes de packaging et l’état explicite de la validation TV.
