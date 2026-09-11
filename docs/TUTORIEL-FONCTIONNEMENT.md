# IPTV webOS Player — tutoriel détaillé de fonctionnement

**Révision expliquée : V18 (base publiée V17.1)**  
**Cible : LG webOS 5 / Chromium 68, avec conservation de la compatibilité des versions ultérieures**

Ce document décrit le fonctionnement réel du projet, dans l’ordre où il s’exécute :

1. ouverture de l’application ;
2. ouverture d’IndexedDB et maintenance ;
3. création automatique de la playlist par défaut ;
4. ajout manuel d’une playlist M3U ou Xtream ;
5. import des chaînes, films, séries et catégories ;
6. écriture en lots dans IndexedDB ;
7. swap sécurisé et purge des anciennes données ;
8. affichage des catalogues ;
9. lecture d’une chaîne ou d’un film ;
10. navigation télécommande, zapping, veille et reprise.

Les chemins de fichiers et les noms de fonctions correspondent au dépôt :

```text
/home/user/iptv-webos
```

---

## 1. Vision d’ensemble

L’application est une application web exécutée par le moteur webOS. Elle n’est pas
un serveur : elle tourne principalement dans le navigateur de la télévision et
communique directement avec :

- IndexedDB pour la persistance locale ;
- le panneau M3U, XMLTV ou Xtream pour les imports ;
- le lecteur vidéo natif ou HLS/MSE pour la lecture ;
- les API webOS pour les capacités de l’appareil et le bouton Retour.

Le schéma général est le suivant :

```text
                          ┌─────────────────────────────┐
                          │         Application UI       │
                          │ src/app.js                   │
                          │ onglets, formulaires, D-pad  │
                          └──────────────┬──────────────┘
                                         │
                                         │ appels de services
                                         ▼
                          ┌─────────────────────────────┐
                          │      PlaylistManager         │
                          │ CRUD + lancement des imports │
                          └──────────────┬──────────────┘
                                         │
                    ┌────────────────────┼────────────────────┐
                    │                    │                    │
                    ▼                    ▼                    ▼
             ImportController       Worker M3U          Worker Xtream
             réseau / terminaison   parsing M3U          fetch API + mapping
                    │                    │                    │
                    │                    └────────┬───────────┘
                    │                             │ CHUNK
                    ▼                             ▼
                          ┌─────────────────────────────┐
                          │         DataManager           │
                          │ file d'écriture unique       │
                          │ bulkAdd / swap rapide / GC  │
                          └──────────────┬──────────────┘
                                         │
                                         ▼
                          ┌─────────────────────────────┐
                          │      Dexie → IndexedDB        │
                          │ playlists, imports, channels │
                          │ vod, series, epg, categories │
                          └─────────────────────────────┘

                 ┌────────────────────────────────────────┐
                 │ MediaAdapter + HLS.js + Lifecycle      │
                 │ lecture, fallback, watchdog, veille    │
                 └────────────────────────────────────────┘
```

### Idée centrale

L’interface ne fait jamais directement tout le travail d’import. Elle déclenche
un service. Le service crée un import identifié. Le worker transforme les données
en objets métier. Le `DataManager` est le seul composant qui écrit les lots en
base. Quand tout est terminé, une transaction bascule le pointeur actif vers le
nouvel import.

Cette séparation est importante pour trois raisons :

1. **la télévision reste utilisable** pendant un import lourd ;
2. **les données partielles ne deviennent jamais actives** ;
3. **les erreurs et les annulations ont une voie de sortie unique**.

---

## 2. Architecture choisie

### 2.1 Architecture sans framework d’interface

Le projet n’utilise ni React, ni Vue, ni Angular. L’interface est construite avec
les API DOM classiques :

- `document.createElement` ;
- `textContent` pour éviter l’injection HTML ;
- des composants JavaScript simples ;
- des événements `window` pour les signaux d’import.

Ce choix réduit le poids et évite d’ajouter une couche d’abstraction importante
sur un téléviseur peu puissant. Il est aussi plus prévisible sous Chromium 68.

Les principaux composants UI sont :

| Module | Rôle |
|---|---|
| `src/app.js` | orchestration de l’interface et des actions utilisateur |
| `FocusEngine.js` | focus D-pad, OK, Retour, Magic Remote |
| `RemoteKeys.js` | classification contextuelle des touches |
| `VirtualList.js` | affichage virtualisé des grands catalogues |
| `ImportBadge.js` | progression et résultat d’import |
| `PlayerOSD.js` | nom de chaîne, EPG et statut du lecteur |

### 2.2 Main thread et Web Workers

Le thread principal garde la main sur :

- l’interface ;
- le focus et la télécommande ;
- IndexedDB via Dexie ;
- la lecture vidéo ;
- les événements d’application.

Les workers effectuent les tâches coûteuses :

- `m3u.worker.js` découpe et interprète le fichier M3U ;
- `epg.worker.js` interprète XMLTV ;
- `xtream.worker.js` appelle l’API Xtream, transforme les réponses et prépare
  les lots.

En production, Vite intègre les workers dans le bundle sous forme de Blob grâce à
`?worker&inline`. Cela évite qu’un téléviseur lancé en `file://` cherche un worker
à un mauvais chemin.

### 2.3 IndexedDB avec Dexie

`src/data/db.js` crée la base :

```javascript
export const db = new Dexie('IPTVDatabase');
```

Dexie fournit :

- des transactions ;
- les requêtes indexées ;
- `bulkAdd` pour les lots de contenu ;
- les migrations de schéma.

Le schéma a évolué de manière additive :

- version 1 : playlists, imports, chaînes, EPG ;
- version 2 : films VOD ;
- version 3 : séries, cache de détail et catégories.

### 2.4 Build compatible Chromium 68

`vite.config.js` impose :

- `target: 'chrome68'` ;
- bundle IIFE ;
- workers IIFE ;
- imports dynamiques intégrés ;
- Terser ;
- remplacement du script module par un script classique différé dans le build
  destiné à la TV.

`src/utils/CapabilityDetector.js` importe `webostvjs` par effet de bord, car ce
paquet installe `window.webOS` mais ne fournit pas d’export ESM utilisable.

---

## 3. Ouverture de l’application : séquence complète

### 3.1 Point de départ : `index.html`

`index.html` contient :

```html
<div id="root"></div>
<script type="module" src="/src/app.js"></script>
```

Il contient aussi `#boot-step`, un petit indicateur de démarrage. Cet indicateur
permet de savoir si l’application s’est arrêtée avant même que l’interface soit
créée.

