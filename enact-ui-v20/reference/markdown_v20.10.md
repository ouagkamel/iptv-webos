markdown

# 📺 IPTV WebOS 6+ - Documentation Complète

## Table des Matières
1. [Design Context](#design-context)
2. [Architecture Enact](#architecture-enact)
3. [Code Source Complet](#code-source-complet)
4. [HTML/CSS/JS](#htmlcssjs)
5. [Gestion Télécommande](#gestion-télécommande)
6. [Installation & Deployment](#installation--deployment)

---

## 🎨 Design Context

### Palette de Couleurs
| Élément | Code | Utilisation |
|---------|------|-------------|
| Fond principal | `#080e19` | Arrière-plan général |
| Fond secondaire | `#0d1625` | Panneaux et sections |
| Accent primaire | `#0865d7` | Boutons actifs |
| Accent secondaire | `#18adff` | Highlights et accents |
| Focus/Glow | `#159cff` | Outline focus |
| Texte principal | `#f5f7fb` | Texte standard |
| Texte secondaire | `#cbd5e1` | Texte labels |
| Texte muted | `#94a3b8` | Texte tertiaire |
| Favoris | `#ffc532` | Étoiles/favoris |
| Bordures | `#1d2b40`, `#26364b` | Séparateurs |

### Typographie

**Police Principale**: Manrope (Google Fonts)
- Weights: 400, 500, 600, 700, 800

**Hiérarchie typographique**:
Header Title: 40px Manrope 700 Section Titles: 32px Manrope 700 Subtitles: 21px Manrope 600 Body Text: 16-21px Manrope 400/500 Labels: 12-14px Manrope 400



### Spacing & Layout

**Dimensions clés**:
- Header height: 64px
- Footer height: 52px
- Main grid: 348px (sidebar) | 1fr (channels) | 620px (panel)
- Gap between sections: 16px
- Padding sections: 20-24px
- Border radius: 12px (sections), 8px (éléments), 24px (boutons)

### Animations & Transitions

**Focus Pulse Animation** (1.6s ease-in-out infinite)
```css
@keyframes focusPulse {
  0%, 100% {
    box-shadow: 0 0 0 3px #159cff, 0 0 18px #087fff55;
  }
  50% {
    box-shadow: 0 0 0 4px #159cff, 0 0 28px #087fff99;
  }
}
Channel Glow Animation (2.2s ease-in-out infinite)

css

@keyframes channelGlow {
  0%, 100% {
    box-shadow: 0 0 0 1px #078cff, 0 0 14px #078fff55;
  }
  50% {
    box-shadow: 0 0 0 2px #18adff, 0 0 30px #078fffaa;
  }
}
Panel Slide-Up Animation (500ms cubic-bezier)

css

@keyframes panelSlideUp {
  from {
    opacity: 0;
    transform: translateY(28px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
Fade-in Animation (450ms cubic-bezier)

css

@keyframes fade {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
Tous les Transitions: 300ms ease (transform, background, border, box-shadow)

🏗️ Architecture Enact
Structure des Dossiers

iptv-webos/
├── public/
│   └── index.html
├── src/
│   ├── index.js
│   ├── App.js
│   ├── App.module.less
│   ├── components/
│   │   ├── Header.js
│   │   ├── MainContent.js
│   │   ├── CategoryList.js
│   │   ├── ChannelList.js
│   │   ├── ProgramInfo.js
│   │   └── Footer.js
│   └── hooks/
│       └── useRemoteControl.js
├── package.json
└── enact.json
Dépendances
json

{
  "name": "iptv-webos",
  "version": "1.0.0",
  "enact": {
    "ri": true
  },
  "devDependencies": {
    "@enact/cli": "^4.5.0",
    "@enact/core": "^4.5.0",
    "@enact/ui": "^4.5.0",
    "@enact/moonstone": "^4.5.0",
    "react": "^18.2.0",
    "react-dom": "^18.2.0"
  },
  "dependencies": {
    "@enact/core": "^4.5.0",
    "@enact/ui": "^4.5.0",
    "@enact/moonstone": "^4.5.0"
  }
}
💻 Code Source Complet
1. src/index.js
javascript
import App from './App';
import {render} from 'react-dom';

render(<App />, document.getElementById('root'));
2. src/App.js (Composant Principal)
jsx

import React, { useState, useRef, useCallback } from 'react';
import './App.module.less';
import Header from './components/Header';
import MainContent from './components/MainContent';
import Footer from './components/Footer';

const App = () => {
  const [focusedSection, setFocusedSection] = useState('category');
  const [selectedCategory, setSelectedCategory] = useState(0);
  const [selectedChannel, setSelectedChannel] = useState(0);
  const [channels, setChannels] = useState([
    { id: 101, logo: 'TF1', name: 'TF1', favorited: true, color: 'gradient-tf1' },
    { id: 102, logo: 'F2', name: 'France 2', favorited: false, color: 'bg-white' },
    { id: 103, logo: 'F3', name: 'France 3', favorited: false, color: 'bg-white' },
    { id: 104, logo: 'M6', name: 'M6', favorited: false, color: 'bg-white' },
    { id: 105, logo: 'CANAL+', name: 'Canal+', favorited: false, color: 'bg-black' },
    { id: 106, logo: 'arte', name: 'ARTE', favorited: false, color: 'bg-orange-600' },
    { id: 107, logo: 'C 8', name: 'C8', favorited: false, color: 'bg-slate-100' },
    { id: 108, logo: 'BFM TV', name: 'BFM TV', favorited: false, color: 'bg-blue-700' }
  ]);

  const appRef = useRef(null);

  // Gestion des touches de la télécommande
  const handleRemoteKeyDown = useCallback((e) => {
    const key = e.keyCode;

    switch (key) {
      case 461: // BACK (retour)
        e.preventDefault();
        console.log('Retour à l\'écran précédent');
        break;

      case 37: // LEFT
      case 1009: // LEFT (WebOS)
        e.preventDefault();
        if (focusedSection === 'channel') {
          setFocusedSection('category');
        }
        break;

      case 39: // RIGHT
      case 1014: // RIGHT (WebOS)
        e.preventDefault();
        if (focusedSection === 'category') {
          setFocusedSection('channel');
        }
        break;

      case 38: // UP
      case 1010: // UP (WebOS)
        e.preventDefault();
        if (focusedSection === 'category') {
          setSelectedCategory(Math.max(0, selectedCategory - 1));
        } else if (focusedSection === 'channel') {
          setSelectedChannel(Math.max(0, selectedChannel - 1));
        }
        break;

      case 40: // DOWN
      case 1015: // DOWN (WebOS)
        e.preventDefault();
        if (focusedSection === 'category') {
          setSelectedCategory(Math.min(9, selectedCategory + 1));
        } else if (focusedSection === 'channel') {
          setSelectedChannel(Math.min(channels.length - 1, selectedChannel + 1));
        }
        break;

      case 13: // ENTER
      case 457: // OK (WebOS)
        e.preventDefault();
        if (focusedSection === 'channel') {
          const newChannels = [...channels];
          newChannels[selectedChannel].selected = true;
          setChannels(newChannels);
          console.log(`Chaîne sélectionnée: ${channels[selectedChannel].name}`);
        }
        break;

      case 191: // Star / Favoris (WebOS)
      case 42: // * / Star
        e.preventDefault();
        const newChannels = [...channels];
        newChannels[selectedChannel].favorited = !newChannels[selectedChannel].favorited;
        setChannels(newChannels);
        break;

      default:
        break;
    }
  }, [focusedSection, selectedCategory, selectedChannel, channels]);

  React.useEffect(() => {
    if (appRef.current) {
      appRef.current.focus();
    }
    window.addEventListener('keydown', handleRemoteKeyDown);
    return () => window.removeEventListener('keydown', handleRemoteKeyDown);
  }, [handleRemoteKeyDown]);

  const currentChannel = channels[selectedChannel];

  return (
    <div
      ref={appRef}
      className="app-container"
      tabIndex="0"
      style={{
        width: '100%',
        height: '100vh',
        backgroundColor: '#080e19',
        color: '#f5f7fb',
        fontFamily: 'Manrope, sans-serif',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column'
      }}
    >
      <Header />
      <MainContent
        focusedSection={focusedSection}
        selectedCategory={selectedCategory}
        selectedChannel={selectedChannel}
        channels={channels}
        currentChannel={currentChannel}
      />
      <Footer
        focusedSection={focusedSection}
        selectedChannel={selectedChannel}
        channels={channels}
      />
    </div>
  );
};

export default App;
3. src/components/Header.js
jsx

import React from 'react';

const Header = () => {
  return (
    <header
      style={{
        height: '64px',
        display: 'flex',
        alignItems: 'center',
        gap: '32px',
        marginBottom: '20px',
        paddingLeft: '20px',
        paddingRight: '20px',
        borderBottom: '1px solid #1d2b40'
      }}
    >
      {/* Logo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', width: '355px', flexShrink: 0 }}>
        <div
          style={{
            width: '52px',
            height: '58px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '58px',
            color: '#18a8ff'
          }}
        >
          ▶
        </div>
        <strong style={{ fontSize: '40px', letterSpacing: '-1px' }}>IPTV</strong>
        <span style={{ height: '36px', width: '1px', backgroundColor: '#475569', marginLeft: '12px' }}></span>
        <span style={{ fontSize: '14px', color: '#94a3b8', letterSpacing: '0.5px' }}>PLUS QUE DE LA TV</span>
      </div>

      {/* Navigation */}
      <nav style={{ display: 'flex', alignItems: 'center', gap: '28px', flex: 1, height: '100%' }}>
        {['Chaînes TV', 'Films', 'Séries', 'Profils', 'Paramètres'].map((item, idx) => (
          <button
            key={idx}
            style={{
              background: idx === 0 ? '#0865d7' : 'transparent',
              borderRadius: idx === 0 ? '16px' : '0',
              padding: idx === 0 ? '0 24px' : '0 12px',
              height: idx === 0 ? '60px' : 'auto',
              border: 'none',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              fontSize: '21px',
              fontWeight: idx === 0 ? '600' : '400',
              color: idx === 0 ? '#fff' : '#cbd5e1',
              cursor: 'pointer',
              transition: 'all 300ms ease',
              borderBottom: idx === 0 ? '4px solid #18adff' : 'none'
            }}
            onFocus={(e) => {
              e.target.style.background = idx === 0 ? '#0865d7' : 'rgba(8, 100, 215, 0.1)';
              e.target.style.boxShadow = '0 0 18px rgba(8, 127, 255, 0.33)';
            }}
            onBlur={(e) => {
              if (idx === 0) e.target.style.background = '#0865d7';
              else e.target.style.background = 'transparent';
              e.target.style.boxShadow = 'none';
            }}
          >
            {item}
          </button>
        ))}
      </nav>

      {/* Heure */}
      <div style={{ textAlign: 'right', width: '115px' }}>
        <div style={{ fontSize: '24px', fontWeight: 'bold' }}>20:42</div>
        <div style={{ fontSize: '14px', color: '#94a3b8' }}>Lundi 18 Mars</div>
      </div>
    </header>
  );
};

export default Header;
4. src/components/MainContent.js
jsx

import React from 'react';
import CategoryList from './CategoryList';
import ChannelList from './ChannelList';
import ProgramInfo from './ProgramInfo';

const MainContent = ({
  focusedSection,
  selectedCategory,
  selectedChannel,
  channels,
  currentChannel
}) => {
  return (
    <main
      style={{
        display: 'grid',
        gridTemplateColumns: '348px 1fr 620px',
        gap: '16px',
        height: '750px',
        padding: '0 20px',
        flex: 1
      }}
    >
      <CategoryList
        selected={selectedCategory}
        focused={focusedSection === 'category'}
      />
      <ChannelList
        channels={channels}
        selectedIndex={selectedChannel}
        focused={focusedSection === 'channel'}
      />
      <ProgramInfo currentChannel={currentChannel} />
    </main>
  );
};

export default MainContent;
5. src/components/CategoryList.js
jsx

import React from 'react';

const CategoryList = ({ selected, focused }) => {
  const categories = [
    { name: 'Toutes les chaînes', icon: '▦', count: '256' },
    { name: 'Favoris', icon: '★', count: '24' },
    { name: 'Sport', icon: '🏆', count: '42' },
    { name: 'Informations', icon: '📰', count: '18' },
    { name: 'Films', icon: '🎬', count: '36' },
    { name: 'Séries', icon: '▶', count: '32' },
    { name: 'Enfants', icon: '👶', count: '21' },
    { name: 'Documentaires', icon: '📄', count: '14' },
    { name: 'France', icon: '🇫🇷', count: '56' },
    { name: 'International', icon: '🌐', count: '98' }
  ];

  return (
    <aside
      style={{
        borderRadius: '12px',
        border: '1px solid #1d2b40',
        backgroundColor: '#0d1625',
        padding: '8px',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column'
      }}
    >
      <h2
        style={{
          padding: '12px 20px',
          fontSize: '14px',
          letterSpacing: '3px',
          color: '#cbd5e1',
          margin: 0
        }}
      >
        CATÉGORIES
      </h2>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {categories.map((cat, idx) => (
          <button
            key={idx}
            tabIndex={focused && idx === selected ? 0 : -1}
            style={{
              width: '100%',
              height: idx === 0 ? '69px' : '58px',
              borderRadius: '12px',
              backgroundColor: idx === selected ? '#0964d9' : 'transparent',
              border: 'none',
              padding: '0 20px',
              display: 'flex',
              alignItems: 'center',
              gap: '20px',
              fontSize: idx === 0 ? '20px' : '19px',
              fontWeight: idx === 0 ? '600' : '400',
              color: idx === selected ? '#fff' : '#cbd5e1',
              cursor: 'pointer',
              margin: '4px 0',
              transition: 'all 300ms ease',
              outline: 'none',
              boxShadow: idx === selected && focused ? '0 0 0 3px #159cff, 0 0 22px #087fff88' : 'none'
            }}
          >
            <span style={{ fontSize: '24px' }}>{cat.icon}</span>
            <span style={{ flex: 1, textAlign: 'left' }}>{cat.name}</span>
            <small style={{ fontSize: '14px', color: '#94a3b8' }}>{cat.count}</small>
          </button>
        ))}
      </div>
    </aside>
  );
};

export default CategoryList;
6. src/components/ChannelList.js
jsx

import React from 'react';

const ChannelList = ({ channels, selectedIndex, focused }) => {
  const getChannelLogo = (channel) => {
    const logos = {
      'TF1': 'TF1',
      'France 2': 'F2',
      'France 3': 'F3',
      'M6': 'M6',
      'Canal+': 'C+',
      'ARTE': 'ARTE',
      'C8': 'C8',
      'BFM TV': 'BFM'
    };
    return logos[channel.name] || channel.logo;
  };

  return (
    <section
      style={{
        borderRadius: '12px',
        border: '1px solid #1d2b40',
        backgroundColor: '#0d1625',
        padding: '8px',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column'
      }}
    >
      <h2
        style={{
          padding: '12px 20px',
          fontSize: '14px',
          letterSpacing: '3px',
          color: '#f0f4f8',
          margin: 0
        }}
      >
        CHAÎNES ({channels.length})
      </h2>

      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          paddingRight: '8px',
          display: 'flex',
          flexDirection: 'column',
          gap: '4px'
        }}
      >
        {channels.map((channel, idx) => (
          <div
            key={idx}
            tabIndex={focused && idx === selectedIndex ? 0 : -1}
            style={{
              height: '85px',
              borderRadius: '12px',
              border: '2px solid',
              borderColor: idx === selectedIndex ? '#078cff' : 'transparent',
              backgroundColor: idx === selectedIndex ? 'rgba(20, 45, 82, 0.8)' : '#111c2d',
              padding: '0 20px',
              display: 'flex',
              alignItems: 'center',
              gap: '24px',
              cursor: 'pointer',
              transition: 'all 300ms ease',
              outline: 'none',
              boxShadow: idx === selectedIndex && focused
                ? '0 0 0 1px #078cff, 0 0 24px #078fffaa'
                : 'none'
            }}
            onFocus={(e) => {
              if (focused) {
                e.currentTarget.style.boxShadow = '0 0 0 1px #078cff, 0 0 24px #078fffaa';
                e.currentTarget.style.transform = 'translateX(5px)';
              }
            }}
            onBlur={(e) => {
              if (idx === selectedIndex && focused) {
                e.currentTarget.style.boxShadow = '0 0 0 1px #078cff, 0 0 24px #078fffaa';
              }
              e.currentTarget.style.transform = 'translateX(0)';
            }}
          >
            <span style={{ width: '56px', fontSize: '22px', color: '#94a3b8' }}>
              {channel.id}
            </span>
            <div
              style={{
                width: '98px',
                height: '49px',
                borderRadius: '8px',
                background: channel.color,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '16px',
                fontWeight: 'bold',
                color: '#000',
                flexShrink: 0
              }}
            >
              {getChannelLogo(channel)}
            </div>
            <strong style={{ fontSize: '21px', flex: 1 }}>{channel.name}</strong>
            <span
              style={{
                fontSize: '24px',
                color: channel.favorited ? '#ffc532' : '#64748b',
                transition: 'all 300ms ease',
                transform: channel.favorited ? 'scale(1.08)' : 'scale(1)',
                filter: channel.favorited ? 'drop-shadow(0 0 7px #ffc53299)' : 'none'
              }}
            >
              ★
            </span>
          </div>
        ))}
      </div>
    </section>
  );
};

export default ChannelList;
7. src/components/ProgramInfo.js
jsx

import React, { useState } from 'react';

const ProgramInfo = ({ currentChannel }) => {
  const [hoverBanner, setHoverBanner] = useState(false);

  return (
    <aside style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Programme actuel */}
      <section
        style={{
          height: '393px',
          borderRadius: '12px',
          border: '1px solid #26364b',
          backgroundColor: '#0d1625',
          padding: '24px',
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', letterSpacing: '2px', color: '#cbd5e1', marginBottom: '12px' }}>
          <span>MAINTENANT SUR {currentChannel?.name.toUpperCase()}</span>
          <span style={{ backgroundColor: '#182438', borderRadius: '8px', padding: '8px 16px', letterSpacing: 'normal' }}>
            EPG
          </span>
        </div>

        <h1 style={{ fontSize: '32px', fontWeight: 'bold', margin: '12px 0 8px 0' }}>
          Journal de 20h
        </h1>

        <div style={{ display: 'flex', alignItems: 'center', gap: '20px', fontSize: '18px', color: '#cbd5e1', marginBottom: '16px' }}>
          <span>20:00 – 20:45</span>
          <div style={{ flex: 1, height: '8px', borderRadius: '4px', backgroundColor: '#475569', position: 'relative', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: '66%', backgroundColor: '#3b82f6', borderRadius: '4px' }}></div>
          </div>
          <span style={{ fontSize: '14px' }}>3 min restantes</span>
        </div>

        <p style={{ fontSize: '16px', lineHeight: '1.8', color: '#cbd5e1', margin: '16px 0' }}>
          Le journal télévisé présenté par Gilles Bouleau.<br />
          L'actualité nationale et internationale.
        </p>

        <hr style={{ border: 'none', borderTop: '1px solid #243247', margin: '16px 0' }} />

        <div style={{ fontSize: '14px', letterSpacing: '2px', color: '#cbd5e1', marginBottom: '12px' }}>
          PROCHAIN PROGRAMME
        </div>
        <h3 style={{ fontSize: '22px', margin: '12px 0 8px 0' }}>Météo</h3>
        <div style={{ fontSize: '18px', color: '#94a3b8' }}>20:45 – 21:00</div>
      </section>

      {/* Bannière publicitaire */}
      <section
        onMouseEnter={() => setHoverBanner(true)}
        onMouseLeave={() => setHoverBanner(false)}
        style={{
          height: '339px',
          borderRadius: '12px',
          border: '1px solid #31516f',
          overflow: 'hidden',
          position: 'relative',
          backgroundImage: 'url("https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=1000&q=80")',
          backgroundSize: 'cover',
          backgroundPosition: hoverBanner ? '58% center' : 'center',
          backgroundAttachment: 'fixed',
          transition: 'background-position 600ms cubic-bezier(0.4, 0, 0.2, 1)',
          cursor: 'pointer',
          transform: hoverBanner ? 'scale(1.012)' : 'scale(1)',
          boxShadow: hoverBanner ? '0 0 22px rgba(8, 127, 255, 0.33)' : 'none'
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(90deg, rgba(8, 13, 22, 0.87), rgba(8, 13, 22, 0.25))',
            padding: '24px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-end'
          }}
        >
          <div style={{ position: 'absolute', right: '32px', top: '28px', fontSize: '14px', letterSpacing: '2px', fontWeight: 'bold', textAlign: 'right' }}>
            🌞 VOYAGES<br />
            <span style={{ marginLeft: '32px' }}>INFINIS</span>
          </div>

          <h2 style={{ fontSize: '31px', fontWeight: 'bold', lineHeight: '1.4', maxWidth: '350px', margin: '0 0 12px 0' }}>
            Vos prochaines vacances commencent ici
          </h2>

          <p style={{ letterSpacing: '2px', margin: '12px 0' }}>
            DÉCOUVREZ NOS OFFRES<br />
            EXCLUSIVES
          </p>

          <button
            style={{
              marginTop: '16px',
              backgroundColor: '#ffc637',
              color: '#000',
              fontWeight: '600',
              border: 'none',
              borderRadius: '24px',
              width: '174px',
              height: '40px',
              cursor: 'pointer',
              transition: 'all 300ms ease',
              fontSize: '14px'
            }}
            onFocus={(e) => {
              e.target.style.boxShadow = '0 0 18px rgba(255, 198, 55, 0.53)';
              e.target.style.transform = 'translateX(5px) scale(1.03)';
            }}
            onBlur={(e) => {
              e.target.style.boxShadow = 'none';
              e.target.style.transform = 'translateX(0) scale(1)';
            }}
          >
            En savoir plus  →
          </button>
        </div>
      </section>
    </aside>
  );
};

export default ProgramInfo;
8. src/components/Footer.js
jsx

import React from 'react';

const Footer = ({ focusedSection, selectedChannel, channels }) => {
  return (
    <footer
      style={{
        height: '52px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 24px',
        color: '#cbd5e1',
        fontSize: '16px',
        borderTop: '1px solid #1d2b40',
        backgroundColor: '#080e19'
      }}
    >
      <div style={{ display: 'flex', gap: '28px', alignItems: 'center' }}>
        <span>
          <b style={{ backgroundColor: '#202b3d', borderRadius: '6px', padding: '8px 12px', marginRight: '8px' }}>
            OK
          </b>
          Ouvrir la chaîne
        </span>
        <span>
          <b style={{ backgroundColor: '#202b3d', borderRadius: '6px', padding: '8px 12px', marginRight: '8px' }}>
            ↑ ↓
          </b>
          Naviguer
        </span>
        <span>
          <b style={{ backgroundColor: '#202b3d', borderRadius: '6px', padding: '8px 12px', marginRight: '8px' }}>
            ← →
          </b>
          Changer de panneau
        </span>
        <span style={{ color: '#ffc532', fontSize: '20px', cursor: 'pointer' }}>
          ☆ <em style={{ fontSize: '14px', color: '#cbd5e1', fontStyle: 'normal' }}>Ajouter aux favoris</em>
        </span>
      </div>

      <span style={{ cursor: 'pointer' }}>↩  Retour</span>
    </footer>
  );
};

export default Footer;
9. public/index.html
html

<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>IPTV - WebOS 6+</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; background: #080e19; }
    #root { width: 100%; height: 100%; }
  </style>
</head>
<body>
  <div id="root"></div>
</body>
</html>
🎯 HTML/CSS/JS (Version Standalone)
Fichier HTML Complet
html

<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>IPTV — Chaînes TV</title>
<script src="https://cdn.tailwindcss.com"></script>
<script src="https://code.iconify.design/iconify-icon/1.0.7/iconify-icon.min.js"></script>
<style>
@import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap');

*{box-sizing:border-box}
html{background:#080e19}
body{margin:0;font-family:Manrope,Arial,sans-serif;color:#f5f7fb;overflow:hidden}

.focusable{outline:none;transition:box-shadow 300ms ease,transform 300ms ease,background-color 300ms ease,border-color 300ms ease}
.focusable:focus{box-shadow:0 0 0 3px #159cff,0 0 22px #087fff88;position:relative;z-index:4;animation:focusPulse 1.6s ease-in-out infinite}

#categories .focusable{position:relative;overflow:hidden;transition:transform 300ms ease,background-color 300ms ease,box-shadow 300ms ease}
#categories .focusable::before{content:'';position:absolute;left:0;top:0;bottom:0;width:4px;background:#18adff;transform:translateX(-8px);opacity:0;transition:transform 300ms ease,opacity 300ms ease}
#categories .focusable:hover,#categories .focusable:focus{transform:translateX(6px);box-shadow:0 0 18px #087fff44}
#categories .focusable:hover::before,#categories .focusable:focus::before{transform:translateX(0);opacity:1}

.scrollbar::-webkit-scrollbar{width:7px}
.scrollbar::-webkit-scrollbar-track{background:#101a2a}
.scrollbar::-webkit-scrollbar-thumb{background:#58677d;border-radius:8px}

.channel{transition:transform 300ms ease,background 300ms ease,border-color 300ms ease,box-shadow 300ms ease,opacity 300ms ease}
.channel:hover{transform:translateX(5px);border-color:#176fc3;box-shadow:0 0 16px #087fff33}
.channel.active{background:linear-gradient(100deg,#142d52,#102442);border-color:#078cff;box-shadow:0 0 0 1px #078cff,0 0 24px #078fff88;animation:channelGlow 2.2s ease-in-out infinite}
.channel.selected .star{color:#ffc532;transition:color 300ms ease,transform 300ms ease}
.channel.selected .star{transform:scale(1.08);filter:drop-shadow(0 0 7px #ffc53299)}

.fade{animation:fade 450ms cubic-bezier(.4,0,.2,1) both}

@keyframes fade{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
@keyframes focusPulse{0%,100%{box-shadow:0 0 0 3px #159cff,0 0 18px #087fff55}50%{box-shadow:0 0 0 4px #159cff,0 0 28px #087fff99}}
@keyframes channelGlow{0%,100%{box-shadow:0 0 0 1px #078cff,0 0 14px #078fff55}50%{box-shadow:0 0 0 2px #18adff,0 0 30px #078fffaa}}
@keyframes panelSlideUp{from{opacity:0;transform:translateY(28px)}to{opacity:1;transform:translateY(0)}}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:1ms!important;transition-duration:1ms!important}}
</style>
</head>
<body>
<div class="min-h-screen bg-[#080e19] px-5 py-6">
<header class="h-[64px] flex items-center gap-8 mb-5">
  <div class="flex items-center gap-3 w-[355px] shrink-0">
    <div class="w-[52px] h-[58px] flex items-center justify-center">
      <iconify-icon icon="lucide:play" class="text-[58px] text-[#18a8ff] fill-[#1676df]" style="transform:rotate(0deg)"></iconify-icon>
    </div>
    <strong class="text-[40px] tracking-tight">IPTV</strong>
    <span class="h-9 w-px bg-slate-700 ml-3"></span>
    <span class="text-sm text-slate-400 tracking-wide">PLUS QUE DE LA TV</span>
  </div>
  <nav id="main-nav" class="flex items-center gap-7 flex-1 h-full">
   <button data-focus="nav" class="focusable bg-[#0865d7] rounded-2xl px-6 h-[60px] flex items-center gap-3 text-[21px] font-semibold border-b-4 border-[#18adff]"><iconify-icon icon="lucide:tv" class="text-3xl"></iconify-icon>Chaînes TV</button>
   <button data-focus="nav" class="focusable px-3 flex items-center gap-3 text-[21px] text-slate-200"><iconify-icon icon="lucide:clapperboard" class="text-3xl"></iconify-icon>Films</button>
   <button data-focus="nav" class="focusable px-3 flex items-center gap-3 text-[21px] text-slate-200"><iconify-icon icon="lucide:monitor-play" class="text-3xl"></iconify-icon>Séries</button>
   <button data-focus="nav" class="focusable px-3 flex items-center gap-3 text-[21px] text-slate-200"><iconify-icon icon="lucide:user-round" class="text-3xl"></iconify-icon>Profils</button>
   <button data-focus="nav" class="focusable px-3 flex items-center gap-3 text-[21px] text-slate-200"><iconify-icon icon="lucide:settings" class="text-3xl"></iconify-icon>Paramètres</button>
  </nav>
  <div class="text-right w-[115px]"><div class="text-2xl font-semibold">20:42</div><div class="text-sm text-slate-400">Lundi 18 Mars</div></div>
</header>
<main class="grid grid-cols-[348px_1fr_620px] gap-4 h-[750px]">
 <aside class="rounded-xl border border-[#1d2b40] bg-[#0d1625] p-2 overflow-hidden"><h2 class="px-5 pt-3 pb-4 text-lg tracking-[3px] text-slate-300">CATÉGORIES</h2><div id="categories" class="space-y-1">
  <button data-focus="category" class="focusable w-full h-[69px] rounded-xl bg-[#0964d9] px-5 flex items-center gap-5 text-left text-[20px] font-semibold"><iconify-icon icon="lucide:layout-grid" class="text-3xl"></iconify-icon><span class="flex-1">Toutes les chaînes</span><small class="font-normal text-slate-300">256</small></button>
  <button data-focus="category" class="focusable w-full h-[58px] px-5 flex items-center gap-5 text-left text-[19px] text-slate-200"><iconify-icon icon="lucide:star" class="text-3xl"></iconify-icon><span class="flex-1">Favoris</span><small class="text-slate-400">24</small></button>
  <button data-focus="category" class="focusable w-full h-[58px] px-5 flex items-center gap-5 text-left text-[19px] text-slate-200"><iconify-icon icon="lucide:trophy" class="text-3xl"></iconify-icon><span class="flex-1">Sport</span><small class="text-slate-400">42</small></button>
  <button data-focus="category" class="focusable w-full h-[58px] px-5 flex items-center gap-5 text-left text-[19px] text-slate-200"><iconify-icon icon="lucide:newspaper" class="text-3xl"></iconify-icon><span class="flex-1">Informations</span><small class="text-slate-400">18</small></button>
  <button data-focus="category" class="focusable w-full h-[58px] px-5 flex items-center gap-5 text-left text-[19px] text-slate-200"><iconify-icon icon="lucide:clapperboard" class="text-3xl"></iconify-icon><span class="flex-1">Films</span><small class="text-slate-400">36</small></button>
  <button data-focus="category" class="focusable w-full h-[58px] px-5 flex items-center gap-5 text-left text-[19px] text-slate-200"><iconify-icon icon="lucide:circle-play" class="text-3xl"></iconify-icon><span class="flex-1">Séries</span><small class="text-slate-400">32</small></button>
  <button data-focus="category" class="focusable w-full h-[58px] px-5 flex items-center gap-5 text-left text-[19px] text-slate-200"><iconify-icon icon="lucide:heart-handshake" class="text-3xl"></iconify-icon><span class="flex-1">Enfants</span><small class="text-slate-400">21</small></button>
  <button data-focus="category" class="focusable w-full h-[58px] px-5 flex items-center gap-5 text-left text-[19px] text-slate-200"><iconify-icon icon="lucide:file-text" class="text-3xl"></iconify-icon><span class="flex-1">Documentaires</span><small class="text-slate-400">14</small></button>
  <button data-focus="category" class="focusable w-full h-[58px] px-5 flex items-center gap-5 text-left text-[19px] text-slate-200"><span class="text-2xl">🇫🇷</span><span class="flex-1">France</span><small class="text-slate-400">56</small></button>
  <button data-focus="category" class="focusable w-full h-[58px] px-5 flex items-center gap-5 text-left text-[19px] text-slate-200"><iconify-icon icon="lucide:globe-2" class="text-3xl"></iconify-icon><span class="flex-1">International</span><small class="text-slate-400">98</small></button>
 </div></aside>
 <section class="rounded-xl border border-[#1d2b40] bg-[#0d1625] p-2 overflow-hidden"><h2 class="px-5 pt-3 pb-3 text-lg tracking-[3px] text-slate-100">CHAÎNES (256)</h2><div id="channels" class="scrollbar h-[684px] overflow-y-auto pr-2 space-y-1">
  <div data-focus="channel" class="channel active selected focusable h-[85px] rounded-xl border-2 border-transparent px-5 flex items-center gap-6 cursor-pointer"><span class="w-14 text-2xl text-slate-400">101</span><b class="w-[98px] h-[49px] rounded-lg bg-gradient-to-r from-blue-700 via-white to-red-600 flex items-center justify-center text-2xl tracking-[6px]">TF1</b><strong class="text-[21px] flex-1">TF1</strong><iconify-icon icon="lucide:star" class="star text-3xl text-yellow-400 fill-yellow-400"></iconify-icon></div>
  <div data-focus="channel" class="channel focusable h-[85px] rounded-xl border-2 border-transparent bg-[#111c2d] px-5 flex items-center gap-6"><span class="w-14 text-2xl text-slate-400">102</span><b class="w-[98px] h-[49px] rounded-lg bg-white text-black flex items-center justify-center text-4xl"><i class="w-4 h-4 bg-red-500 rounded-full mr-1"></i>2</b><strong class="text-[21px] flex-1">France 2</strong><iconify-icon icon="lucide:star" class="star text-3xl text-slate-500"></iconify-icon></div>
  <div data-focus="channel" class="channel focusable h-[85px] rounded-xl border-2 border-transparent bg-[#111c2d] px-5 flex items-center gap-6"><span class="w-14 text-2xl text-slate-400">103</span><b class="w-[98px] h-[49px] rounded-lg bg-white text-black flex items-center justify-center text-4xl"><i class="w-4 h-4 bg-blue-500 rounded-full mr-1"></i>3</b><strong class="text-[21px] flex-1">France 3</strong><iconify-icon icon="lucide:star" class="star text-3xl text-slate-500"></iconify-icon></div>
  <div data-focus="channel" class="channel focusable h-[85px] rounded-xl border-2 border-transparent bg-[#111c2d] px-5 flex items-center gap-6"><span class="w-14 text-2xl text-slate-400">104</span><b class="w-[98px] h-[49px] rounded-lg bg-white text-red-600 flex items-center justify-center text-4xl italic">M6</b><strong class="text-[21px] flex-1">M6</strong><iconify-icon icon="lucide:star" class="star text-3xl text-slate-500"></iconify-icon></div>
  <div data-focus="channel" class="channel focusable h-[85px] rounded-xl border-2 border-transparent bg-[#111c2d] px-5 flex items-center gap-6"><span class="w-14 text-2xl text-slate-400">105</span><b class="w-[98px] h-[49px] rounded-lg bg-black flex items-center justify-center text-sm">CANAL+</b><strong class="text-[21px] flex-1">Canal+</strong><iconify-icon icon="lucide:star" class="star text-3xl text-slate-500"></iconify-icon></div>
  <div data-focus="channel" class="channel focusable h-[85px] rounded-xl border-2 border-transparent bg-[#111c2d] px-5 flex items-center gap-6"><span class="w-14 text-2xl text-slate-400">106</span><b class="w-[98px] h-[49px] rounded-lg bg-orange-600 flex items-center justify-center text-2xl">arte</b><strong class="text-[21px] flex-1">ARTE</strong><iconify-icon icon="lucide:star" class="star text-3xl text-slate-500"></iconify-icon></div>
  <div data-focus="channel" class="channel focusable h-[85px] rounded-xl border-2 border-transparent bg-[#111c2d] px-5 flex items-center gap-6"><span class="w-14 text-2xl text-slate-400">107</span><b class="w-[98px] h-[49px] rounded-lg bg-slate-100 text-black flex items-center justify-center text-3xl">C 8</b><strong class="text-[21px] flex-1">C8</strong><iconify-icon icon="lucide:star" class="star text-3xl text-slate-500"></iconify-icon></div>
  <div data-focus="channel" class="channel focusable h-[85px] rounded-xl border-2 border-transparent bg-[#111c2d] px-5 flex items-center gap-6"><span class="w-14 text-2xl text-slate-400">108</span><b class="w-[98px] h-[49px] rounded-lg bg-blue-700 flex items-center justify-center text-xl leading-4">BFM<br>TV</b><strong class="text-[21px] flex-1">BFM TV</strong><iconify-icon icon="lucide:star" class="star text-3xl text-slate-500"></iconify-icon></div>
 </div></section>
 <aside class="space-y-4"><section class="h-[393px] rounded-xl border border-[#26364b] bg-[#0d1625] p-6"><div class="flex justify-between text-base tracking-[2px] text-slate-300"><span>MAINTENANT SUR TF1</span><span class="bg-[#182438] rounded-xl px-4 py-2 tracking-normal">EPG</span></div><h1 class="text-[32px] font-bold mt-3">Journal de 20h</h1><div class="flex items-center gap-5 mt-2 text-xl text-slate-300"><span>20:00 – 20:45</span><div class="h-2 rounded bg-slate-700 flex-1"><div class="h-full w-2/3 bg-blue-500 rounded"></div></div><span class="text-base">3 min restantes</span></div><p class="text-lg leading-8 text-slate-300 mt-4">Le journal télévisé présenté par Gilles Bouleau.<br>L'actualité nationale et internationale.</p><hr class="border-[#243247] my-4"><div class="text-base tracking-[2px] text-slate-300">PROCHAIN PROGRAMME</div><h3 class="text-2xl mt-3">Météo</h3><div class="text-xl text-slate-400 mt-1">20:45 – 21:00</div></section><section class="h-[339px] rounded-xl border border-[#31516f] overflow-hidden relative bg-cover bg-center" style="background-image:linear-gradient(90deg,#080d16dd,#080d1640),url('https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=1000&q=80')"><div class="absolute inset-0 p-6 flex flex-col justify-end"><div class="absolute right-8 top-7 text-lg tracking-[2px] font-bold">🌞 VOYAGES<br><span class="ml-8">INFINIS</span></div><h2 class="text-[31px] font-bold leading-9 max-w-[350px]">Vos prochaines vacances commencent ici</h2><p class="tracking-[2px] mt-3">DÉCOUVREZ NOS OFFRES<br>EXCLUSIVES</p><button class="mt-4 bg-[#ffc637] text-black font-semibold rounded-full w-[174px] h-10">En savoir plus  →</button></div></section></aside>
</main>
<footer class="h-[52px] flex items-center justify-between px-6 text-slate-300 text-lg"><div class="flex gap-7 items-center"><span><b class="bg-[#202b3d] rounded-lg px-3 py-2 mr-2">OK</b> Ouvrir la chaîne</span><span><b class="bg-[#202b3d] rounded-lg px-3 py-2 mr-2">↑ ↓</b> Naviguer</span><span><b class="bg-[#202b3d] rounded-lg px-3 py-2 mr-2">← →</b> Changer de panneau</span><span class="text-yellow-400 text-2xl">☆ <em class="text-lg text-slate-300 not-italic">Ajouter aux favoris</em></span></div><span>↩  Retour</span></footer>
</div>

<script>
const focusables=[...document.querySelectorAll('.focusable')];let index=0;function setFocus(i){index=(i+focusables.length)%focusables.length;focusables[index].focus();focusables[index].scrollIntoView({block:'nearest',inline:'nearest'})}setFocus(0);document.addEventListener('keydown',e=>{let r=e.key==='ArrowRight',l=e.key==='ArrowLeft',u=e.key==='ArrowUp',d=e.key==='ArrowDown';if(u||d){e.preventDefault();setFocus(index+(d?1:-1))}if(r||l){e.preventDefault();setFocus(index+(r?1:-1))}if(e.key==='Enter'){const el=focusables[index];if(el.dataset.focus==='channel'){document.querySelectorAll('.channel').forEach(x=>x.classList.remove('active'));el.classList.add('active')}}if(e.key==='Backspace'||e.key==='Escape'){console.log('Retour WebOS')}});
</script>
</body>
</html>
🎮 Gestion Télécommande
Keycodes WebOS Supportés
Touche	KeyCode	Action
Arrow Left	37 / 1009	Panneau précédent
Arrow Right	39 / 1014	Panneau suivant
Arrow Up	38 / 1010	Navigation haut
Arrow Down	40 / 1015	Navigation bas
Enter / OK	13 / 457	Sélectionner
Back	461	Retour
Star / Favoris	191 / 42	Toggle favoris
Focus Management JavaScript
javascript

const focusables = [...document.querySelectorAll('.focusable')];
let index = 0;

function setFocus(i) {
  index = (i + focusables.length) % focusables.length;
  focusables[index].focus();
  focusables[index].scrollIntoView({ 
    block: 'nearest', 
    inline: 'nearest' 
  });
}

document.addEventListener('keydown', (e) => {
  let r = e.key === 'ArrowRight';
  let l = e.key === 'ArrowLeft';
  let u = e.key === 'ArrowUp';
  let d = e.key === 'ArrowDown';

  if (u || d) {
    e.preventDefault();
    setFocus(index + (d ? 1 : -1));
  }
  
  if (r || l) {
    e.preventDefault();
    setFocus(index + (r ? 1 : -1));
  }

  if (e.key === 'Enter') {
    const el = focusables[index];
    if (el.dataset.focus === 'channel') {
      document.querySelectorAll('.channel').forEach(x => x.classList.remove('active'));
      el.classList.add('active');
    }
  }

  if (e.key === 'Backspace' || e.key === 'Escape') {
    console.log('Retour WebOS');
  }
});

setFocus(0);
🚀 Installation & Deployment
Pour Enact
bash

# Installer les dépendances
npm install

# Développement
enact serve

# Build pour WebOS
enact pack -s

# Build pour TV WebOS 6+
enact pack --tv
Pour HTML Standalone
Copier le HTML dans un fichier index.html
Ouvrir dans un navigateur WebOS
Tester avec la télécommande
Recommandations WebOS
✅ Résolution cible: 1920x1080 (Full HD)
✅ Performance: Animations max 300ms
✅ Accessibility: Tous les éléments focusables
✅ Memory: Lazy loading des canaux (> 256)
✅ TV Remote: Support keycodes natifs WebOS
📦 Version: 1.0.0
🎯 Compatible: WebOS 6, 7, 8+
📝 Dernière mise à jour: 2024
👨‍💻 Framework: Enact + React 18



Voilà ! Vous avez maintenant un fichier markdown complet avec :
- ✅ Design context complet (couleurs, typo, spacing, animations)
- ✅ Code source Enact complet (9 fichiers)
- ✅ HTML/CSS/JS standalone
- ✅ Gestion télécommande
- ✅ Instructions installation & deployment

Vous pouvez copier ce markdown dans un fichi