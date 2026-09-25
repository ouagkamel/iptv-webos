# Stack technique — Lecteur IPTV pour LG webOS (Enact)

> Document de spécification technique destiné à guider une IA (ou un développeur) dans la génération du code d'une application IPTV pour téléviseurs LG webOS. Contrainte principale : **légèreté et fluidité sur TV milieu de gamme** (CPU/GPU/RAM limités).

---

## 1. Objectif

Construire une UI de lecteur IPTV (liste de chaînes, EPG, player vidéo, navigation télécommande) qui :
- Démarre vite (cold start < 3-4s sur TV moyenne).
- Reste fluide en navigation D-pad (pas de jank sur les listes/grilles).
- Consomme peu de mémoire (éviter les fuites, surtout côté `<video>`).
- Fonctionne sur **webOS TV 6.0 et supérieur** (cible confirmée), soit un parc allant des TV 2021 aux modèles actuels.

### Contrainte moteur web à respecter (webOS 6.0 = plancher)

| Plateforme | Moteur web | Syntaxe JS supportée |
|---|---|---|
| webOS TV 6.x (2021) | Chromium 79 | ES2019 |
| webOS TV 22 (2022) | Chromium 87 | ES2020+ |
| webOS TV 23 (2023) | Chromium 94 | ES2021+ |
| webOS TV 24+ (2024+) | Chromium 108+ | ES2021+ |

⚠️ **Le moteur web est figé à la sortie d'usine de la TV, il n'y a pas de mise à jour navigateur séparée.** Toute la config de build (babel/webpack `browserslist`, target Enact CLI) doit donc être calée sur **Chromium 79 / ES2019** pour garantir le fonctionnement sur le bas de la plage 6.0+, même si on développe avec des outils plus récents. Chromium 79 supporte nativement MSE/EME (donc `hls.js` et `shaka-player` fonctionnent correctement) — pas de souci de compatibilité de ce côté contrairement aux webOS < 4.

---

## 2. Stack recommandé

### 2.1 Framework applicatif — **Enact**
Framework officiel LG basé sur React, optimisé pour la navigation télécommande (D-pad) et les contraintes TV.

```bash
npx @enact/cli create mon-app-iptv
cd mon-app-iptv
```

Packages cœur à utiliser :

| Package | Rôle |
|---|---|
| `@enact/core` | Composants de base, kind factory, gestion perf |
| `@enact/ui` | Composants headless (VirtualList, Layout, Spotlight-agnostiques) |
| `@enact/spotlight` | Navigation spatiale D-pad (focus management) — **indispensable** |
| `@enact/i18n` | Internationalisation (utile si multi-langue) |
| `@enact/webos` | Bindings API système webOS (veille, réseau, retour, LS2) |

### 2.2 Librairie de composants UI — **Sandstone**

Comme la cible est **webOS 6+**, pas d'arbitrage nécessaire : **`@enact/sandstone`** est supporté dès webOS TV 6.0 (via Sandstone 1.4.x) et reste la librairie activement maintenue par LG. Pas besoin de Moonstone.

### 2.3 Versions de référence (correspondance plateforme)

| Plateforme webOS TV | Année | Enact | Sandstone |
|---|---|---|---|
| webOS TV 25 | 2025 | 4.9.x | 2.9.x |
| webOS TV 24 | 2024 | 4.7.x | 2.7.x |
| webOS TV 23 | 2023 | 4.5.x | 2.5.x |
| webOS TV 22 | 2022 | 4.0.x | 2.0.x |
| **webOS TV 6.0** | **2021** | **3.4.9** | **1.4.6** |

**Deux stratégies possibles selon la priorité :**

1. **Compatibilité maximale (recommandé pour du volume IPTV réel)** : builder avec **Enact 3.4.9 / Sandstone 1.4.6**, la version plancher officiellement supportée sur webOS 6.0. Garantit un fonctionnement identique sur tout le parc 6.0+, au prix de composants/API un peu plus anciens.
2. **API la plus récente** : builder avec la dernière version d'Enact/Sandstone, à condition de configurer le build (babel/webpack `browserslist`) pour transpiler vers **Chromium 79 (ES2019)** et de tester impériment sur une vraie TV webOS 6.0, pas seulement sur simulateur — certaines API ou polyfills peuvent manquer sur l'ancien moteur.

