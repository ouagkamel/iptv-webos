# Release UI Enact V20 — 1.0.24

Date de validation : 14 septembre 2026.

## Livrable

- Source de la variante : `enact-ui-v20/`.
- Variante 100 % Enact : `@enact/core`, `@enact/spotlight`, `@enact/sandstone`.
- Identifiant webOS conservé : `com.iptv.webos.player`.
- Cible de production : Chromium/Chrome 68, via la configuration `target` du projet Enact.
- Le paquet simulator à utiliser est `device-react-v20/` ; il est copié depuis le même build de production que `device-enact-v20/`.
- L’ancienne copie device React Vite a été conservée dans `device-react-v20-legacy/` afin de ne pas mélanger les variantes.

## Données et parcours

Le runtime ne contient aucune donnée IPTV artificielle. Les chaînes, films, séries, épisodes et programmes EPG sont lus depuis `IPTVDatabase` avec le schéma Dexie V1 à V4 de la release V20. L’import réel accepte Xtream, M3U et XMLTV ; les URLs de flux sont construites à partir du profil importé.

Les profils Dexie, le formulaire Xtream/M3U, l’import progressif, les états vides, Live TV, films, séries, favoris, guide EPG et le lecteur Sandstone sont conservés. Le schéma ne crée pas de store favoris V5 : si la base V20 ne fournit pas de favoris, l’écran Favoris reste explicitement vide au lieu d’inventer du contenu.

Les images de catalogue utilisent les URLs fournies par le backend réel. En cas d’image absente ou non lisible, le composant affiche un SVG local générique sans titre IPTV fictif. Aucun CDN Tailwind/Lucide/Three.js, Google Fonts, Unsplash, `test-streams.mux.dev`, profil de démonstration ou constante `LIVE_DATA`/`VOD_DATA` n’est embarqué dans le runtime.

## Validation effectuée

Commandes exécutées depuis `enact-ui-v20/` :

```text
npx --yes @enact/cli@5.1.3 lint .       PASS — 0 erreur, 0 avertissement
npx --yes @enact/cli@5.1.3 pack -p     PASS — build production 1.26 MB JS / 456.06 kB CSS
npx --yes @enact/cli@5.1.3 test --passWithNoTests
                                         PASS — aucun test local déclaré
```

La suite V20 existante a également été exécutée depuis la racine : `npm test` — PASS, 90 tests. La preview Enact a été démarrée sur `0.0.0.0:8080` avec `@enact/cli@5.1.3 serve --host 0.0.0.0` et a répondu HTTP 200. Le paquet device et la preview sont issus du même contenu `dist/`; `device-react-v20/main.js` et `device-enact-v20/main.js` sont identiques.

Le paquet `.ipk` a été régénéré avec `@webos-tools/cli@3.2.6 ares-package`, puis vérifié avec `ares-package -i` et `ares-package -I`. Il contient le format webOS Package Format 2, `packageinfo.json`, `appinfo.json`, `index.html`, les bundles Enact, les ressources Sandstone/iLib et les icônes locales. Le paquet manuel précédent n’était pas signé/structuré comme un paquet webOS produit par `ares-package`, ce qui provoquait `ipk verified failed` sur le téléviseur.

Le HTML d’amorçage définit aussi `window.globalThis` avant le bundle React. Chromium 68, utilisé par webOS TV 5, ne fournit pas cette API alors que la détection de plateforme Enact la lit dès le démarrage ; sans ce correctif, l’application peut afficher un écran noir malgré une installation réussie.

Le build Enact complet génère environ 79 Mo décompressés car le chargeur iLib copie par défaut 6 755 fichiers de locale. Cette donnée n’est pas du code IPTV et n’était pas présente dans les anciennes releases Vite : c’est la raison de l’archive initiale d’environ 14–15 Mo. La release publiée a été réduite aux packs iLib français et anglais ainsi qu’aux métadonnées globales : elle fait environ 2,2 Mo en `.ipk` et 2,9 Mo en `.zip`. Le bundle Enact lui-même reste nécessaire : `main.js` fait environ 1,26 Mo et `main.css` environ 456 Ko, contrairement à une simple release source de quelques kilo-octets.

Le message Browserslist indiquant que `caniuse-lite` est ancien est informatif ; il n’a pas bloqué le build et ne change pas la cible Chrome 68.

## Utilisation et fichiers publiés

Les fichiers `.ipk` et runtime `.zip` sont des artefacts compilés webOS, pas des projets npm : ils ne contiennent volontairement pas de `package.json`. Il ne faut donc pas lancer `npm install` dans un dossier extrait depuis l’archive runtime.

Pour le simulateur ou un téléviseur webOS :

```text
ares-device --list
ares-install --device <device-name> iptv-webos-enact-v20-1.0.24.ipk
ares-launch --device <device-name> com.iptv.webos.player
```

Pour développer, utiliser l’asset source `iptv-webos-enact-v20-1.0.24-source.zip`, extraire le dossier qui contient `package.json`, puis lancer `npm install` depuis ce dossier.

- `releases/iptv-webos-enact-v20-1.0.24.ipk` — paquet simulator/device.
- `releases/iptv-webos-enact-v20-1.0.24.zip` — archive runtime de staging.
- `iptv-webos-enact-v20-1.0.24-source.zip` — projet Enact complet avec `package.json` et `package-lock.json`.
- `iptv-webos-enact-v20-runtime-usage.txt` — rappel d’utilisation des artefacts.
- `releases/iptv-webos-enact-v20-1.0.24-manifest.json` — version, chemins, validation et SHA-256.
