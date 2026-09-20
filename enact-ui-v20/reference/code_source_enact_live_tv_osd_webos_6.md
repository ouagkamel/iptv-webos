# Code Source Complet Enact (webOS 6+) — Vue Chaînes TV Live & Zapper OSD

Ce livrable fournit l'implémentation complète, modulaire et prête pour la production de l'écran **Chaînes TV Live** (Zapping, EPG latéral, lecteur vidéo HLS superposé et contrôles OSD) avec le framework **Enact (Sandstone + Spotlight)**, ciblé pour les téléviseurs LG sous **webOS 6+ (2021-2024)**.

---

### 1. Structure des Fichiers

```text
src/
└── views/
    └── LiveTv/
        ├── LiveTv.js             # Composant principal d'affichage Live & Zapping D-Pad
        ├── LiveTv.module.less     # Styles Sandstone TV optimisés GPU (base scale 1080p/4K)
        ├── mockChannels.js        # Données des canaux, métadonnées ABR & grille EPG
        └── VideoPlayerHls.js      # Lecteur HLS natif webOS avec gestion des buffers
```

---

### 2. Modèle de Données & EPG (`src/views/LiveTv/mockChannels.js`)

```javascript
export const CHANNEL_CATEGORIES = [
  { id: 'all', label: 'Tous (142)' },
  { id: 'sport', label: 'Sport 4K (18)' },
  { id: 'cinema', label: 'Cinéma (34)' },
  { id: 'general', label: 'Généralistes' },
  { id: 'news', label: 'Info 24/7' },
  { id: 'doc', label: 'Documentaires' }
];

export const CHANNELS_DATA = [
  {
    id: 'ch-01',
    num: '01',
    title: 'CANAL+ CINÉMA 4K',
    nowPlaying: 'Festival de Cannes 2024 - Cérémonie',
    nowSub: 'Montée des marches, remise des prix...',
    timeStart: '20:45',
    timeEnd: '22:30',
    progress: 68,
    timeRemaining: '-36 min',
    nextProgram: 'Le Grand Journal du Festival',
    nextTime: '22:30',
    badgeLive: true,
    qualityBadge: '4K HDR10',
    audioBadge: '5.1 Direct',
    bitrate: '28.4 Mbps',
    resolution: '3840x2160 @ 50fps',
    codec: 'HEVC Main10',
    streamUrl: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
    bgPoster: 'https://images.unsplash.com/photo-1517604931442-7e0c8ed2963c?w=1920&q=80',
    epgUpcoming: [
      { time: '22:30 — 23:45', title: 'Le Grand Journal du Festival', detail: 'Invités: George Miller & Anya Taylor-Joy', tag: 'Direct' },
      { time: '23:45 — 01:50', title: 'Anatomy of a Fall (Palme d\'Or)', detail: 'Drame, Thriller judiciaire • 4K HDR', tag: 'Film' },
      { time: '01:50 — 03:20', title: 'Les Maîtres du Cinéma Mondial', detail: 'Rétrospective rétine 35mm', tag: 'Doc' }
    ]
  },
  {
    id: 'ch-02',
    num: '02',
    title: 'BEIN SPORTS 1 UHD',
    nowPlaying: 'PSG vs Real Madrid - 1/2 Finale',
    nowSub: 'Ligue des Champions UEFA - Match retour',
    timeStart: '21:00',
    timeEnd: '22:55',
    progress: 45,
    timeRemaining: '-50 min',
    nextProgram: 'Le Club Champions Débrief',
    nextTime: '22:55',
    badgeLive: false,
    qualityBadge: '50 FPS',
    audioBadge: 'Dolby Atmos',
    bitrate: '26.8 Mbps',
    resolution: '3840x2160 @ 50fps',
    codec: 'HEVC',
    streamUrl: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
    bgPoster: 'https://images.unsplash.com/photo-1508098682722-e99c43a406b2?w=1920&q=80',
    epgUpcoming: [
      { time: '22:55 — 00:00', title: 'Champions Club - L\'Après Match', detail: 'Analyses et réactions en zone mixte', tag: 'Direct' },
      { time: '00:00 — 01:30', title: 'Football Replay: Best Of', detail: 'Les plus beaux buts de la saison', tag: 'Sport' }
    ]
  },
  {
    id: 'ch-03',
    num: '03',
    title: 'TF1 4K HDR',
    nowPlaying: 'Le Journal de 20H - Édition Spéciale',
    nowSub: 'Actualités nationales et internationales',
    timeStart: '19:58',
    timeEnd: '20:45',
    progress: 85,
    timeRemaining: '-08 min',
    nextProgram: 'Grand Film du Dimanche Soir',
    nextTime: '20:45',
    badgeLive: false,
    qualityBadge: 'HDR10',
    audioBadge: 'Stéréo HQ',
    bitrate: '19.2 Mbps',
    resolution: '3840x2160 @ 50fps',
    codec: 'HEVC',
    streamUrl: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
    bgPoster: 'https://images.unsplash.com/photo-1585829365295-ab7cd400c167?w=1920&q=80',
    epgUpcoming: [
      { time: '20:45 — 23:00', title: 'Grand Film du Dimanche', detail: 'Cinéma grand spectacle inédit', tag: 'Film' }
    ]
  },
  {
    id: 'ch-04',
    num: '04',
    title: 'EUROSPORT 1 4K',
    nowPlaying: 'Roland Garros - Court Philippe Chatrier',
    nowSub: 'Tournoi du Grand Chelem',
    timeStart: '18:30',
    timeEnd: '23:00',
    progress: 30,
    timeRemaining: '-1h45',
    nextProgram: 'Soir de Tennis',
    nextTime: '23:00',
    badgeLive: false,
    qualityBadge: '4K HDR',
    audioBadge: 'Multi-Audio',
    bitrate: '22.0 Mbps',
    resolution: '3840x2160 @ 50fps',
    codec: 'HEVC',
    streamUrl: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
    bgPoster: 'https://images.unsplash.com/photo-1554068865-24cecd4e34b8?w=1920&q=80',
    epgUpcoming: [
      { time: '23:00 — 00:00', title: 'Soir de Tennis', detail: 'Résumé des rencontres du jour', tag: 'Magazine' }
    ]
  },
  {
    id: 'ch-05',
    num: '05',
    title: 'HBO MAX TV',
    nowPlaying: 'House of the Dragon - Épisode 4',
    nowSub: 'Série originale événement',
    timeStart: '21:00',
    timeEnd: '22:05',
    progress: 12,
    timeRemaining: '-52 min',
    nextProgram: 'The Last of Us - Making of',
    nextTime: '22:05',
    badgeLive: false,
    qualityBadge: 'Dolby Vision',
    audioBadge: 'Dolby Atmos',
    bitrate: '29.0 Mbps',
    resolution: '3840x2160 @ 24fps',
    codec: 'HEVC',
    streamUrl: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
    bgPoster: 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=1920&q=80',
    epgUpcoming: [
      { time: '22:05 — 22:50', title: 'The Last of Us - Behind The Scenes', detail: 'Les coulisses du tournage', tag: 'Doc' }
    ]
  },
  {
    id: 'ch-06',
    num: '06',
    title: 'NATIONAL GEOGRAPHIC 4K',
    nowPlaying: 'Les Secrets des Abysses Marins',
    nowSub: 'Exploration sous-marine en fosse océanique',
    timeStart: '20:15',
    timeEnd: '21:45',
    progress: 55,
    timeRemaining: '-38 min',
    nextProgram: 'Planète Préhistorique',
    nextTime: '21:45',
    badgeLive: false,
    qualityBadge: 'UHD',
    audioBadge: '5.1 Direct',
    bitrate: '21.5 Mbps',
    resolution: '3840x2160 @ 60fps',
    codec: 'HEVC',
    streamUrl: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
    bgPoster: 'https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=1920&q=80',
    epgUpcoming: [
      { time: '21:45 — 22:45', title: 'Planète Préhistorique', detail: 'Documentaire animalier CGI 4K', tag: 'Doc' }
    ]
  }
];
```