⚠️ Toujours vérifier la version exacte supportée au moment du build via la [documentation officielle LG](https://webostv.developer.lge.com/develop/guides/enyo-enact-guide), les versions évoluent régulièrement.

### 2.4 Lecture vidéo (cœur du player IPTV)

**Stratégie recommandée : privilégier le `<video>` HTML5 natif webOS en priorité.**

WebKit/Chromium embarqué sur webOS gère nativement le HLS et le MPEG-TS sur de nombreux flux — c'est le chemin le plus léger en CPU/GPU sur une TV moyenne.

| Cas d'usage | Librairie | Notes |
|---|---|---|
| HLS standard, pas de DRM | `<video>` natif (`src` direct) | Chemin le plus performant, zéro dépendance JS |
| HLS avec besoin de contrôle ABR fin / fallback navigateur | `hls.js` | Ne l'activer qu'en fallback (`Hls.isSupported()`), config buffer allégée (voir §4) |
| DASH et/ou DRM (Widevine/PlayReady) | `shaka-player` | Support communautaire webOS existant mais historiquement des soucis de freeze/stutter en TS remux — tester impérativement sur device réel, pas seulement le simulateur |
| Flux MPEG-TS brut non supporté nativement | `mpegts.js` | À n'inclure que si le flux le nécessite, poids supplémentaire sinon |

**Règle générale** : ne charger que la librairie strictement nécessaire au flux consommé, en lazy-load (`import()` dynamique), jamais les trois en bundle de base.

### 2.5 State management

- Pour la majorité des cas (liste de chaînes, EPG, favoris, état player) : **React Context + hooks** suffit et reste le plus léger.
- Si l'app grossit (multi-écrans, cache complexe, synchronisation playlist/EPG) : **Redux Toolkit** (`@reduxjs/toolkit` + `react-redux`), pattern déjà largement utilisé et validé dans l'écosystème Enact.
- Éviter les librairies de state lourdes ou les couches d'abstraction supplémentaires non nécessaires sur TV.

### 2.6 Listes et grilles (chaînes, EPG)

- **`@enact/ui/VirtualList`** et **`VirtualGridList`** obligatoires pour toute liste de chaînes ou grille de programme (EPG) : rendu virtualisé = seuls les éléments visibles sont montés dans le DOM.
- Pour une grille EPG type "timeline horizontale x chaînes verticales", envisager un composant custom au-dessus de `VirtualList` (scroll virtualisé dans les deux axes) plutôt qu'une lib EPG tierce lourde.

### 2.7 Build & tooling

| Outil | Rôle |
|---|---|
| `@enact/cli` | Scaffold, build, serve (webpack intégré, pas de config manuelle nécessaire) |
| **webOS TV CLI (`ares-cli`)** | `ares-package`, `ares-install`, `ares-launch`, `ares-inspect` pour packager/déployer/debug sur simulateur ou TV réelle |
| **webOS TV Simulator** | Tests rapides en dev, mais **toujours valider les perfs finales sur une vraie TV milieu de gamme**, le simulateur ne reflète pas les contraintes CPU/GPU réelles |
| TypeScript (optionnel mais recommandé) | Sécurise le typage, `@enact/cli` supporte un template TS |
| ESLint + config Enact | Qualité de code, cohérence |

### 2.8 Tests

- **Jest** + **React Testing Library** pour les composants (déjà intégrés au template Enact).
- Tests manuels obligatoires sur device réel pour : navigation D-pad, changement de chaîne rapide (zapping), comportement en veille/réveil (`webOSLaunch`, visibilitychange), mémoire après lecture prolongée.

---

## 3. Optimisations perf spécifiques "TV moyenne"

À appliquer systématiquement, pas en option :

1. **Animations** : uniquement `transform` et `opacity` (accélération GPU), jamais d'animation sur `width/height/top/left/box-shadow`.
2. **Effets visuels lourds** : éviter `filter: blur()`, `backdrop-filter`, ombres portées complexes, dégradés multiples superposés — coûteux sur GPU TV d'entrée/milieu de gamme.
3. **Images** : format WebP compressé, dimensions réellement affichées (pas de resize CSS d'une image 4x trop grande), lazy loading (`loading="lazy"` ou intersection observer) pour logos de chaînes et EPG.
4. **Re-renders** : `React.memo` sur les items de liste/grille, `useMemo`/`useCallback` pour éviter les recalculs sur chaque frame de scroll ou chaque appui touche.
5. **Gestion mémoire vidéo** : à chaque changement de chaîne, bien détruire/réinitialiser proprement l'instance du player précédent (`hls.destroy()`, retirer les listeners, vider `video.src`) avant d'en créer un nouveau — c'est la première cause de fuite mémoire/crash sur les apps IPTV TV.
6. **Debounce du zapping rapide** : si l'utilisateur défile vite dans la liste de chaînes, ne déclencher le chargement réel du flux qu'après un court délai d'inactivité (200-300ms), pas à chaque changement de sélection.
7. **Code splitting** : lazy-load des écrans secondaires (paramètres, guide EPG détaillé) via `import()` dynamique pour garder le bundle initial minimal.
8. **Cycle de vie webOS** : gérer les événements `visibilitychange` / `webOSLaunch` pour couper le flux vidéo en arrière-plan/veille et éviter de consommer CPU inutilement.
9. **Bundle final** : surveiller la taille du bundle (`enact pack --analyze` si dispo), viser le minimum de dépendances tierces.

---

## 4. Configuration allégée `hls.js` (si utilisé)

Quand `hls.js` est nécessaire, configurer un buffer réduit adapté aux contraintes mémoire TV plutôt que les valeurs par défaut pensées pour desktop :

- Réduire `maxBufferLength` / `maxMaxBufferLength` par rapport aux défauts desktop.
- Limiter `maxBufferSize` pour éviter la sur-allocation mémoire.
- Désactiver les fonctionnalités non nécessaires (sous-titres, pistes audio multiples) si le service IPTV ne les utilise pas.
- Toujours détruire l'instance (`hls.destroy()`) au changement de chaîne ou au démontage du composant player.

*(Les valeurs exactes doivent être ajustées et testées empiriquement sur le modèle de TV cible réel, pas seulement calculées en théorie.)*

---

## 5. Architecture de dossiers suggérée

```
src/
├── components/
│   ├── ChannelList/        # VirtualList des chaînes
│   ├── EpgGrid/             # Grille EPG virtualisée
│   ├── Player/              # Wrapper video natif + hls.js/shaka en lazy-load
│   └── ui/                  # Composants découplés de Sandstone/Moonstone
├── views/                   # Écrans (Home, Player, Settings, EPG)
├── state/                   # Context ou Redux Toolkit slices
├── services/                 # Appels API playlist/EPG, cache
├── hooks/                    # useSpotlight helpers, usePlayer, etc.
└── App/
```

Principe clé : isoler la logique métier (player, liste, EPG) des composants visuels Sandstone pour garder un code plus testable et plus facile à faire évoluer.

---

## 6. Résumé — dépendances `package.json` type

**Option A — compatibilité maximale webOS 6.0+ (recommandé) :**

```json
{
  "dependencies": {
    "@enact/core": "^3.4.9",
    "@enact/i18n": "^3.4.9",
    "@enact/sandstone": "^1.4.6",
    "@enact/spotlight": "^3.4.9",
    "@enact/ui": "^3.4.9",
    "@enact/webos": "^3.4.9",
    "react": "^16.14.0",
    "react-dom": "^16.14.0",
    "hls.js": "^1.x (en lazy-load uniquement)"
  }
}
```

**Option B — dernière API Enact/Sandstone (nécessite transpile ES2019 + tests device réel webOS 6.0) :**

```json
{
  "dependencies": {
    "@enact/core": "^4.9.5",
    "@enact/i18n": "^4.9.5",
    "@enact/sandstone": "^2.9.6",
    "@enact/spotlight": "^4.9.5",
    "@enact/ui": "^4.9.5",
    "@enact/webos": "^4.9.5",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "hls.js": "^1.x (en lazy-load uniquement)"
  }
}
```

> N'ajouter `shaka-player`, `mpegts.js` ou Redux Toolkit que si le besoin est confirmé — chaque dépendance supplémentaire pèse sur le temps de démarrage et la mémoire. Vérifier la compatibilité exacte de la version de React avec la version d'Enact choisie au moment du scaffold (`@enact/cli create`).

---

## 7. Consignes pour l'IA générant le code

- Cible officielle : **webOS TV 6.0+**. Configurer le build (babel/browserslist) pour transpiler vers **Chromium 79 / ES2019** afin de garantir la compatibilité sur le bas de la plage, sauf si l'option B (§2.3/§6) est explicitement choisie avec tests device réel confirmés.
- Utiliser **Sandstone** comme unique librairie de composants (pas de Moonstone, non pertinent pour webOS 6+).
- Toujours utiliser `@enact/spotlight` pour tout élément navigable (jamais de navigation clavier custom parallèle).
- Toujours utiliser `VirtualList`/`VirtualGridList` pour toute liste > ~20 items.
- Ne jamais introduire de dépendance UI générique non pensée pour TV (pas de librairie desktop/mobile type Material UI, Ant Design, etc.).
- Ne jamais utiliser d'animations CSS coûteuses (blur, box-shadow animé, filtres).
- Toujours nettoyer proprement les instances vidéo au changement de chaîne/démontage.
- Charger `hls.js`/`shaka-player`/`mpegts.js` en lazy-load, jamais au bundle initial.
- Préférer la simplicité (Context API) à une lib de state lourde tant que le besoin n'est pas avéré.