Le navigateur charge ensuite `src/app.js`. Le module exécute finalement :

```javascript
main().catch(function (err) {
  // affichage de BOOT FAILURE
});
```

### 3.2 `main()` dans `src/app.js`

La fonction principale suit cette chaîne :

```text
main()
 ├─ document.getElementById('root')
 ├─ ctx = await boot()
 ├─ new FocusEngine()
 ├─ buildLayout()
 ├─ new ImportBadge(document.body)
 ├─ new SeriesBrowser()
 ├─ engine.init()
 ├─ wireGlobalEvents()
 ├─ ctx.manager.ensureDefaultPlaylist(DEFAULT_PLAYLIST)
 ├─ refreshPlaylists()
 ├─ renderTab()
 └─ suppression de #boot-step
```

### 3.3 `boot()` dans `src/bootstrap.js`

`boot()` exécute les étapes suivantes.

#### Étape A — détection des capacités

```text
boot()
 └─ Capabilities.detectAll()
```

`Capabilities.detectAll()` vérifie au minimum :

- présence d’IndexedDB ;
- présence de `Worker` ;
- présence de `fetch` ;
- présence de `ReadableStream` ;
- présence de `TextDecoder` ;
- présence de MSE (`MediaSource` / `SourceBuffer`).

Sur un vrai téléviseur, la version est demandée via :

```javascript
window.webOS.deviceInfo(callback)
```

La source fiable est `info.sdkVersion`, pas le User-Agent. Si le SDK ne répond
pas sous une seconde, l’application utilise une baseline webOS 5.0 pour ne pas
bloquer le démarrage en navigateur de développement.

#### Étape B — ouverture de la base

```text
boot()
 └─ db.open()
```

L’ouverture est protégée par une limite de huit secondes. Si IndexedDB ne répond
pas, l’application signale que la base locale est indisponible au lieu de rester
silencieusement sur un écran noir.

#### Étape C — création du registre de workers

```text
createImportPairs()
 └─ prépare un registre vide
```

Les workers ne sont pas tous instanciés immédiatement. Ils sont créés à la
demande par `pairs.get(kind)` lors du premier import.

Les associations sont :

| Type logique | Worker | Table par défaut |
|---|---|---|
| `playlist` | `m3u.worker.js` | `channels` |
| `epg` | `epg.worker.js` | `epg` |
| `xtream` | `xtream.worker.js` | `channels` ; la cible réelle est portée par chaque CHUNK |

Pour chaque paire, `createImportPairs()` construit :

```text
Worker + DataManager + ImportController
```

Le handler `worker.onerror` appelle `DataManager.failImport()` avec l’`importId`
courant, détruit la paire défectueuse et permet de la recréer au prochain import.

#### Étape D — maintenance de reprise

```text
new PlaylistManager(pairs)
 └─ manager.bootMaintenance()
```

`bootMaintenance()` :

1. transforme les imports `running` anciens en `failed` ;
2. conserve temporairement les imports `running` de moins de cinq minutes ;
3. supprime les lignes orphelines dont l’`importId` n’est plus actif ;
4. supprime les anciens programmes EPG expirés de plus de 24 heures.

Cette étape est également le filet de sécurité après un arrêt brutal de la TV ou
un crash de l’application.

---

## 4. Playlist par défaut et ajout manuel

### 4.1 Création automatique de la playlist par défaut

Après `boot()`, `main()` appelle :

```javascript
ctx.manager.ensureDefaultPlaylist(DEFAULT_PLAYLIST)
```

La chaîne est :

```text
main()
 └─ PlaylistManager.ensureDefaultPlaylist(input)
     ├─ XtreamClient.normalizeBase(input.base)
     ├─ db.playlists.toArray()
     ├─ recherche d’une playlist Xtream avec même base + username
     └─ si absente : PlaylistManager.create(input)
```

La fonction est idempotente :

- premier démarrage : la playlist est créée ;
- démarrages suivants : la même playlist est réutilisée ;
- aucun import automatique n’est déclenché.

Les identifiants de la playlist par défaut sont présents dans le bundle de
l’application et ne sont donc pas un secret. En revanche, le mot de passe n’est
jamais écrit dans les journaux de diagnostic.

### 4.2 Interface de création

`buildPlaylistsView()` construit le formulaire contenant :

- nom ;
- source M3U ou Xtream ;
- URL M3U ;
- URL EPG facultative ;
- base Xtream ;
- username ;
- password.

Quand l’utilisateur clique sur **Enregistrer la playlist**, l’event handler appelle :

```text
bouton « Enregistrer la playlist »
 └─ ctx.manager.create(formValues)
     ├─ source === 'xtream' ? validation Xtream : validation M3U
     ├─ XtreamClient.normalizeBase()
     ├─ XtreamClient.epgXmltvUrl() pour Xtream
     └─ db.playlists.add(row)
```

#### Cas Xtream

`PlaylistManager.create()` :

1. normalise la base en supprimant les `/` finaux ;
2. vérifie que la base commence par `http://` ou `https://` ;
3. trim le username ;
4. conserve le password dans la ligne de playlist ;
5. crée automatiquement l’URL XMLTV ;
6. refuse si username ou password est vide.

#### Cas M3U

`PlaylistManager.create()` :

1. conserve l’URL M3U ;
2. accepte une URL `http(s)` sur le téléviseur ;
3. accepte aussi `blob:` uniquement pour les fixtures de test ;
4. conserve une URL EPG facultative.

Après la création :

```text
PlaylistManager.create()
 └─ db.playlists.add(row)
app.js
 ├─ refreshPlaylists()
 └─ renderTab()
```

---

## 5. Modèle de données IndexedDB

### 5.1 Table `playlists`

Une ligne représente une configuration de source :

```text
id                 clé auto-incrémentée
name               nom affiché
source             'm3u' ou 'xtream'
base               base Xtream
username           utilisateur Xtream
password           mot de passe Xtream
m3uUrl             URL M3U
epgUrl             URL XMLTV
activeImportId     import playlist actuellement visible
activeEpgImportId import EPG actuellement visible
updatedAt          date de mise à jour
```

Les champs qui ne correspondent pas à la source restent inutilisés.

### 5.2 Table `imports`

Chaque tentative d’import reçoit une ligne :

```text
id          identifiant auto-incrémenté de l’import
playlistId playlist concernée
kind        'playlist' ou 'epg'
status      'running', 'completed' ou 'failed'
createdAt   début logique de l’import
error       message d’erreur éventuel
```