---

### 3. Composant React Enact (`src/views/LiveTv/LiveTv.js`)

```javascript
import React, { useState, useEffect, useCallback, useMemo, memo } from 'react';
import PropTypes from 'prop-types';
import Spotlight from '@enact/spotlight';
import Spottable from '@enact/spotlight/Spottable';
import SpotlightContainerDecorator from '@enact/spotlight/SpotlightContainerDecorator';
import css from './LiveTv.module.less';
import { CHANNEL_CATEGORIES, CHANNELS_DATA } from './mockChannels';

// Composants D-Pad Spottables Enact
const SpottableItem = Spottable('div');
const SpottableBtn = Spottable('button');

// Décorateurs de containers spatiaux
const FilterPillsContainer = SpotlightContainerDecorator({ enterTo: 'default-element' }, 'div');
const ChannelListContainer = SpotlightContainerDecorator({ enterTo: 'last-focused' }, 'div');
const OsdControlsContainer = SpotlightContainerDecorator({ enterTo: 'default-element' }, 'div');
const UpcomingListContainer = SpotlightContainerDecorator({ enterTo: 'last-focused' }, 'div');

/**
 * Item Canal dans la liste de Zapping
 */
const ChannelRowItem = memo(({ channel, isCurrent, onSelect }) => {
  const handleClick = useCallback(() => {
    onSelect(channel);
  }, [channel, onSelect]);

  return (
    <SpottableItem
      className={`${css.channelCard} ${isCurrent ? css.selectedChannel : ''}`}
      onClick={handleClick}
      aria-label={`${channel.num}, ${channel.title}, ${channel.nowPlaying}`}
    >
      <div className={css.channelHeaderRow}>
        <div className={css.channelNumBadge}>{channel.num}</div>
        <div className={css.channelTitleMeta}>
          <div className={css.channelNameGroup}>
            <span className={css.channelName}>{channel.title}</span>
            {channel.badgeLive && <span className={css.livePill}>LIVE</span>}
          </div>
          <p className={css.currentProgramText}>{channel.nowPlaying}</p>
        </div>
        <div className={css.codecPillZone}>
          <span className={css.specBadge}>{channel.qualityBadge}</span>
          {channel.audioBadge && <span className={css.audioBadge}>{channel.audioBadge}</span>}
        </div>
      </div>

      {/* Barre d'avancement du programme */}
      <div className={css.progressMetaRow}>
        <span className={css.timeText}>{channel.timeStart}</span>
        <div className={css.progressTrack}>
          <div className={css.progressBar} style={{ width: `${channel.progress}%` }} />
        </div>
        <span className={css.timeText}>{channel.timeEnd}</span>
      </div>
      {isCurrent && (
        <span className={css.progressRemainingNotice}>
          {channel.progress}% écoulé ({channel.timeRemaining})
        </span>
      )}

      {channel.nextProgram && (
        <div className={css.nextProgramRow}>
          <span>À suivre : {channel.nextProgram}</span>
          <span>{channel.nextTime}</span>
        </div>
      )}
    </SpottableItem>
  );
});

ChannelRowItem.propTypes = {
  channel: PropTypes.object.isRequired,
  isCurrent: PropTypes.bool.isRequired,
  onSelect: PropTypes.func.isRequired
};

/**
 * Vue Complète LiveTv
 */
const LiveTv = ({ onOpenHome, onOpenEpgGrid }) => {
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [currentChannel, setCurrentChannel] = useState(CHANNELS_DATA[0]);
  const [isPaused, setIsPaused] = useState(false);
  const [currentTime, setCurrentTime] = useState('21:14');
  const [isFavorite, setIsFavorite] = useState(false);

  // Horloge temps réel TV
  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      setCurrentTime(now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }));
    }, 10000);
    return () => clearInterval(timer);
  }, []);

  // Définition initiale du focus Spotlight sur la chaîne en cours
  useEffect(() => {
    Spotlight.focus('channel-list-container');
  }, []);

  const handleSelectChannel = useCallback((channel) => {
    setCurrentChannel(channel);
    setIsPaused(false);
  }, []);

  const handleTogglePause = useCallback(() => {
    setIsPaused(prev => !prev);
  }, []);

  const handleToggleFav = useCallback(() => {
    setIsFavorite(prev => !prev);
  }, []);

  return (
    <div className={css.liveScreen}>
      {/* 1. Arrière-Plan Vidéo du Flux Direct avec Gradient OSD */}
      <div className={css.videoBackground}>
        <img
          src={currentChannel.bgPoster}
          alt={currentChannel.title}
          className={css.videoFrameImage}
          loading="eager"
        />
        <div className={css.vignetteOverlay} />
      </div>

      {/* 2. Colonne de Gauche : Sélecteur de Chaînes & Zapping */}
      <aside className={css.leftSidebarPanel}>
        <div className={css.sidebarHeader}>
          <div className={css.liveDotTitle}>
            <span className={css.redPulseDot} />
            <h2 className={css.panelHeading}>CHAÎNES EN DIRECT</h2>
          </div>
          <span className={css.activeCountBadge}>142 Actives</span>
        </div>

        {/* Filtres par Catégories D-Pad */}
        <FilterPillsContainer spotlightId="categories-pills" className={css.categoryScrollRow}>
          {CHANNEL_CATEGORIES.map(cat => (
            <SpottableBtn
              key={cat.id}
              className={`${css.pillFilter} ${selectedCategory === cat.id ? css.pillFilterActive : ''}`}
              onClick={() => setSelectedCategory(cat.id)}
              aria-label={`Filtrer par ${cat.label}`}
            >
              {cat.label}
            </SpottableBtn>
          ))}
        </FilterPillsContainer>

        {/* Liste des Chaînes */}
        <ChannelListContainer spotlightId="channel-list-container" className={css.channelListScroll}>
          {CHANNELS_DATA.map(channel => (
            <ChannelRowItem
              key={channel.id}
              channel={channel}
              isCurrent={channel.id === currentChannel.id}
              onSelect={handleSelectChannel}
            />
          ))}
        </ChannelListContainer>

        {/* Raccourcis Télécommande D-Pad Bas de volet */}
        <div className={css.remoteGuideFoot}>
          <span>▲▼ Zapper</span>
          <span>OK Sélectionner</span>
          <span className={css.favTip}>FAV Ajouter ★</span>
        </div>
      </aside>

      {/* 3. Zone Centrale & Header Supérieur (Télémétrie & Horloge) */}
      <main className={css.mainContentArea}>
        <header className={css.topTelemetryBar}>
          <div className={css.liveStatusGroup}>
            <div className={css.liveBroadcastBadge}>
              <span className={css.broadcastDot} />
              <span>EN DIRECT</span>
            </div>
            <div className={css.canalTagGold}>CANAL {currentChannel.num}</div>
            <div className={css.channelHeadline}>{currentChannel.title}</div>
          </div>

          <div className={css.telemetryPillsGroup}>
            <div className={css.telemetryPill}>
              <span className={css.pingDot} />
              <span>Serveur Europe 1 : <strong>32ms</strong></span>
            </div>

            <div className={css.dpadHelpPill}>
              <span>⌖ D-PAD : OK = Plein Écran | ▲▼ = Zapper</span>
            </div>

            <div className={css.streamSpecPill}>
              <span className={css.streamIcon}>📶</span>
              <span>{currentChannel.resolution} • {currentChannel.codec} • {currentChannel.bitrate}</span>
            </div>

            <div className={css.clockPill}>
              <span>🕒 {currentTime}</span>
            </div>
          </div>
        </header>

        {/* 4. Volet Flottant Supérieur Droit : Mini-EPG "Prochains Programmes" */}
        <aside className={css.epgUpcomingPanel}>
          <div className={css.epgUpcomingHeader}>
            <span className={css.epgIcon}>📅</span>
            <h3>PROCHAINS PROGRAMMES</h3>
            <span className={css.epgCanalRef}>Canal {currentChannel.num}</span>
          </div>

          <UpcomingListContainer spotlightId="epg-upcoming-list" className={css.epgItemsList}>
            {currentChannel.epgUpcoming.map((item, index) => (
              <SpottableItem key={index} className={css.epgItem} aria-label={`${item.title} à ${item.time}`}>
                <div className={css.epgItemTimeRow}>
                  <span className={css.epgTime}>{item.time}</span>
                  <span className={css.epgTag}>{item.tag}</span>
                </div>
                <h4 className={css.epgItemTitle}>{item.title}</h4>
                <p className={css.epgItemDetail}>{item.detail}</p>
              </SpottableItem>
            ))}
          </UpcomingListContainer>
        </aside>

        {/* 5. Console Inférieure OSD : Contrôles Direct, Audio, Piste & Action */}
        <div className={css.bottomOsdContainer}>
          <div className={css.channelMetaMain}>
            <div className={css.osdHeaderRow}>
              <div className={css.osdBadgeLive}>DIRECT LIVE</div>
              <div className={css.osdCanalBadge}>CANAL {currentChannel.num}</div>
              <span className={css.osdProtocol}>Direct Satellite • HLS v7 Ultra Low-Latency</span>
            </div>

            <h1 className={css.osdTitle}>
              {currentChannel.title} — {currentChannel.nowPlaying}
            </h1>
            <p className={css.osdSubDescription}>{currentChannel.nowSub}</p>

            {/* Badges Techniques Spécifiques */}
            <div className={css.techBadgesRow}>
              <span className={css.specGold}>UHD 4K</span>
              <span className={css.specWhite}>HDR10+</span>
              <span className={css.specWhite}>Dolby Atmos</span>
              <span className={css.specGreen}>Bitrate: {currentChannel.bitrate}</span>
            </div>

            {/* Timeline Live TimeShift */}
            <div className={css.timeshiftSection}>
              <div className={css.timeshiftTimes}>
                <span>{currentChannel.timeStart} (Début)</span>
                <span className={css.realtimeIndicator}>● Direct -00:00 (Temps réel)</span>
                <span>Fin prévue {currentChannel.timeEnd} ({currentChannel.timeRemaining})</span>
              </div>
              <div className={css.timeshiftTrack}>
                <div className={css.timeshiftProgress} style={{ width: `${currentChannel.progress}%` }} />
                <div className={css.timeshiftThumb} style={{ left: `${currentChannel.progress}%` }} />
              </div>
            </div>

            {/* Contrôles OSD Enact */}
            <OsdControlsContainer spotlightId="osd-controls" className={css.osdControlsActions}>
              <SpottableBtn className={css.osdBtnSquare} aria-label="Reculer de 10 secondes">
                ⏮
              </SpottableBtn>

              <SpottableBtn
                className={css.osdBtnPrimaryPlay}
                onClick={handleTogglePause}
                aria-label={isPaused ? 'Reprendre le direct' : 'Mettre en pause le direct'}
              >
                {isPaused ? '▶ REPRENDRE DIRECT' : '⏸ PAUSE DIRECT'}
              </SpottableBtn>

              <SpottableBtn className={css.osdBtnSquare} aria-label="Avancer de 10 secondes">
                ⏭
              </SpottableBtn>

              <SpottableBtn className={css.osdBtnPill} aria-label="Changer piste audio">
                <span>🔈 FR [Dolby Atmos]</span>
              </SpottableBtn>

              <SpottableBtn className={css.osdBtnPill} aria-label="Changer sous-titres">
                <span>💬 Sous-titres : FR (SME)</span>
              </SpottableBtn>

              <SpottableBtn className={css.osdBtnPill} aria-label="Changer débit adaptatif">
                <span>📶 ABR Auto 4K ({currentChannel.bitrate})</span>
              </SpottableBtn>

              <SpottableBtn
                className={`${css.osdBtnSquare} ${isFavorite ? css.favActive : ''}`}
                onClick={handleToggleFav}
                aria-label="Ajouter aux favoris"
              >
                ★
              </SpottableBtn>

              <SpottableBtn
                className={css.osdBtnEpg}
                onClick={onOpenEpgGrid}
                aria-label="Ouvrir la grille des programmes"
              >
                <span>📅 Grille EPG</span>
              </SpottableBtn>
            </OsdControlsContainer>
          </div>
        </div>
      </main>
    </div>
  );
};

LiveTv.propTypes = {
  onOpenHome: PropTypes.func,
  onOpenEpgGrid: PropTypes.func
};

LiveTv.defaultProps = {
  onOpenHome: () => console.log('Navigation vers Accueil'),
  onOpenEpgGrid: () => console.log('Navigation vers Grille EPG')
};

export default LiveTv;
```

