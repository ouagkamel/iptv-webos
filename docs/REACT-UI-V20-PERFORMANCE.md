# React UI V20 — optimisation TV webOS moyen

## Objectif

Cette révision conserve l’UI React V20, le schéma Dexie V4, l’import Xtream/M3U/XMLTV et le contrat d’installation `com.iptv.webos.player`, tout en réduisant le travail DOM et les re-renders sur un téléviseur webOS/Chromium 68 de gamme moyenne.

Aucune donnée de démonstration n’a été ajoutée : les écrans vides continuent d’indiquer explicitement qu’aucun catalogue réel ou EPG n’est disponible.

## Modifications

- `VirtualList` pour les chaînes et `Guide TV` ;
- `VirtualGrid` pour les films, séries, épisodes récents et favoris ;
- `VirtualPillList` pour les catégories Live TV ;
- fenêtre visible limitée par un overscan court, avec mise à jour du scroll sur `requestAnimationFrame` ;
- `React.memo` sur les cartes, lignes, états vides, arts média, vues et conteneurs stables ;
- `useMemo` pour les catégories, l’index EPG par chaîne et les résultats du guide ;
- `useCallback` pour les callbacks transmis aux composants virtualisés ;
- fallback d’illustration local en SVG data URI, sans dépendance à un CDN d’images lorsque le logo réel échoue ;
- dimensions intrinsèques déclarées pour les images de cartes afin de limiter les réajustements de layout ;
- navigation spatiale adaptée à la télécommande, avec throttle de 90 ms des flèches et exclusion des champs de saisie ;
- gradient de fond statique, suppression du `backdrop-filter` et réduction des ombres ;
- transitions limitées à `transform` et `opacity`, sans animation permanente du gradient ni transition globale de largeur.

## Compatibilité et périmètre

- cible de production : `chrome68` ;
- bundle device classique IIFE avec imports dynamiques inline ;
- preview Vite et dossier `device-react-v20` générés depuis le même build React ;
- identifiant webOS inchangé : `com.iptv.webos.player` ;
- version device de cette révision corrective : `1.0.23` ;
- aucun store Dexie V5 ni modification de la variante native.

## Choix du paquetage

Le dépôt complet conserve la variante native V20 dans sa racine pour ne pas la modifier. La preview React est exclusivement `react-ui-v20/dist` et le paquet installable est exclusivement `device-react-v20`. Les archives de release React dédiées ne contiennent plus la racine native ambiguë : elles exposent directement la preview React et le dossier device React.

## Validation

Les validations effectuées avant publication sont :

```text
npm run build                 PASS
npm run gate:syntax           PASS
npm test                      90/90 PASS
unzip -t                      PASS sur les archives publiées
ar t                         PASS sur l’IPK publié
```

Les sommes SHA-256 des artefacts et l’URL de la release sont consignées après publication dans le journal de livraison de la session.