L’`importId` est le pivot de l’isolation. Il permet de distinguer :

- l’ancien catalogue actif ;
- le nouveau catalogue en staging ;
- un import échoué ;
- un import d’une autre playlist.

### 5.3 Tables de contenu

| Table | Contenu | Identifiant typique |
|---|---|---|
| `channels` | chaînes Live | `${importId}:${stream_id}` ou `${importId}:${seq}` pour M3U |
| `vod` | films Xtream | `${importId}:${stream_id}` |
| `series` | fiches de séries Xtream | `${importId}:${series_id}` |
| `series_info` | saisons/épisodes chargés à la demande | id de la série |
| `epg` | programmes TV | `${importId}:${channelId}:${startTime}` |
| `categories` | catégories dans l’ordre du serveur | `++cid`, avec `importId` + `kind` |

Les lignes de catalogue portent notamment :

```text
importId
name
groupName
sortIdx
searchName
logo
streamUrl
```

`searchName` est la version minuscule sans accents. `sortIdx` conserve l’ordre
d’arrivée du serveur ou du fichier, au lieu de laisser IndexedDB trier les clés
lexicographiquement.

---

## 6. Déclenchement d’un import depuis l’interface

### 6.1 Construction des boutons

`refreshPlaylists()` reconstruit chaque ligne de playlist. Pour toutes les
playlists, l’interface crée :

- `Activer` ;
- `Importer` — un seul bouton pour le catalogue ;
- `EPG` — import séparé ;
- `Annuler` ;
- `Supprimer`.

Les anciennes variantes `Test import 1` à `Test import 5` ne sont plus créées,
ni pour Xtream ni pour M3U. La chaîne UI est désormais :

```text
clic sur Importer
 └─ runImport(playlistId, false)
     └─ ctx.manager.importPlaylist(playlistId)
         └─ DEFAULT_IMPORT_PROFILE

clic sur EPG
 └─ runImport(playlistId, true)
     └─ ctx.manager.importEpg(playlistId)
```

Le profil n’est donc pas choisi par l’utilisateur : 2 000 lignes, `bulkAdd`,
deux lots en vol et respiration tous les quatre lots.

### 6.2 `PlaylistManager.importPlaylist()`

La chaîne précise est :

```text
PlaylistManager.importPlaylist(playlistId, options)
 ├─ db.playlists.get(playlistId)
 ├─ détermine source M3U ou Xtream
 ├─ _cleanupFailedImports(playlistId, 'playlist')
 ├─ pairs.get('xtream') ou pairs.get('playlist')
 ├─ db.imports.add({ status: 'running', ... })
 ├─ construit le job
 └─ pair.controller.startImport(job)
```

`_cleanupFailedImports()` est la correction V17.1 :

- elle supprime les lignes des anciens imports `failed` ;
- elle supprime les entrées `imports` correspondantes ;
- elle ne touche jamais l’`activeImportId` ;
- elle permet de récupérer les restes d’une ancienne version de l’application.

### 6.3 Création paresseuse de la paire Xtream

Lors du premier import Xtream :

```text
pairs.get('xtream')
 ├─ new XtreamWorker()
 ├─ new DataManager(worker, 'channels')
 ├─ new ImportController(worker, dataManager)
 ├─ branche worker.onerror
 └─ branche ACCOUNT_INFO → événement xtream-account-info
```

La paire reste réutilisable pour les imports suivants, sauf si le worker est
crashé. Dans ce cas, elle est détruite et recréée à la prochaine tentative.

---

## 7. Profil d’import par défaut et réglages V18

Les cinq variantes `Test import 1` à `Test import 5` ont été supprimées. Il n’y
a plus qu’un bouton **Importer** pour le catalogue de la playlist. Le bouton
**EPG** reste séparé, car il alimente une table et un pointeur différents.

Le profil unique est `DEFAULT_IMPORT_PROFILE` dans
`src/data/ImportProfiles.js` :

| Paramètre | Valeur par défaut | Pourquoi |
|---|---:|---|
| `chunkItems` | 2 000 | compromis TV entre 1 000 et 2 500 lignes |
| écriture contenu | `bulkAdd` exclusivement | toutes les clés portent un nouvel `importId` |
| CHUNK en vol | 2 | chevauchement Worker / IndexedDB sans tripler la mémoire |
| respiration | une frame tous les 4 lots | évite le délai fixe par lot |
| `parallelCatalogs` | `true` | appels globaux Live/VOD/Séries Xtream parallèles |
| `MAX_GLOBAL_BYTES` | 40 MiB | repli Xtream par catégories au-delà |

`writeMode` reste éventuellement présent comme métadonnée historique, mais il
n’est plus interprété par `DataManager` : `_processChunk()` appelle toujours
`bulkAdd`. Les profils hors zone TV (4 000 et 8 000) ne sont plus proposés ni
utilisés par l’interface.

### 7.1 Taille des lots et double buffer

Un lot de 2 000 lignes réduit le coût fixe d’ouverture des transactions sans
faire entrer 8 000 objets dans la mémoire d’un téléviseur. Chaque worker possède
un compteur de lots en vol :

```text
Worker mappe le lot 1 → postMessage(CHUNK chunkId=0)
Worker mappe le lot 2 → postMessage(CHUNK chunkId=1)
Worker attend seulement avant le lot 3
DataManager écrit lot 1 → CHUNK_COMMITTED(chunkId=0)
Worker peut envoyer le lot 3 pendant que lot 2 finit son écriture
```

Le plafond est volontairement **2**, et non 3 : il conserve le bénéfice du
chevauchement tout en bornant le structured clone et la mémoire des vieux
Chromium webOS. L’ACK contient le même `chunkId` que le CHUNK ; un ACK d’un
ancien import ou déjà consommé est ignoré.

### 7.2 `bulkAdd` exclusivement

Le mode de production n’emploie plus `bulkPut` pour les lignes de contenu.
L’import crée d’abord un nouvel `importId`, puis les workers fabriquent des clés
comme :

```text
channels : importId:streamId ou importId:seq
vod      : importId:streamId
series   : importId:seriesId
EPG      : importId:channelId:startTime
```

Toutes ces clés sont nouvelles pour l’import courant. `bulkAdd` évite donc le
coût de vérification/remplacement de `bulkPut`. Une collision est désormais une
anomalie d’intégrité et suit la voie `failImport()` ; elle n’est pas masquée par
une mise à jour.

### 7.3 Respiration intelligente

