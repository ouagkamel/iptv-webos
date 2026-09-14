# React Glass UI V30

Version séparée de démonstration/validation de l’interface jointe `code UI.txt`.

## Choix

- React + Vite.
- Tailwind CSS.
- Plus Jakarta Sans via Google Fonts.
- Fallbacks visuels Unsplash lorsque le catalogue réel n’a pas de logo.
- Lecture directe de la base IndexedDB `IPTVDatabase` de l’application réelle.
- Aucun tableau MOCK n’est embarqué.

## Données réelles

L’UI lit les profils, imports actifs, chaînes, films, séries, EPG et favoris persistés par l’application webOS. Les épisodes sont chargés depuis le cache `series_info` ou via `get_series_info` pour les premières séries Xtream.

## Lancer

```bash
npm install
npm run dev
```

Cette variante est indépendante de l’UI native V29. Elle ne remplace pas encore le build webOS de production ; elle sert à valider la direction React/Tailwind jointe avec des données réelles.
