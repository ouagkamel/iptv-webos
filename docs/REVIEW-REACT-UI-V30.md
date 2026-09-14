# Revue React Glass UI — V30

**Date :** 2026-09-14
**Base :** V29 publiée, UI native webOS conservée dans `src/`
**Référence :** `/home/user/uploads/code UI.txt`
**Périmètre :** variante React/Tailwind indépendante, branchée sur les données persistées de `IPTVDatabase`

## Verdict

**WARNING — variante V30 construite et servie pour validation ; elle ne remplace pas le build webOS natif V29.**

Cette version porte volontairement la direction de la référence presque telle quelle : React, Tailwind, Plus Jakarta Sans via Google Fonts, glassmorphism clair et fallback Unsplash. Les tableaux `MOCK_CHANNELS` et `MOCK_MOVIES` de la référence ont été supprimés. Les écrans lisent les profils, catalogues, EPG, favoris et cache d’épisodes réels.

## Traçabilité

| Élément de la référence | Implémentation V30 |
|---|---|
| `ProfileScreen` | `react-ui-v30/src/App.jsx` — profils réels Dexie, création Xtream/M3U, suppression et sélection. |
| `MainAppScreen` | `react-ui-v30/src/App.jsx` — Live, Films, Séries, Favoris, Guide EPG et Paramètres. |
| `CustomStyles` | `react-ui-v30/src/index.css` — Tailwind, composants glass et focus TV. |
| `MOCK_CHANNELS`, `MOCK_MOVIES` | Supprimés ; remplacement par `readProfileData()`, `matchPrograms()` et le store `favorites`. |
| Épisodes de séries | Lecture du cache `series_info`, puis appel limité à `get_series_info` pour les premières séries Xtream. |
| Images | Logo réel du catalogue en priorité ; fallback Unsplash esthétique lorsque le fournisseur ne fournit aucun logo. |
| Lecture | `<video>` natif avec le `streamUrl` réellement persisté ; aucun flux de démonstration. |

## Données et limites explicites

- La variante réutilise le nom IndexedDB `IPTVDatabase` et le schéma V1→V5 pour lire les profils et imports de l’application native.
- La création de profil écrit un profil réel dans Dexie, mais l’import doit encore être lancé depuis l’application native V29 ; aucun import simulé n’est déclenché par cette variante.
- Les actions Live/VOD utilisent les URL de flux réellement persistées. Les favoris sont écrits dans le store réel `favorites` lorsqu’ils proviennent de l’application native.
- Les épisodes sont enrichis de manière lazy, au maximum pour huit séries, et un échec réseau reste isolé.
- Google Fonts et Unsplash sont volontairement externes dans cette variante, conformément à la demande. Ils ne sont pas nécessaires au fonctionnement du build webOS natif.
- `backdrop-filter` est utilisé comme effet visuel de cette variante ; il n’est pas rétroporté dans l’UI native V29 comme exigence obligatoire.

## Validation exécutée

```text
npm install --ignore-scripts     PASS — react-ui-v30
npm run build                    PASS — 33 modules, JS 250,63 kB, CSS 18,73 kB
curl shell Vite                  PASS — index React servi sur 0.0.0.0:5173
```

La validation navigateur automatisée n’est pas disponible dans l’environnement. La preview Vite `React Glass UI V30` est active pour validation manuelle.