`yieldMs` n’est plus un délai appliqué après chaque CHUNK. `DataManager` compte
les écritures et appelle `_yieldToUi()` tous les quatre lots :

```text
lot 1 : écriture immédiate
lot 2 : écriture immédiate
lot 3 : écriture immédiate
lot 4 : bulkAdd puis une frame rAF
lot 5…
```

Si le document est caché, webOS peut suspendre `requestAnimationFrame` ; le code
utilise alors `setTimeout(0)`. Un plafond court protège aussi contre une frame
jamais délivrée. L’interface récupère ainsi la main sans accumuler 10, 16 ou 32 ms
artificiels par lot.

### 7.4 Structured clone et objets compacts

`xtream.worker.js` reçoit souvent des objets contenant des propriétés de panneau
inutiles. Les mappeurs `mapLiveItem()`, `mapVodItem()` et `mapSeriesItem()` ne
construisent que les champs lus ensuite par :

- `VirtualList` et la recherche (`id`, `name`, `searchName`, `sortIdx`) ;
- les filtres (`groupName`, `category`) ;
- l’OSD (`logo`, `plot`, `rating`) ;
- le lecteur (`streamUrl`, `seriesId`).

Les valeurs sont converties en chaînes/nombres simples. Aucun tableau ou objet
brut du JSON Xtream ne traverse `postMessage`. Le détour extrême
`JSON.stringify(items)` puis `JSON.parse()` n’est pas activé : les objets sont
déjà aplatis et le double passage CPU serait défavorable sur une TV récente
comme sur Chromium 68.

### 7.5 Parallélisme à ne pas confondre

Deux réglages sont différents :

- **deux CHUNK en vol** : parallélisme producteur/écriture d’un même import ;
- **`parallelCatalogs`** : parallélisme des trois requêtes globales Xtream.

`MAX_INFLIGHT_TEXT = 4` est encore autre chose : il borne les fragments texte
M3U/XMLTV en attente de parsing. Ces trois limites évitent de confondre réseau,
CPU Worker et transactions IndexedDB.

### 7.6 Limites réseau et mémoire

Pour Xtream, un catalogue global dont la réponse dépasse 40 MiB repasse par les
catégories. Pour M3U/XMLTV, sans `ReadableStream`, le fallback reste plafonné à
30 MiB avec des tranches de 256 KiB. Le watermark réseau reste à quatre chunks
texte. Ces limites protègent la mémoire même si le nombre de lignes final est
inconnu.

## 8. Import Xtream : déroulement complet

### 8.1 Entrée dans `ImportController.startImport()`

Pour Xtream, le job contient :

```javascript
{
  source: 'xtream',
  importId,
  playlistId,
  kind: 'playlist',
  base,
  username,
  password,
  profile
}
```

`ImportController.startImport(job)` :

1. vérifie qu’aucun import n’est déjà en cours (`PROT-6`) ;
2. mémorise `currentImportId` ;
3. initialise les compteurs de progression ;
4. émet `import-start` ;
5. crée la promesse d’attente de `import-complete`, avant tout envoi ;
6. envoie `INIT_IMPORT` au worker Xtream ;
7. attend la résolution ou le rejet de l’import.

La promesse est résolue uniquement par `import-complete`, ou rejetée par
`import-error` / `import-aborted`.

### 8.2 Initialisation du worker Xtream

Le worker reçoit `INIT_IMPORT` :

```text
xtream.worker.onmessage(INIT_IMPORT)
 ├─ currentImportId = importId
 ├─ currentPlaylistId = playlistId
 ├─ remise à zéro des files
 ├─ applyProfile(profile)
 ├─ cfg = { base, username, password }
 └─ runImport()
```

`applyProfile()` applique les quatre réglages du profil et utilise le standard
si une valeur est absente ou invalide.

### 8.3 Authentification avant toute écriture

`runImport()` émet d’abord :

```text
IMPORT_PHASE(auth, « Connexion au serveur… »)
```

Puis appelle :

```text
fetchJson(apiUrl(null))
```

Ce qui produit :

```text
GET {base}/player_api.php?username={u}&password={p}
```

Le champ `user_info.status` doit être `Active`. Sinon :

```text
ERROR { message: 'XTREAM_AUTH_FAILED' }
```

Aucune ligne de catalogue n’est écrite avant cette validation.

### 8.4 `ACCOUNT_INFO` et catégories

Une fois authentifié, le worker envoie `ACCOUNT_INFO` :

```javascript
{
  type: 'ACCOUNT_INFO',
  maxConnections,
  expDate
}
```

`bootstrap.js` transforme ce signal en événement global :

```text
ACCOUNT_INFO
 └─ dataManager.addAuxListener()
     └─ window.dispatchEvent('xtream-account-info')
         └─ app.js met à jour state.provider.maxConcurrentStreams
```

Le worker demande ensuite en parallèle :

```text
get_live_categories
get_vod_categories
get_series_categories
```

Le `max_connections` renvoyé par `ACCOUNT_INFO` est une information de capacité
fournisseur, pas le réglage `parallelCatalogs` de l’import. `app.js` la transmet à
`DualPlayerPolicy.isEligible()` ; elle sert à savoir si une évolution de lecture
double est autorisée par le compte et les capacités du téléviseur. Elle n’ouvre
pas automatiquement deux flux pendant l’import.

Les noms sont stockés temporairement dans des maps JavaScript :

```text
catNames.channels[category_id] = category_name
catNames.vod[category_id]      = category_name
catNames.series[category_id]   = category_name
```

Ils sont également envoyés dans des messages `CATEGORIES`. `DataManager` les
écrit dans `db.categories` avec un ordre `sort` correspondant à l’ordre du
serveur.

### 8.5 Téléchargement des trois catalogues

Le worker émet :

```text
IMPORT_PHASE(catalogue, « Téléchargement des catalogues… »)
```

Puis il choisit le mode du profil :

```text
parallelCatalogs = true
 └─ Promise.all([live, vod, series])

parallelCatalogs = false
 ├─ await live
 ├─ await vod
 └─ await series
```

Le mode global appelle :

```text
get_live_streams   → catalogue Live
get_vod_streams    → catalogue Films
get_series         → catalogue Séries
```

Chaque entrée est ensuite transformée en objet DB par :

```text
mapLiveItem()
mapVodItem()
mapSeriesItem()
```

Exemples de transformation :