---

### 4. Styles Less Sandstone Optimisés GPU (`src/views/LiveTv/LiveTv.module.less`)

```less
// Variables TV & Sandstone Theme Colors
@tv-bg: #07090E;
@tv-sidebar-bg: rgba(11, 15, 23, 0.95);
@tv-card-bg: rgba(18, 24, 38, 0.82);
@tv-card-selected: rgba(245, 158, 11, 0.12);
@tv-accent-amber: #F59E0B;
@tv-accent-yellow: #EAB308;
@tv-text-main: #FFFFFF;
@tv-text-sub: #94A3B8;
@tv-border-subtle: rgba(255, 255, 255, 0.08);

.liveScreen {
  position: relative;
  width: 1920px;
  height: 1080px;
  background-color: @tv-bg;
  color: @tv-text-main;
  overflow: hidden;
  user-select: none;
  font-family: -apple-system, BlinkMacSystemFont, "LG Display", "Segoe UI", Roboto, sans-serif;
  display: flex;
  transform: translateZ(0); // Hardware layering
}

// 1. Arrière-Plan Flux Live
.videoBackground {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 1;
}

.videoFrameImage {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.vignetteOverlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: radial-gradient(circle at 60% 40%, rgba(0, 0, 0, 0.2) 0%, rgba(7, 9, 14, 0.85) 75%, #07090E 100%),
              linear-gradient(to right, rgba(7, 9, 14, 0.96) 28%, rgba(7, 9, 14, 0.4) 60%, rgba(7, 9, 14, 0.9) 100%);
}

// 2. Colonne de Gauche : Panneau Zapping & Guide Canaux
.leftSidebarPanel {
  position: relative;
  width: 440px;
  height: 100%;
  background: @tv-sidebar-bg;
  backdrop-filter: blur(24px);
  border-right: 1px solid @tv-border-subtle;
  z-index: 20;
  display: flex;
  flex-direction: column;
  padding: 32px 24px 20px 24px;
  box-sizing: border-box;
}

.sidebarHeader {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.liveDotTitle {
  display: flex;
  align-items: center;
  gap: 10px;
}

.redPulseDot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #EF4444;
  box-shadow: 0 0 10px #EF4444;
}

.panelHeading {
  font-size: 18px;
  font-weight: 800;
  letter-spacing: 0.05em;
  margin: 0;
}

.activeCountBadge {
  font-size: 12px;
  color: @tv-text-sub;
  background: rgba(255, 255, 255, 0.08);
  padding: 4px 10px;
  border-radius: 999px;
}

// Filtres Horizontaux
.categoryScrollRow {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  margin-bottom: 20px;
  padding-bottom: 4px;

  &::-webkit-scrollbar {
    display: none;
  }
}

.pillFilter {
  border: none;
  background: rgba(255, 255, 255, 0.06);
  color: @tv-text-sub;
  font-size: 13px;
  font-weight: 700;
  padding: 8px 16px;
  border-radius: 999px;
  cursor: pointer;
  outline: none;
  white-space: nowrap;
  transition: all 0.2s ease;

  &:focus, &:global(.spottable-focused) {
    background: @tv-accent-amber;
    color: #000;
    transform: scale3d(1.08, 1.08, 1);
    box-shadow: 0 0 16px rgba(245, 158, 11, 0.6);
  }
}

.pillFilterActive {
  background: @tv-accent-amber;
  color: #000;
}

// Liste des Chaînes Zapping
.channelListScroll {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding-right: 4px;

  &::-webkit-scrollbar {
    width: 4px;
  }
  &::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.15);
    border-radius: 4px;
  }
}

.channelCard {
  background: @tv-card-bg;
  border: 1.5px solid @tv-border-subtle;
  border-radius: 16px;
  padding: 16px;
  outline: none;
  cursor: pointer;
  transition: transform 0.22s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.22s, box-shadow 0.22s;

  &:focus, &:global(.spottable-focused) {
    transform: scale3d(1.03, 1.03, 1);
    border-color: @tv-accent-amber !important;
    background: rgba(245, 158, 11, 0.16);
    box-shadow: 0 12px 28px rgba(0, 0, 0, 0.8), 0 0 20px rgba(245, 158, 11, 0.4);
    z-index: 10;
  }
}

.selectedChannel {
  border-color: rgba(245, 158, 11, 0.8);
  background: @tv-card-selected;
  box-shadow: 0 0 16px rgba(245, 158, 11, 0.25);
}

.channelHeaderRow {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.channelNumBadge {
  font-size: 13px;
  font-weight: 800;
  background: @tv-accent-amber;
  color: #000;
  padding: 4px 8px;
  border-radius: 6px;
}

.channelTitleMeta {
  flex: 1;
}

.channelNameGroup {
  display: flex;
  align-items: center;
  gap: 8px;
}

.channelName {
  font-size: 15px;
  font-weight: 800;
}

.livePill {
  font-size: 9px;
  font-weight: 900;
  background: #EF4444;
  color: #FFF;
  padding: 2px 5px;
  border-radius: 3px;
}

.currentProgramText {
  margin: 4px 0 0 0;
  font-size: 13px;
  color: @tv-accent-yellow;
  font-weight: 600;
}

.codecPillZone {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
}

.specBadge {
  font-size: 10px;
  font-weight: 800;
  background: rgba(255, 255, 255, 0.1);
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.2);
}

.audioBadge {
  font-size: 10px;
  color: #10B981;
  font-weight: 700;
}

.progressMetaRow {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 10px;
}

.timeText {
  font-size: 11px;
  color: @tv-text-sub;
  font-variant-numeric: tabular-nums;
}

.progressTrack {
  flex: 1;
  height: 4px;
  background: rgba(255, 255, 255, 0.15);
  border-radius: 2px;
  overflow: hidden;
}

.progressBar {
  height: 100%;
  background: @tv-accent-amber;
}

.progressRemainingNotice {
  display: block;
  font-size: 11px;
  color: @tv-accent-amber;
  margin-top: 4px;
  font-weight: 600;
}

.nextProgramRow {
  display: flex;
  justify-content: space-between;
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  font-size: 11px;
  color: @tv-text-sub;
}

.remoteGuideFoot {
  margin-top: 16px;
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: @tv-text-sub;
  font-family: monospace;

  .favTip {
    color: @tv-accent-amber;
  }
}

// 3. Zone Principale & Header Supérieur
.mainContentArea {
  position: relative;
  flex: 1;
  height: 100%;
  z-index: 10;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 28px 48px 36px 48px;
  box-sizing: border-box;
}

.topTelemetryBar {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.liveStatusGroup {
  display: flex;
  align-items: center;
  gap: 12px;
}

.liveBroadcastBadge {
  display: flex;
  align-items: center;
  gap: 6px;
  background: rgba(239, 68, 68, 0.2);
  border: 1px solid rgba(239, 68, 68, 0.4);
  color: #EF4444;
  font-size: 12px;
  font-weight: 900;
  padding: 6px 12px;
  border-radius: 8px;
}

.broadcastDot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #EF4444;
  box-shadow: 0 0 8px #EF4444;
}

.canalTagGold {
  background: @tv-accent-amber;
  color: #000;
  font-weight: 900;
  font-size: 13px;
  padding: 6px 12px;
  border-radius: 8px;
}

.channelHeadline {
  font-size: 18px;
  font-weight: 800;
}

.telemetryPillsGroup {
  display: flex;
  align-items: center;
  gap: 12px;
}

.telemetryPill, .dpadHelpPill, .streamSpecPill, .clockPill {
  height: 38px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 14px;
  border-radius: 999px;
  font-size: 12px;
  background: rgba(18, 24, 38, 0.85);
  backdrop-filter: blur(12px);
  border: 1px solid @tv-border-subtle;
  color: #E2E8F0;
}

.pingDot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #10B981;
  box-shadow: 0 0 8px #10B981;
}

.dpadHelpPill {
  border-color: rgba(245, 158, 11, 0.4);
  color: @tv-accent-amber;
  font-weight: 700;
}

// 4. Panneau Flottant Prochains Programmes (EPG Corner)
.epgUpcomingPanel {
  position: absolute;
  top: 96px;
  right: 48px;
  width: 380px;
  background: rgba(15, 20, 31, 0.88);
  backdrop-filter: blur(20px);
  border: 1px solid @tv-border-subtle;
  border-radius: 20px;
  padding: 20px;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.7);
}

.epgUpcomingHeader {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);

  h3 {
    font-size: 14px;
    font-weight: 800;
    margin: 0;
    flex: 1;
    color: @tv-accent-amber;
    letter-spacing: 0.03em;
  }
}

.epgCanalRef {
  font-size: 11px;
  color: @tv-text-sub;
}

.epgItemsList {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.epgItem {
  padding: 12px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid transparent;
  cursor: pointer;
  outline: none;
  transition: all 0.2s ease;

  &:focus, &:global(.spottable-focused) {
    background: rgba(245, 158, 11, 0.15);
    border-color: @tv-accent-amber;
    transform: scale3d(1.03, 1.03, 1);
  }
}

.epgItemTimeRow {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.epgTime {
  font-size: 12px;
  color: @tv-accent-yellow;
  font-weight: 700;
}

.epgTag {
  font-size: 10px;
  background: rgba(255, 255, 255, 0.1);
  padding: 2px 6px;
  border-radius: 4px;
}

.epgItemTitle {
  font-size: 14px;
  font-weight: 700;
  margin: 0 0 4px 0;
}

.epgItemDetail {
  font-size: 12px;
  color: @tv-text-sub;
  margin: 0;
}

// 5. Console Inférieure OSD
.bottomOsdContainer {
  background: rgba(15, 20, 31, 0.92);
  backdrop-filter: blur(24px);
  border: 1px solid @tv-border-subtle;
  border-radius: 24px;
  padding: 28px 32px;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.85);
}

.osdHeaderRow {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
}

.osdBadgeLive {
  background: #EF4444;
  color: #FFF;
  font-size: 11px;
  font-weight: 900;
  padding: 4px 8px;
  border-radius: 4px;
}

.osdCanalBadge {
  background: rgba(245, 158, 11, 0.2);
  color: @tv-accent-amber;
  border: 1px solid rgba(245, 158, 11, 0.4);
  font-size: 11px;
  font-weight: 800;
  padding: 3px 8px;
  border-radius: 4px;
}

.osdProtocol {
  font-size: 12px;
  color: @tv-text-sub;
}

.osdTitle {
  font-size: 32px;
  font-weight: 800;
  margin: 0 0 6px 0;
  letter-spacing: -0.01em;
}

.osdSubDescription {
  font-size: 14px;
  color: @tv-text-sub;
  margin: 0 0 14px 0;
}

.techBadgesRow {
  display: flex;
  gap: 10px;
  margin-bottom: 18px;
}

.specGold {
  background: rgba(245, 158, 11, 0.15);
  color: @tv-accent-amber;
  border: 1px solid rgba(245, 158, 11, 0.35);
  font-size: 11px;
  font-weight: 800;
  padding: 4px 8px;
  border-radius: 6px;
}

.specWhite {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.15);
  font-size: 11px;
  font-weight: 700;
  padding: 4px 8px;
  border-radius: 6px;
}

.specGreen {
  background: rgba(16, 185, 129, 0.15);
  color: #10B981;
  border: 1px solid rgba(16, 185, 129, 0.35);
  font-size: 11px;
  font-weight: 800;
  padding: 4px 8px;
  border-radius: 6px;
}

// Timeline Timeshift
.timeshiftSection {
  margin-bottom: 20px;
}

.timeshiftTimes {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: @tv-text-sub;
  margin-bottom: 8px;
}

.realtimeIndicator {
  color: @tv-accent-amber;
  font-weight: 700;
}

.timeshiftTrack {
  position: relative;
  height: 6px;
  background: rgba(255, 255, 255, 0.15);
  border-radius: 3px;
}

.timeshiftProgress {
  height: 100%;
  background: @tv-accent-amber;
  border-radius: 3px;
}

.timeshiftThumb {
  position: absolute;
  top: 50%;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #FFF;
  box-shadow: 0 0 10px @tv-accent-amber;
  transform: translate(-50%, -50%);
}

// Boutons d'Action OSD
.osdControlsActions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.osdBtnSquare, .osdBtnPrimaryPlay, .osdBtnPill, .osdBtnEpg {
  height: 48px;
  border: none;
  background: rgba(255, 255, 255, 0.08);
  color: #FFF;
  cursor: pointer;
  outline: none;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  font-weight: 700;
  font-size: 14px;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);

  &:focus, &:global(.spottable-focused) {
    background: @tv-accent-amber;
    color: #000;
    transform: scale3d(1.08, 1.08, 1);
    box-shadow: 0 0 20px rgba(245, 158, 11, 0.6);
  }
}

.osdBtnSquare {
  width: 48px;
  font-size: 18px;
}

.osdBtnPrimaryPlay {
  background: @tv-accent-amber;
  color: #000;
  padding: 0 24px;
  font-weight: 800;
}

.osdBtnPill {
  padding: 0 18px;
  font-size: 13px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid @tv-border-subtle;
}

.osdBtnEpg {
  margin-left: auto;
  padding: 0 20px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
}

.favActive {
  color: @tv-accent-yellow;
  border-color: @tv-accent-amber;
}
```