- une chaîne obtient une URL `/live/{user}/{password}/{stream_id}.m3u8` ;
- un film obtient une URL `/movie/{user}/{password}/{stream_id}.{ext}` ;
- une série reçoit `seriesId`, plot, rating, logo et catégorie, mais pas encore
  ses épisodes détaillés.

La réponse globale doit être un tableau. Si le réseau, le JSON ou la taille
échoue, le worker passe au parcours par catégories :

```text
get_*_categories
 └─ pour chaque catégorie : get_*(category_id)
     ├─ map des éléments
     └─ catégorie en erreur → ignorée (XP-4)
```

### 8.6 Progression par phases

Le worker annonce ensuite les écritures :

```text
write-live   → « Écriture des chaînes… »
write-vod    → « Écriture des films… »
write-series → « Écriture des séries… »
```

En mode global, `IMPORT_META` annonce un total de lignes lorsque les catalogues
nécessaires sont connus. Le `DataManager` le transmet à `ImportBadge`, qui peut
afficher un pourcentage par nombre de lignes.

### 8.7 Fabrication et envoi des CHUNK

`importItemsFlat()` transforme les réponses Xtream avec le mappeur compact, puis
remplit `pendingItems`. À chaque lot plein, le worker appelle
`drainAvailable()` :

```text
pendingItems >= 2 000
 ├─ si 0 ou 1 lot en vol : postMessage(CHUNK { chunkId, items, targetTable })
 ├─ si 2 lots en vol : attendre un CHUNK_COMMITTED
 └─ reprendre le mapping dès qu’un slot est libéré
```

Le worker n’attend donc plus systématiquement la fin de l’écriture du lot
courant. Les lots restent homogènes : `targetTable` est fixé dans le message
au moment de l’envoi et un changement Live → VOD attend le drainage du résiduel
avant de changer de table.

Pour un catalogue Live, VOD ou séries, le tableau JSON d’origine peut rester en
mémoire pendant le mapping ; les objets envoyés dans les CHUNK sont, eux,
strictement réduits aux propriétés utiles. Les réponses trop volumineuses
passent par le fallback par catégories avant cette phase.

### 8.8 Réception du CHUNK par `DataManager`

`DataManager.handleWorkerMessage()` ne traite pas les messages en parallèle. Il
les ajoute à une file :

```javascript
this.processingQueue = this.processingQueue.then(function () {
  // traiter le message suivant
});
```

Pour un `CHUNK`, la chaîne est :

```text
handleWorkerMessage(CHUNK)
 └─ processingQueue
     └─ _processChunk({ importId, items, targetTable, chunkId })
         ├─ si import annulé : CHUNK_COMMITTED(chunkId), sans écriture
         ├─ db[targetTable].bulkAdd(items)
         ├─ événement import-rows après écriture
         ├─ toutes les 4 écritures : une frame rAF ou setTimeout(0)
         └─ CHUNK_COMMITTED({ importId, chunkId })
```

Le lot suivant peut déjà être présent dans la file de messages pendant le
`bulkAdd` courant. La base reste protégée par la sérialisation du
`processingQueue`, tandis que le CPU du worker et le disque avancent en partie
en parallèle.

### 8.9 Fin d’import et swap rapide

Après le dernier élément, `drainAll()` envoie le résiduel puis attend que les
deux lots éventuellement en vol soient acquittés. Le worker n’émet `COMPLETE`
que lorsque :

```text
flux terminé
+ pendingItems vide
+ nombre de CHUNK en vol = 0
```

Le message `COMPLETE` arrive dans `DataManager._processComplete()` :

```text
_processComplete({ playlistId, importId, kind })
 └─ transaction IndexedDB courte
     ├─ trouve les anciens imports du même playlistId/kind
     ├─ playlists.activeImportId = importId
     │   ou activeEpgImportId = importId
     ├─ met le nouvel import à status='completed'
     └─ window.dispatchEvent('import-complete') immédiatement
         └─ _scheduleGarbageCollection() en tâche de fond
```

`import-complete` ne signifie donc plus que l’ancien catalogue est déjà
supprimé. Il signifie que le nouveau pointeur actif est sûr et que les listes
peuvent être rechargées. La GC différée traite les anciens `importId` par lots
de 500 et supprime ensuite leur ligne `imports`. Elle est limitée au
`playlistId` et au type (`playlist` ou `epg`).

Puis `ImportController` :

```text
import-complete
 ├─ _emitFinished()
 │   └─ import-finished { elapsedMs, profileId, profileLabel }
 └─ _teardown()
```

Enfin `app.js` reçoit `import-complete` :

```text
app.js
 ├─ osd.setStatus('Import terminé')
 ├─ refreshPlaylists()
 └─ loadActiveData()
```

## 9. Import M3U et XMLTV : différence avec Xtream

### 9.1 M3U

Pour M3U, le worker ne fait pas lui-même les requêtes HTTP. C’est
`ImportController._pumpNetwork()` qui lit la réponse.

Chaîne :

```text
PlaylistManager.importPlaylist()
 └─ ImportController.startImport(job M3U)
     ├─ worker.postMessage(INIT_IMPORT)
     └─ _pumpNetwork(job)
         ├─ fetch(url)
         ├─ vérification HTTP 2xx
         ├─ lecture ReadableStream si disponible
         ├─ TextDecoder('utf-8', { stream: true })
         ├─ maximum 4 PARSE_CHUNK en vol
         └─ worker.postMessage(END_OF_STREAM)
```

`m3u.worker.js` :

1. conserve la dernière ligne incomplète dans `lineCarry` ;
2. reconnaît `#EXTINF` ;
3. reconnaît `#EXTGRP` et `group-title` ;
4. attend la ligne URL qui suit ;
5. crée l’objet chaîne ;
6. accumule 2 000 objets ;
7. envoie un `CHUNK` à `DataManager`.

Quand le fichier est terminé, `END_OF_STREAM` force l’envoi du résiduel et le
worker envoie les catégories M3U avant `COMPLETE`.

### 9.2 XMLTV / EPG

`PlaylistManager.importEpg()` construit un job avec :

```text
kind: 'epg'
url: playlist.epgUrl
```

`epg.worker.js` :

- conserve les fragments XML coupés entre deux chunks dans `carryOver` ;
- reconnaît les balises `<programme>` ;
- accepte les dates XMLTV à 12 ou 14 chiffres ;
- convertit les dates en epoch UTC millisecondes ;
- crée des lignes `epg` par lot de 2 000.

À la fin, `DataManager._processComplete()` met à jour
`playlists.activeEpgImportId` et ne purge que la table `epg`. Un import EPG ne
supprime jamais le catalogue de chaînes, de films ou de séries.

---

## 10. Pourquoi le swap utilise temporairement plus de stockage

Pendant un nouvel import, la base contient volontairement :

```text
ancien import actif       → visible et lisible
nouvel import staging     → en cours de construction
```

Cette coexistence protège l’utilisateur contre un import partiel. La V18 ne
supprime plus l’ancien catalogue dans la transaction finale, car une suppression
massive à 99 % peut monopoliser IndexedDB et donner l’impression d’un blocage.

### 10.1 Swap court et GC lazy

Le chemin normal est désormais :

```text
nouvel import complètement écrit
 └─ transaction courte
     ├─ activeImportId / activeEpgImportId = nouvel importId
     ├─ status nouvel import = completed
     └─ import-complete → l’UI charge le nouveau catalogue

tâche de fond
 └─ anciens importId
     ├─ channels/vod/series/series_info/categories ou epg
     ├─ suppression par tranches de 500
     ├─ respiration entre tranches
     └─ suppression de la ligne imports
```

`DataManager._scheduleGarbageCollection()` sérialise les nettoyages par
playlist/type et vérifie que l’ancien identifiant n’est pas devenu actif avant
de supprimer. Un arrêt webOS juste après `import-complete` est sans danger :
`PlaylistManager.bootMaintenance()` supprime les lignes orphelines au prochain
démarrage, en protégeant l’actif et les imports `running` très récents.

### 10.2 Erreur de quota ou annulation

```text
DataManager.failImport(importId, error)
 ├─ ajoute importId dans abortedImports
 ├─ envoie ABORT_IMPORT au worker
 ├─ marque imports.status = 'failed'
 ├─ purge les lignes du staging par importId, par petits lots
 └─ émet import-error
```

`PlaylistManager._cleanupFailedImports()` retire également les restes `failed`
laissés par une ancienne version avant un nouvel essai. La purge ne touche
jamais l’import actif. Si le quota reste insuffisant pour conserver
**ancien actif + nouveau staging**, le message public est :

```text
STORAGE_QUOTA: quota de stockage local atteint ; les données actives sont conservées...
```

Dans ce cas, le swap est refusé et l’utilisateur doit libérer l’espace local de
l’application ou du site.

## 11. Affichage des catalogues après l’import

Quand `import-complete` est reçu, `loadActiveData()` charge les trois vues :

```text
loadActiveData()
 ├─ manager.channels(activePlaylistId)
 ├─ manager.vod(activePlaylistId)
 └─ manager.series(activePlaylistId)
```

Ces trois appels sont lancés avec `Promise.all()`.

Chaque appel passe par `PlaylistManager._ordered()` :

```text
_ordered(playlistId, table, kind)
 ├─ récupère playlist.activeImportId
 ├─ lit les lignes de la table par importId
 ├─ lit les catégories par [importId+kind]
 └─ orderRows(rows, categoryNames)
```

`orderRows()` remet les éléments dans l’ordre :

1. rang de catégorie côté serveur ;
2. `sortIdx` d’arrivée ;
3. clé déterministe en dernier recours.

### 11.1 Filtre et recherche

`refreshCategorySelectors(kind)` charge les catégories et construit le `<select>`.

`applySearch(kind, rawQuery)` :

1. normalise la recherche en minuscules sans accents ;
2. applique le filtre catégorie ;
3. filtre sur le début de `searchName` ;
4. limite la recherche à `CONFIG.SEARCH_LIMIT = 200` résultats ;
5. donne le résultat à `VirtualList`.

### 11.2 Virtualisation

`VirtualList` ne crée pas un nœud DOM par chaîne ou par film. Il utilise un pool
recyclé :

```text
20 000 chaînes en base
 └─ seulement les lignes visibles + overscan dans le DOM
```

Paramètres utilisés par `app.js` :

```javascript
new VirtualList(scroller, {
  itemHeight: 60,
  overscan: 4
});
```

Les objets de la base restent nombreux, mais la quantité de DOM reste bornée.

---

## 12. Lecture d’une chaîne télévisée

### 12.1 Activation d’une ligne

Une ligne peut être activée de deux façons :

- clic Magic Remote ;
- touche OK / Entrée / bouton central.

Pour le clic, `app.js` utilise la délégation sur le `scroller` :

```text
scroller.click
 └─ retrouve data-index
     └─ item = lists[kind].items[index]
         └─ activateChannel(kind, item, index)
```

Pour la télécommande, la chaîne est :

```text
keydown
 └─ handleRemoteKey()
     └─ RemoteKeys.classifyKey()
         └─ action = 'activate'
             └─ activateChannel()
```

Le handler de l’application est branché avant le `FocusEngine`, afin de traiter
le contexte lecteur / série / liste avant la navigation générique.

### 12.2 `activateChannel('live', item)`

```text
activateChannel('live', item, index)
 ├─ state.playing = { kind: 'live', index }
 ├─ openPlayer()
 ├─ adapter.play(item.streamUrl)
 ├─ osd.setChannel(item.name)
 └─ showEpgFor(item)
```

`item.streamUrl` vient du mapping Xtream ou de l’URL du fichier M3U.

### 12.3 Création du lecteur

`openPlayer()` appelle `ensurePlayer()` une seule fois :

```text
ensurePlayer()
 ├─ crée <video>
 ├─ crée le bouton Fermer
 ├─ new PlayerOSD(stage)
 ├─ new MediaAdapter(video)
 ├─ adapter.init()
 ├─ new LifecycleAdapter(adapter)
 └─ lifecycle.init()
```

Le lecteur est un overlay plein écran commun aux chaînes et aux films. Il n’est
pas enfermé dans l’onglet Live : c’est ce qui permet à un film d’être lu depuis
l’onglet Films.

### 12.4 `MediaAdapter.play()`

Le lecteur essaie d’abord le moteur natif :

```text
MediaAdapter.play(url)
 ├─ incrémente currentRequestId
 ├─ arrête la session précédente
 ├─ engine = 'NATIVE'
 ├─ state = 'LOADING'
 ├─ arme fenêtre d’inactivité 10 s
 ├─ fixe plafond absolu 45 s
 ├─ video.src = url
 └─ video.play()
```

Si le moteur natif refuse le flux, `MediaAdapter` passe une seule fois à HLS/MSE
si HLS.js et MSE sont disponibles :

```text
NATIVE failure
 └─ _fallbackToHls()
     ├─ détruit l’ancien pipeline
     ├─ engine = 'HLS_MSE'
     ├─ crée Hls.js
     ├─ loadSource(url)
     └─ attachMedia(video)
```