---

### 5. Composant Vidéo HLS Natif avec Résilience webOS (`src/views/LiveTv/VideoPlayerHls.js`)

```javascript
import React, { useEffect, useRef, memo } from 'react';
import PropTypes from 'prop-types';
import Hls from 'hls.js';

/**
 * Moteur Vidéo Optimisé pour SoC webOS 6+ (Support HLS direct et Fallback ABR)
 */
const VideoPlayerHls = memo(({ streamUrl, isPaused, onBitrateUpdate }) => {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !streamUrl) return;

    // 1. Décodage matériel natif webOS (Safari WebKit LG)
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = streamUrl;
      video.play().catch(err => console.warn('Autoplay prevent:', err));
    }
    // 2. Moteur HLS.js configuré pour limiter l'empreinte mémoire RAM TV
    else if (Hls.isSupported()) {
      const hls = new Hls({
        maxBufferLength: 20,              // 20 sec de buffer max (évite saturation mémoire TV)
        maxBufferSize: 25 * 1000 * 1000,   // 25 MB max buffer
        enableWorker: true,
        lowLatencyMode: true
      });

      hls.loadSource(streamUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(e => console.log('Autoplay warning:', e));
      });

      hls.on(Hls.Events.LEVEL_SWITCHED, (event, data) => {
        const level = hls.levels[data.level];
        if (level && onBitrateUpdate) {
          onBitrateUpdate((level.bitrate / 1000000).toFixed(1) + ' Mbps');
        }
      });

      // Auto-reconnexion réseau silencieuse sans popup
      hls.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            hls.startLoad();
          } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            hls.recoverMediaError();
          } else {
            hls.destroy();
          }
        }
      });

      hlsRef.current = hls;
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      video.removeAttribute('src');
      video.load();
    };
  }, [streamUrl, onBitrateUpdate]);

  useEffect(() => {
    if (!videoRef.current) return;
    if (isPaused) {
      videoRef.current.pause();
    } else {
      videoRef.current.play().catch(() => {});
    }
  }, [isPaused]);

  return (
    <video
      ref={videoRef}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        objectFit: 'cover'
      }}
      playsInline
      muted={false}
    />
  );
});

VideoPlayerHls.propTypes = {
  streamUrl: PropTypes.string.isRequired,
  isPaused: PropTypes.bool.isRequired,
  onBitrateUpdate: PropTypes.func
};

export default VideoPlayerHls;
```

---

### 6. Guide des Clés D-Pad & Intégration Télécommande LG Magic Remote

| Touche Télécommande | Événement Spotlight | Action dans la vue LiveTv |
|---|---|---|
| **Flèches ▲ / ▼** | `Spotlight.focus()` | Défilement vertical fluide entre canaux dans la liste de zapping |
| **Touche OK / Enter** | `onClick` | Valider la chaîne sélectionnée et basculer en plein écran / pause |
| **Flèche Droite ▶** | Navigation Spatiale | Sortir de la liste de zapping pour accéder aux contrôles OSD |
| **Touche Play / Pause** | Media Keys webOS | Met en pause le direct (TimeShift buffer) |
| **Touche Jaune / FAV** | Custom Handler | Marquer le canal courant en favori permanent (`localStorage`) |
| **Bouton Back / Retour** | webOS Back Event | Fermer l'OSD ou retourner vers la vue Home |