La fenêtre de 10 secondes est une fenêtre d’inactivité, pas une limite totale.
Un téléchargement FHD actif peut donc durer plus de dix secondes. Le plafond
absolu reste de 45 secondes sans première image.

### 12.5 Lecture effective et watchdog

Quand l’événement `playing` arrive :

```text
MediaAdapter._onPlaying()
 ├─ state = 'PLAYING'
 ├─ annule les timeouts de démarrage
 └─ watchdog.start(currentRequestId)
```

`MediaWatchdog` vérifie chaque seconde. Après huit secondes sans progression, il
appelle `MediaAdapter.handleStallTimeout()`, qui tente une reconnexion.

Règles principales :

- une reconnexion par moteur ;
- NATIVE peut ensuite basculer vers HLS/MSE ;
- HLS/MSE ne revient pas vers NATIVE ;
- une erreur HTTP 401/403 HLS ne déclenche pas de retry ;
- `requestId` empêche une ancienne session de modifier la nouvelle après un zap.

### 12.6 Commandes pendant la lecture

`RemoteKeys.classifyKey()` transforme les touches selon le contexte lecteur :

| Touche | Action |
|---|---|
| ↑ / ↓ | chaîne précédente/suivante ou épisode précédent/suivant |
| PROG− / PROG+ | zap précédent/suivant |
| Play/Pause | lecture ou pause |
| Rewind/Fast Forward | déplacement de 10 secondes pour VOD/épisodes |
| INFO | réaffiche l’OSD |
| Back / Échap / Stop | ferme le lecteur |
| Home | revient à l’onglet Playlistes |

`createRepeatGate()` évite qu’une touche répétée toutes les 30 ms relance trop
de zappings ou de rendus.

---

## 13. Lecture d’un film

Un film suit presque exactement la même chaîne qu’une chaîne Live :

```text
Onglet Films
 └─ VirtualList affiche un item vod
     └─ clic ou OK
         └─ activateChannel('vod', item, index)
             ├─ state.playing = { kind: 'vod', index }
             ├─ openPlayer()
             ├─ adapter.play(item.streamUrl)
             └─ osd.setStatus('VOD : ' + item.name)
```

Différences avec le Live :

- le film est indexable ; le seek ±10 secondes est autorisé ;
- il n’y a pas de zapping vers des chaînes Live ;
- l’événement `ended` place le lecteur dans l’état `ENDED` ;
- la fermeture appelle `adapter.stop()` et revient à la liste.

---

## 14. Séries : cas particulier

Les séries sont importées comme fiches légères. Les épisodes ne sont pas chargés
pendant l’import global.

### 14.1 Ouverture du détail

```text
activateChannel('series', item)
 └─ openSeriesDetail(item)
     ├─ crée l’overlay détail
     ├─ affiche nom, note, résumé et catégorie
     └─ seriesBrowser.ensureInfo(playlist, item)
```

`SeriesBrowser.ensureInfo()` :

1. cherche `series_info` par id ;
2. vérifie la version de format et le TTL de 24 heures ;
3. si le cache est valide, le réutilise ;
4. sinon appelle `XtreamClient.seriesInfoUrl()` ;
5. normalise les réponses `seasons`, `episodes` ou `entries` ;
6. écrit le cache, sans faire échouer l’affichage si le cache est impossible.

### 14.2 Navigation saisons / épisodes

- plusieurs saisons : écran Saisons puis écran Épisodes ;
- une seule saison : accès direct aux épisodes ;
- flèche gauche au niveau épisodes : retour aux saisons ;
- Back / Échap : ferme l’overlay.

### 14.3 Lecture d’un épisode

```text
playEpisode(playlist, series, season, episode)
 ├─ closeSeriesDetail()
 ├─ openPlayer()
 ├─ SeriesBrowser.episodeUrl()
 ├─ adapter.play(url)
 └─ état playing = 'episode'
```

L’URL finale est :

```text
{base}/series/{username}/{password}/{episode_id}.{extension}
```

---

## 15. Focus, télécommande et navigation

### 15.1 `RemoteKeys` puis `FocusEngine`

L’ordre de traitement est :

```text
window.keydown
 ├─ handleRemoteKey()       ← contexte prioritaire
 └─ FocusEngine.handleKeyDown() ← navigation générique si non consommée
```

Les champs de formulaire conservent leurs touches natives. Le panneau série et
le lecteur ont leurs propres règles. Quand aucune règle contextuelle ne
s’applique, `FocusEngine` navigue dans sa liste de focusables.

### 15.2 Entrée / OK

Un élément avec `tabIndex = -1` ne déclenche pas forcément un clic natif sur OK.
Le `FocusEngine` émet donc :

```text
FocusEngine.activateCurrent()
 └─ focus-activate { element }
     └─ app.js appelle element.click()
```

Cela donne le même comportement au D-pad et au clic Magic Remote.

### 15.3 Retour webOS

`FocusEngine` maintient une pile LIFO :

```text
Retour
 ├─ ferme l’épisode / revient aux saisons
 ├─ ferme le détail série
 ├─ ferme le lecteur
 └─ si rien n’est ouvert : window.webOS.platformBack()
```

### 15.4 Virtualisation

`VirtualList` crée une fenêtre de lignes visibles. Il conserve un pool de nœuds
et les repositionne avec `translateY`. Les noms provenant du serveur sont mis
dans `textContent`, jamais dans `innerHTML`.

---

## 16. Veille, retour au premier plan et VPU

`LifecycleAdapter` écoute `visibilitychange`.

### Quand l’application devient cachée

```text
visibilitychange(hidden)
 ├─ sauvegarde URL
 ├─ sauvegarde position vidéo
 ├─ sauvegarde wasActive
 └─ mediaAdapter.releaseHardware()
     ├─ arrête watchdog
     ├─ détruit HLS.js
     ├─ enlève src
     └─ libère le pipeline vidéo
```

### Quand l’application revient au premier plan

Si la session était active :

```text
visibilitychange(visible)
 └─ mediaAdapter.play(url)
     └─ seek à la position précédente pour un VOD si position > 5 s
```

Pour une URL à token, un `urlResolver` peut fournir une nouvelle URL avant la
reprise. Le lecteur Live ne tente pas de restaurer une position non pertinente.

---

## 17. Progression et événements d’import

`ImportBadge` est un composant d’affichage uniquement. Il ne bloque jamais le
worker et n’est pas intégré à la navigation D-pad.

### Séquence normale Xtream

```text
import-start
 └─ création du badge + profil

import-phase(auth/categories/catalogue/write-*)
 └─ libellé de phase

import-meta
 └─ totalItems si mode global disponible

import-rows
 └─ lignes réellement écrites en base

import-complete
 └─ 100 % + « terminé »

import-finished
 └─ durée totale + profileId + profileLabel
```

### Séquence d’erreur

```text
import-error
 ├─ DataManager marque failed
 ├─ purge le staging de cet import
 ├─ badge affiche le message
 └─ la playlist active reste inchangée
```

### Séquence d’annulation

```text
clic Annuler
 └─ PlaylistManager.abort()
     ├─ controller.abort()
     ├─ abortedImports.add(importId)
     ├─ ABORT_IMPORT au worker
     ├─ status = failed
     └─ purge des lignes partielles
```

---

## 18. Réglages complémentaires à connaître

| Réglage | Valeur | Module | Effet |
|---|---:|---|---|
| recherche maximale | 200 résultats | `config.js` | limite l’affichage d’une recherche |
| fenêtre EPG | 6 heures | `config.js` | programme suivant chargé autour de maintenant |
| taille ligne virtuelle | 60 px | `app.js` | calcul de la fenêtre DOM |
| overscan | 4 lignes | `app.js` | lignes préparées au-dessus et au-dessous |
| timeout d’ouverture IDB | 8 s | `bootstrap.js` | évite un démarrage bloqué |
| timeout d’inactivité vidéo | 10 s | `MediaAdapter.js` | détecte une absence de progression |
| plafond de démarrage vidéo | 45 s | `MediaAdapter.js` | limite totale avant première image |
| watchdog lecteur | 8 s | `Watchdog.js` | déclenche une récupération après stall |
| récupération média | 1 par moteur | `MediaAdapter.js` | borne les retries |
| délai Magic Remote | 5 px | `FocusEngine.js` | ignore les micro-mouvements |
| TTL détail série | 24 h | `SeriesBrowser.js` | durée du cache `series_info` |
| lot IndexedDB par défaut | 2 000 lignes | `ImportProfiles.js` + trois workers | zone de confort TV |
| CHUNK IndexedDB en vol | 2 | trois workers | chevauchement mapping/écriture |
| écriture contenu | `bulkAdd` uniquement | `DataManager.js` | évite le chemin de remplacement |
| respiration | tous les 4 lots, une frame | `DataManager.js` | pas de pause fixe à chaque lot |
| GC d’un ancien import | tranches de 500 | `DataManager.js` | suppression hors transaction de swap |
| taille globale Xtream maximale | 40 MiB | `xtream.worker.js` | déclenche le repli par catégories |
| texte en vol M3U/XMLTV | 4 chunks | `ImportController.js` | watermark mémoire réseau |
| fallback texte sans streaming | 30 MiB | `ImportController.js` | limite mémoire sans ReadableStream |

---

## 19. Lecture rapide des fichiers importants

```text
index.html
  point d'entrée HTML et indicateur #boot-step

src/app.js
  main(), layout, formulaires, bouton Importer/EPG, listes, lecteur, télécommande

src/bootstrap.js
  capacités, Dexie, maintenance, création des paires Worker/DataManager/Controller

src/data/db.js
  schéma IndexedDB/Dexie

src/services/PlaylistManager.js
  création, suppression, import, abort, swap de haut niveau, maintenance

src/data/ImportController.js
  fetch M3U/XMLTV, watermark, terminaison, abort, durée

src/data/xtream.worker.js
  API Xtream, profil par défaut, mapping compact, CHUNK, ordre live/VOD/séries

src/data/m3u.worker.js
  parsing M3U, catégories, lots de 2 000

src/data/epg.worker.js
  parsing XMLTV, dates, lots EPG de 2 000

src/data/DataManager.js
  file d’écriture IndexedDB, bulkAdd, progression, swap rapide, GC lazy, quota

src/data/ImportProfiles.js
  profil unique de production TV

src/components/ImportBadge.js
  phases, pourcentage, durée et profil

src/services/SeriesBrowser.js
  détail lazy des séries, normalisation et cache 24 h

src/ui/VirtualList.js
  fenêtre DOM recyclée

src/ui/FocusEngine.js + src/ui/RemoteKeys.js
  focus, OK, Back, D-pad, Magic Remote et zapping

src/media/MediaAdapter.js
  lecture native, fallback HLS/MSE, timeout, récupération

src/platform/LifecycleAdapter.js
  veille, libération VPU et reprise
```

---

## 20. Résumé en une phrase par action

### Ouvrir l’application

```text
index.html → app.main() → boot() → db.open() → maintenance → playlist par défaut → UI
```

### Ajouter une playlist

```text
formulaire → PlaylistManager.create() → validation → db.playlists.add()
```

### Importer Xtream

```text
bouton → importPlaylist() → startImport() → xtream.worker → CHUNK → DataManager → swap
```

### Importer M3U

```text
bouton → importPlaylist() → fetch/ReadableStream → m3u.worker → CHUNK → DataManager → swap
```

### Afficher les catalogues

```text
activeImportId → channels/vod/series() → orderRows() → filtres → VirtualList
```

### Lire une chaîne ou un film

```text
OK/clic → activateChannel() → openPlayer() → MediaAdapter.play() → NATIVE ou HLS/MSE
```

### Lire un épisode

```text
série → SeriesBrowser.ensureInfo() → saison/épisode → playEpisode() → MediaAdapter.play()
```

### Erreur quota

```text
DB error → failImport() → purge staging → ancien catalogue conservé → STORAGE_QUOTA si nécessaire
```

---

## 21. Limite conceptuelle importante

Le swap sécurisé nécessite que le stockage puisse contenir temporairement :

```text
catalogue actuel + nouveau catalogue en construction
```

C’est le prix de la protection contre les imports partiels. La V18 publie le
nouveau pointeur rapidement, puis supprime l’ancien catalogue par petites
tranches ; elle ne supprime jamais l’actif avant que le nouveau soit complet.

Pour un grand panneau Xtream sur une TV à quota très réduit, le bon diagnostic
est donc :

1. vérifier que les reliquats `failed` ont été purgés ;
2. relancer avec le profil standard ou un lot plus petit ;
3. si `STORAGE_QUOTA` persiste, libérer l’espace local de l’application ;
4. ne pas supprimer silencieusement l’import actif pendant un import.
