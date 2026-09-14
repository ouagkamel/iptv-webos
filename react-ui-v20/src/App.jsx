import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createProfile,
  iptvDb,
  matchPrograms,
  readProfileData,
  readProfiles
} from './iptvDb';
import { importProfileAndEpg } from './importer';

const fallbackArt = (from, to, label) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 600"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="900" height="600" fill="url(#g)"/><circle cx="760" cy="110" r="130" fill="white" fill-opacity=".12"/><path d="M0 500c180-120 300-70 430-150s280-100 470 25v225H0z" fill="white" fill-opacity=".1"/><text x="52" y="500" fill="white" fill-opacity=".86" font-family="Arial,sans-serif" font-size="64" font-weight="700">${label}</text></svg>`)}`;
const FALLBACK_ART = {
  movie: fallbackArt('#312e81', '#7c3aed', 'FILM'),
  series: fallbackArt('#0f766e', '#2563eb', 'SÉRIE'),
  live: fallbackArt('#be123c', '#7c2d12', 'LIVE')
};

const tabLabels = {
  tv: ['Télévision en Direct', 'Chaînes, programmes et EPG'],
  movies: ['Bibliothèque de Films', 'Les nouveautés de votre catalogue'],
  series: ['Séries TV', 'Saisons et derniers épisodes'],
  favorites: ['Mes Favoris', 'Vos contenus enregistrés'],
  guide: ['Guide TV', 'Programmes en cours et à suivre']
};

const Icon = memo(function Icon({ name, className = 'h-6 w-6' }) {
  const common = { className, fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true };
  const paths = {
    plus: <><path d="M12 4.5v15M19.5 12h-15" /></>,
    trash: <><path d="M4 7h16M9 11v6m6-6v6M7 7l1 13h8l1-13M9 7V4h6v3" /></>,
    user: <><circle cx="12" cy="7" r="3.5" /><path d="M4.5 21a7.5 7.5 0 0 1 15 0" /></>,
    link: <><path d="M10 13.5l4-4M7.5 15.5l-2 2a3.5 3.5 0 0 1-5-5l3-3a3.5 3.5 0 0 1 5 0M16.5 8.5l2-2a3.5 3.5 0 0 1 5 5l-3 3a3.5 3.5 0 0 1-5 0" /></>,
    tv: <><rect x="3" y="5" width="18" height="13" rx="2" /><path d="M8 21h8M12 18v3" /></>,
    film: <><rect x="4" y="4" width="16" height="16" rx="1" /><path d="M4 9h16M4 15h16M8 4v5M16 4v5M8 15v5M16 15v5" /></>,
    clapper: <><path d="M3 7h18v14H3zM3 7l3-4h4L7 7l4-4h4l-3 4 4-4h4l-3 4" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-1.8 1.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5v.2h-2.5v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1-1.8-1.8.1-.1A1.7 1.7 0 0 0 8.1 15a1.7 1.7 0 0 0-1.5-1H6.4v-2.5h.2a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1 1.8-1.8.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.5v-.2H15v.2a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1 1.8 1.8-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.5 1h.2V14h-.2a1.7 1.7 0 0 0-1.5 1z" /></>,
    play: <path fill="currentColor" stroke="none" d="M8 5v14l11-7z" />,
    x: <><path d="M6 6l12 12M18 6L6 18" /></>,
    home: <><path d="M3 10.5L12 3l9 7.5v9H3z" /><path d="M9 21v-6h6v6" /></>,
    star: <path fill="currentColor" stroke="none" d="M12 2.5l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5-5.8-3.1-5.8 3.1 1.1-6.5-4.7-4.6 6.5-.9z" />,
    logout: <><path d="M15 5V3.5A1.5 1.5 0 0 0 13.5 2h-8A1.5 1.5 0 0 0 4 3.5v17A1.5 1.5 0 0 0 5.5 22h8a1.5 1.5 0 0 0 1.5-1.5V19" /><path d="M11 12h10M17 8l4 4-4 4" /></>,
    search: <><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></>,
    calendar: <><rect x="4" y="5" width="16" height="15" rx="1" /><path d="M8 3v4M16 3v4M4 10h16M8 14h.01M12 14h.01M16 14h.01M8 17h.01M12 17h.01" /></>,
    refresh: <><path d="M20 11a8 8 0 0 0-14.7-4L3 10M3 5v5h5M4 13a8 8 0 0 0 14.7 4L21 14M21 19v-5h-5" /></>
  };
  return <svg {...common}>{paths[name] || paths.tv}</svg>;
});

const MediaArt = memo(function MediaArt({ src, kind = 'movie', label }) {
  const fallback = FALLBACK_ART[kind] || FALLBACK_ART.movie;
  const [image, setImage] = useState(src || fallback);
  useEffect(() => { setImage(src || fallback); }, [src, fallback]);
  const onError = useCallback(() => { if (image !== fallback) setImage(fallback); }, [fallback, image]);
  return (
    <div className="relative h-full w-full overflow-hidden bg-slate-200">
      <img src={image} alt="" width="900" height="600" className="h-full w-full object-cover" onError={onError} draggable="false" />
      <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-transparent" />
      {label && <span className="absolute bottom-3 left-3 rounded-full bg-slate-950/70 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wider text-white">{label}</span>}
    </div>
  );
});

function formatTime(value) {
  const date = new Date(Number(value));
  return Number.isNaN(date.getTime()) ? '--:--' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : String(date.getFullYear());
}

function sourceLabel(profile) {
  return profile && profile.source === 'xtream' ? 'Xtream Codes' : 'Lien M3U';
}

function useTvNavigation() {
  const lastMove = useRef(0);
  const onKeyDown = useCallback((event) => {
    const directions = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    const direction = directions[event.key];
    if (!direction || event.target && /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)) return;
    const now = Date.now();
    if (now - lastMove.current < 90) { event.preventDefault(); return; }
    lastMove.current = now;
    event.preventDefault();
    const current = document.activeElement;
    const candidates = Array.from(document.querySelectorAll('.tv-focusable, .tv-focusable-mild, .tv-input')).filter((element) => {
      if (element === current || element.disabled) return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
    if (!candidates.length) return;
    if (!current || !current.getBoundingClientRect || !current.matches('.tv-focusable, .tv-focusable-mild, .tv-input')) {
      candidates[0].focus();
      return;
    }
    const origin = current.getBoundingClientRect();
    const ox = origin.left + origin.width / 2;
    const oy = origin.top + origin.height / 2;
    const vertical = direction[0] !== 0;
    let best = null;
    let bestScore = Number.POSITIVE_INFINITY;
    candidates.forEach((element) => {
      const rect = element.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const dx = x - ox;
      const dy = y - oy;
      const primary = vertical ? direction[0] * dy : direction[1] * dx;
      const secondary = vertical ? Math.abs(dx) : Math.abs(dy);
      if (primary <= 4) return;
      const score = primary + secondary * 0.65;
      if (score < bestScore) { bestScore = score; best = element; }
    });
    if (best) best.focus();
  }, []);
  useEffect(() => {
    document.addEventListener('keydown', onKeyDown, { passive: false });
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onKeyDown]);
}

const EmptyState = memo(function EmptyState({ icon = 'tv', title, text }) {
  return (
    <div className="glass-card flex min-h-[180px] w-full flex-col items-center justify-center rounded-3xl p-8 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-100 text-indigo-600"><Icon name={icon} className="h-8 w-8" /></div>
      <h3 className="text-xl font-extrabold text-slate-800">{title}</h3>
      {text && <p className="mt-2 max-w-md text-sm text-slate-500">{text}</p>}
    </div>
  );
});

const OVERSCAN_ROWS = 3;
const GRID_COLUMNS = 4;

function useVirtualRange(itemCount, itemSize, overscan) {
  const [range, setRange] = useState({ start: 0, end: Math.min(itemCount, overscan * 2 + 8) });
  const update = useCallback((scrollOffset, viewportSize) => {
    const first = Math.max(0, Math.floor(scrollOffset / itemSize) - overscan);
    const visible = Math.ceil(viewportSize / itemSize) + overscan * 2;
    const next = { start: first, end: Math.min(itemCount, first + visible) };
    setRange((old) => old.start === next.start && old.end === next.end ? old : next);
  }, [itemCount, itemSize, overscan]);
  useEffect(() => { setRange({ start: 0, end: Math.min(itemCount, overscan * 2 + 8) }); }, [itemCount, itemSize, overscan]);
  return [range, update];
}

function useRafScroll(update, horizontal = false) {
  const frame = useRef(0);
  const onScroll = useCallback((event) => {
    const element = event.currentTarget;
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      update(horizontal ? element.scrollLeft : element.scrollTop, horizontal ? element.clientWidth : element.clientHeight);
    });
  }, [horizontal, update]);
  useEffect(() => () => { if (frame.current) cancelAnimationFrame(frame.current); }, []);
  return onScroll;
}

const VirtualList = memo(function VirtualList({ items, itemSize, className, empty, renderItem, getKey }) {
  const viewport = useRef(null);
  const [range, update] = useVirtualRange(items.length, itemSize, OVERSCAN_ROWS);
  const onScroll = useRafScroll(update);
  if (!items.length) return empty || null;
  return <div ref={viewport} className={className} onScroll={onScroll}><div className="relative" style={{ height: `${items.length * itemSize}px` }}>{items.slice(range.start, range.end).map((item, offset) => <div key={getKey(item, range.start + offset)} className="absolute left-0 right-0" style={{ top: `${(range.start + offset) * itemSize}px`, height: `${itemSize}px` }}>{renderItem(item, range.start + offset)}</div>)}</div></div>;
});

const VirtualGrid = memo(function VirtualGrid({ items, rowSize, className, renderItem, getKey, empty }) {
  const [range, update] = useVirtualRange(Math.ceil(items.length / GRID_COLUMNS), rowSize, 2);
  const onScroll = useRafScroll(update);
  const rowCount = Math.ceil(items.length / GRID_COLUMNS);
  if (!items.length) return empty || null;
  return <div className={className} onScroll={onScroll}><div className="relative" style={{ height: `${rowCount * rowSize}px` }}>{Array.from({ length: range.end - range.start }, (_, rowOffset) => { const row = range.start + rowOffset; const cells = items.slice(row * GRID_COLUMNS, row * GRID_COLUMNS + GRID_COLUMNS); return <div key={row} className="absolute left-0 right-0 grid grid-cols-4 gap-6" style={{ top: `${row * rowSize}px`, height: `${rowSize}px` }}>{cells.map((item, cellIndex) => <div key={getKey(item, row * GRID_COLUMNS + cellIndex)} className="min-w-0">{renderItem(item, row * GRID_COLUMNS + cellIndex)}</div>)}</div>; })}</div></div>;
});

const VirtualPillList = memo(function VirtualPillList({ items, selected, onSelect }) {
  const itemSize = 150;
  const [range, update] = useVirtualRange(items.length, itemSize, 2);
  const onScroll = useRafScroll(update, true);
  return <div className="no-scrollbar h-12 overflow-x-auto pb-1" onScroll={onScroll}><div className="relative h-10 shrink-0" style={{ width: `${items.length * itemSize}px` }}>{items.slice(range.start, range.end).map((item, offset) => <button key={item} onClick={() => onSelect(item)} className={`tv-focusable-mild absolute top-0 h-10 w-[138px] truncate rounded-2xl px-4 text-sm font-bold ${selected === item ? 'bg-slate-800 text-white shadow-md' : 'glass-pill text-slate-600'}`} style={{ left: `${(range.start + offset) * itemSize}px` }}>{item}</button>)}</div></div>;
});

const ChannelRow = memo(function ChannelRow({ channel, selected, program, onSelect }) {
  return <button onClick={() => onSelect(channel)} className={`tv-focusable glass-card flex w-full items-center justify-between rounded-2xl p-4 text-left ${selected ? 'border-2 border-indigo-600 bg-white shadow-lg' : ''}`}><div className="flex min-w-0 items-center gap-4"><div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-slate-900 text-xs font-extrabold text-white">{channel.logo ? <img src={channel.logo} alt="" className="h-full w-full object-cover" /> : String(channel.name || 'TV').slice(0, 3)}</div><div className="min-w-0"><span className="text-xs font-bold uppercase tracking-wider text-indigo-600">{channel.groupName || 'Direct TV'}</span><h4 className="truncate text-lg font-bold text-slate-800">{channel.name}</h4><p className="truncate text-xs font-medium text-slate-500">{program ? program.title : 'Programme EPG non disponible'}</p></div></div><span className="ml-3 flex shrink-0 items-center gap-1.5 rounded-full bg-red-100 px-2.5 py-1 text-xs font-extrabold text-red-600"><span className="h-2 w-2 rounded-full bg-red-600" />DIRECT</span></button>;
});

const MovieCard = memo(function MovieCard({ movie, onPlay }) {
  return <button onClick={() => onPlay(movie)} className="tv-focusable glass-card group overflow-hidden rounded-3xl text-left"><div className="relative h-72 w-full overflow-hidden"><MediaArt src={movie.logo} kind="movie" /><span className="absolute right-3 top-3 rounded-full bg-slate-900/80 px-3 py-1 text-xs font-bold text-amber-400">★ {movie.rating || '—'}</span></div><div className="p-5"><span className="text-xs font-bold text-indigo-600">{formatDate(movie.releaseDate)}{movie.groupName ? ` · ${movie.groupName}` : ''}</span><h4 className="mt-1 truncate text-xl font-bold text-slate-800">{movie.name}</h4><p className="mt-1 line-clamp-2 text-xs text-slate-500">{movie.plot || 'Film disponible dans votre catalogue VOD.'}</p></div></button>;
});

const SeriesCard = memo(function SeriesCard({ item, onOpenSeries }) {
  return <button onClick={() => onOpenSeries(item)} className="tv-focusable glass-card overflow-hidden rounded-3xl text-left"><div className="h-56"><MediaArt src={item.logo} kind="series" label="SÉRIE" /></div><div className="p-4"><h4 className="truncate font-bold text-slate-800">{item.name}</h4><p className="mt-1 truncate text-xs text-slate-500">{item.groupName || 'Catalogue séries'}</p></div></button>;
});

const EpisodeCard = memo(function EpisodeCard({ entry, onOpenSeries }) {
  return <button onClick={() => onOpenSeries(entry.series)} className="tv-focusable glass-card overflow-hidden rounded-3xl text-left"><div className="relative h-48"><MediaArt src={entry.series.logo} kind="series" label={`S${entry.season.number}E${entry.episode.episodeId}`} /></div><div className="p-4"><h4 className="truncate font-bold text-slate-800">{entry.series.name}</h4><p className="mt-1 truncate text-xs text-indigo-600">{entry.episode.title}</p></div></button>;
});

const FavoriteCard = memo(function FavoriteCard({ item, index, onPlay }) {
  return <button onClick={() => onPlay(item)} className="tv-focusable glass-card overflow-hidden rounded-3xl text-left"><div className="h-56"><MediaArt src={item.logo} kind={item.kind === 'live' ? 'live' : item.kind === 'series' ? 'series' : 'movie'} label="FAVORI" /></div><div className="p-4"><h4 className="truncate font-bold text-slate-800">{item.name}</h4><p className="mt-1 truncate text-xs text-indigo-600">{item.groupName || item.kind || index}</p></div></button>;
});

const MatchCard = memo(function MatchCard({ channel, program, onPlay }) {
  return <button onClick={() => onPlay(channel)} className="tv-focusable mb-3 w-full rounded-2xl border border-slate-200 bg-white/70 p-4 text-left"><span className="text-xs font-extrabold uppercase tracking-wider text-red-500">EN DIRECT · {formatTime(program.startTime)}</span><strong className="mt-1 block truncate text-slate-800">{program.title}</strong><small className="mt-1 block truncate text-slate-500">{channel.name}</small></button>;
});

const ProfileScreen = memo(function ProfileScreen({ profiles, onSelectProfile, onCreate, onDelete }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('xtream');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState(null);
  const [form, setForm] = useState({ name: '', base: '', username: '', password: '', url: '', epgUrl: '' });
  const update = (key, value) => setForm((old) => ({ ...old, [key]: value }));
  const submit = async () => {
    setSaving(true); setError(''); setProgress({ phase: 'profile', message: 'Création du profil…', percent: 0, current: 0, total: 0 });
    try { await onCreate({ ...form, source: tab }, setProgress); setForm({ name: '', base: '', username: '', password: '', url: '', epgUrl: '' }); setOpen(false); }
    catch (err) { setError(String(err.message || err)); }
    finally { setSaving(false); }
  };
  return (
    <div className="glass-bg-animated relative flex h-screen w-screen flex-col items-center justify-center overflow-hidden p-8">
      <div className="absolute left-12 top-10 flex items-center gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-tr from-indigo-600 to-purple-500 text-2xl font-extrabold text-white shadow-lg shadow-indigo-500/20">V</div>
        <div><h1 className="text-3xl font-extrabold tracking-tight text-slate-800">VisionTV</h1><p className="text-xs font-semibold uppercase tracking-widest text-indigo-600">React Glass UI · WebOS IPTV</p></div>
      </div>
      {profiles.length === 0 ? (
        <div className="flex max-w-lg flex-col items-center text-center">
          <div className="glass-card mb-8 flex h-32 w-32 items-center justify-center rounded-3xl text-indigo-600 shadow-2xl"><Icon name="tv" className="h-16 w-16" /></div>
          <h2 className="mb-4 text-4xl font-extrabold tracking-tight text-slate-800">Bienvenue sur VisionTV</h2>
          <p className="mb-10 text-lg leading-relaxed text-slate-600">Aucun profil IPTV réel n'est configuré. Ajoutez un compte Xtream ou une playlist M3U pour commencer.</p>
          <button className="tv-focusable flex items-center gap-4 rounded-2xl bg-indigo-600 px-10 py-5 text-xl font-bold text-white shadow-xl shadow-indigo-600/30" onClick={() => setOpen(true)}><Icon name="plus" className="h-7 w-7" />Ajouter un profil</button>
        </div>
      ) : (
        <div className="flex w-full max-w-5xl flex-col items-center">
          <h2 className="mb-3 text-4xl font-extrabold tracking-tight text-slate-800">Sélectionnez votre profil</h2>
          <p className="mb-12 text-lg text-slate-500">Choisissez un accès réel pour retrouver vos chaînes, films et séries.</p>
          <div className="flex w-full flex-wrap justify-center gap-8">
            {profiles.map((profile) => (
              <div key={profile.id} className="relative">
                <button className="tv-focusable glass-card flex h-64 w-64 flex-col items-center justify-center rounded-3xl border-2 border-white/80 p-6 text-center" onClick={() => onSelectProfile(profile)}>
                  <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-2xl bg-indigo-100 text-indigo-600 shadow-inner"><Icon name={profile.source === 'xtream' ? 'user' : 'link'} className="h-10 w-10" /></div>
                  <h3 className="mb-1 w-full truncate text-2xl font-bold text-slate-800">{profile.name}</h3>
                  <span className="rounded-full border border-indigo-100 bg-indigo-50 px-3 py-1 text-xs font-bold uppercase tracking-wider text-indigo-500">{sourceLabel(profile)}</span>
                  <small className="mt-2 text-xs font-semibold text-slate-500">{profile.activeImportId ? 'Catalogue synchronisé' : 'À configurer ou importer'}</small>
                </button>
                <button className="tv-focusable absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-xl border border-red-200 bg-red-500/10 text-red-600" onClick={(event) => { event.stopPropagation(); onDelete(profile); }} aria-label={`Supprimer ${profile.name}`}><Icon name="trash" className="h-5 w-5" /></button>
              </div>
            ))}
          </div>
          <button className="tv-focusable fixed bottom-12 right-12 flex items-center gap-3 rounded-2xl bg-indigo-600 px-8 py-4 text-lg font-bold text-white shadow-xl shadow-indigo-600/30" onClick={() => setOpen(true)}><Icon name="plus" className="h-6 w-6" />Nouveau profil</button>
        </div>
      )}
      {open && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/35 p-6">
        <div className="glass-card w-full max-w-2xl rounded-3xl border border-white p-8 shadow-2xl">
          <div className="mb-8 flex items-center justify-between"><h3 className="text-3xl font-extrabold text-slate-800">Ajouter un profil IPTV</h3><button className="tv-focusable rounded-xl p-3 text-slate-500 hover:bg-slate-200/60" onClick={() => setOpen(false)} disabled={saving}><Icon name="x" /></button></div>
          <div className="mb-8 flex gap-2 rounded-2xl bg-slate-200/60 p-1.5">
            <button className={`tv-focusable flex-1 rounded-xl py-3.5 font-bold ${tab === 'xtream' ? 'bg-white text-indigo-600 shadow-md' : 'text-slate-600'}`} onClick={() => setTab('xtream')}>Compte Xtream</button>
            <button className={`tv-focusable flex-1 rounded-xl py-3.5 font-bold ${tab === 'm3u' ? 'bg-white text-indigo-600 shadow-md' : 'text-slate-600'}`} onClick={() => setTab('m3u')}>Lien M3U</button>
          </div>
          <div className="flex flex-col gap-4">
            <input className="tv-input" placeholder="Nom du profil" value={form.name} onChange={(e) => update('name', e.target.value)} />
            {tab === 'xtream' ? <>
              <input className="tv-input" placeholder="Lien du serveur (http://...)" value={form.base} onChange={(e) => update('base', e.target.value)} />
              <div className="flex gap-4"><input className="tv-input w-1/2" placeholder="Nom d'utilisateur" value={form.username} onChange={(e) => update('username', e.target.value)} /><input className="tv-input w-1/2" type="password" placeholder="Mot de passe" value={form.password} onChange={(e) => update('password', e.target.value)} /></div>
            </> : <><input className="tv-input" placeholder="URL complète de la playlist M3U" value={form.url} onChange={(e) => update('url', e.target.value)} /><input className="tv-input" placeholder="URL XMLTV optionnelle" value={form.epgUrl} onChange={(e) => update('epgUrl', e.target.value)} /></>}
          </div>
          {saving && progress && <div className="mt-6 rounded-2xl bg-indigo-50/80 p-4"><div className="mb-2 flex items-center justify-between text-xs font-extrabold uppercase tracking-wider text-indigo-600"><span>{progress.message}</span><span>{progress.percent || 0}%</span></div><div className="h-3 overflow-hidden rounded-full bg-indigo-100"><div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-purple-500" style={{ width: `${Math.max(3, progress.percent || 0)}%` }} /></div></div>}
          {error && <p className="mt-4 text-sm font-semibold text-red-600">{error}</p>}
          <button className="tv-focusable mt-8 flex w-full items-center justify-center gap-2 rounded-2xl bg-indigo-600 py-5 text-xl font-bold text-white shadow-lg shadow-indigo-600/30 disabled:opacity-50" onClick={submit} disabled={saving}><Icon name={saving ? 'refresh' : 'play'} className="h-6 w-6" />{saving ? (progress && progress.message ? progress.message : 'Import en cours…') : 'Créer le profil + importer'}</button>
        </div>
      </div>}
    </div>
  );
});

const Sidebar = memo(function Sidebar({ tab, setTab, onSwitchProfile }) {
  const items = [
    ['tv', 'En Direct', 'tv'], ['movies', 'Films', 'film'], ['series', 'Séries', 'clapper'], ['favorites', 'Favoris', 'star'], ['guide', 'Guide TV', 'calendar']
  ];
  return <aside className="glass-card flex h-full w-24 shrink-0 flex-col items-center justify-between border-r border-white/60 py-8">
    <div className="flex flex-col items-center gap-8"><div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-tr from-indigo-600 to-purple-500 text-xl font-extrabold text-white shadow-md">V</div><nav className="flex flex-col gap-4">{items.map(([id, label, icon]) => <button key={id} title={label} onClick={() => setTab(id)} className={`tv-focusable rounded-2xl p-4 ${tab === id ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30' : 'text-slate-500 hover:bg-white/70'}`}><Icon name={icon} className="h-7 w-7" /></button>)}</nav></div>
    <div className="flex flex-col gap-4"><button className="tv-focusable rounded-2xl bg-white/50 p-4 text-slate-600" title="Changer de profil" onClick={onSwitchProfile}><Icon name="logout" className="h-6 w-6" /></button></div>
  </aside>;
});

const LiveView = memo(function LiveView({ data, current, setCurrent, onPlay }) {
  const [category, setCategory] = useState('Tous');
  const categories = useMemo(() => ['Tous'].concat(Array.from(new Set(data.channels.map((channel) => channel.groupName || 'Autres')))), [data.channels]);
  const channels = useMemo(() => category === 'Tous' ? data.channels : data.channels.filter((channel) => (channel.groupName || 'Autres') === category), [category, data.channels]);
  const programsByChannel = useMemo(() => {
    const output = Object.create(null);
    data.epg.forEach((row) => {
      const key = String(row.channelId || '');
      if (!output[key]) output[key] = [];
      output[key].push(row);
    });
    return output;
  }, [data.epg]);
  const currentFor = useCallback((channel) => {
    if (!channel || !channel.channelId) return null;
    const now = Date.now();
    const rows = programsByChannel[String(channel.channelId)] || [];
    return rows.filter((row) => Number(row.startTime) <= now && Number(row.stopTime) >= now).sort((a, b) => Number(a.startTime) - Number(b.startTime))[0] || null;
  }, [programsByChannel]);
  const program = currentFor(current);
  const matches = useMemo(() => matchPrograms(data.channels, data.epg), [data.channels, data.epg]);
  const selectCategory = useCallback((value) => setCategory(value), []);
  const selectChannel = useCallback((channel) => setCurrent(channel), [setCurrent]);
  const renderChannel = useCallback((channel) => <ChannelRow channel={channel} selected={!!current && current.id === channel.id} program={currentFor(channel)} onSelect={selectChannel} />, [current, currentFor, selectChannel]);
  const channelKey = useCallback((channel) => channel.id, []);
  return <div className="flex min-h-0 flex-1 gap-6 overflow-hidden">
    <div className="flex h-full w-1/2 min-w-0 flex-col gap-4"><VirtualPillList items={categories} selected={category} onSelect={selectCategory} /><VirtualList items={channels} itemSize={100} className="no-scrollbar flex-1 overflow-y-auto pr-1" renderItem={renderChannel} getKey={channelKey} empty={<EmptyState icon="tv" title="Aucune chaîne importée" text="Sélectionnez un profil disposant d'un catalogue synchronisé." />} /></div>
    <div className="flex h-full w-1/2 min-w-0 flex-col gap-6"><div className="glass-card-dark relative flex h-2/3 min-h-[280px] flex-col justify-between overflow-hidden rounded-3xl p-6 text-white"><div className="absolute inset-0 bg-gradient-to-tr from-indigo-950 via-slate-900 to-purple-950 opacity-95" />{current && <div className="absolute inset-0 opacity-25"><MediaArt src={current.logo} kind="live" /></div>}<div className="relative z-10 flex items-start justify-between"><span className="rounded-full border border-indigo-400/30 bg-indigo-600/80 px-3 py-1 text-xs font-bold uppercase tracking-wider">LIVE TV</span><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 font-bold">{current ? String(current.name || 'TV').slice(0, 2) : 'TV'}</span></div><button onClick={() => current && onPlay(current)} className="tv-focusable relative z-10 mx-auto flex h-20 w-20 items-center justify-center rounded-full border border-white/40 bg-white/20 text-white shadow-2xl"><Icon name="play" className="ml-1 h-10 w-10" /></button><div className="relative z-10"><h3 className="truncate text-2xl font-extrabold">{current ? current.name : 'Aucune chaîne sélectionnée'}</h3><p className="truncate text-sm font-medium text-indigo-200">{program ? program.title : 'Sélectionnez une chaîne pour afficher son programme'}</p></div></div><div className="glass-card flex flex-1 flex-col justify-between rounded-3xl p-6"><div><div className="mb-3 flex items-center justify-between"><span className="text-xs font-extrabold uppercase tracking-wider text-indigo-600">Guide TV en cours</span><span className="text-xs font-bold text-slate-500">{program ? `${formatTime(program.startTime)} – ${formatTime(program.stopTime)}` : 'EPG indisponible'}</span></div><h4 className="mb-2 text-xl font-bold text-slate-800">{program ? program.title : current ? current.name : 'Aucun programme'}</h4><p className="line-clamp-2 text-sm text-slate-600">{matches.length ? `${matches.length} programme(s) sportif(s) actuellement détecté(s) dans votre EPG.` : 'Les informations EPG de la chaîne sélectionnée apparaîtront ici après synchronisation.'}</p></div>{program && <div className="mt-4"><div className="mb-1.5 flex justify-between text-xs font-bold text-slate-500"><span>Avancement</span><span>{Math.max(0, Math.min(100, Math.round(((Date.now() - program.startTime) / (program.stopTime - program.startTime)) * 100)))}%</span></div><div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-indigo-600" style={{ width: `${Math.max(0, Math.min(100, ((Date.now() - program.startTime) / (program.stopTime - program.startTime)) * 100))}%` }} /></div></div>}</div></div>
  </div>;
});

const MoviesView = memo(function MoviesView({ movies, onPlay }) {
  const renderMovie = useCallback((movie) => <MovieCard movie={movie} onPlay={onPlay} />, [onPlay]);
  const key = useCallback((movie) => movie.id, []);
  return movies.length ? <VirtualGrid items={movies} rowSize={430} className="no-scrollbar flex-1 overflow-y-auto pr-1" renderItem={renderMovie} getKey={key} /> : <EmptyState icon="film" title="Aucun film importé" text="Les films réels de votre playlist apparaîtront après synchronisation." />;
});

const SeriesView = memo(function SeriesView({ series, episodes, onOpenSeries }) {
  const renderEpisode = useCallback((entry) => <EpisodeCard entry={entry} onOpenSeries={onOpenSeries} />, [onOpenSeries]);
  const renderSeries = useCallback((item) => <SeriesCard item={item} onOpenSeries={onOpenSeries} />, [onOpenSeries]);
  const key = useCallback((item) => item.id || `${item.series.id}-${item.episode.id}`, []);
  return <div className="no-scrollbar flex-1 overflow-y-auto pr-1"><div className="mb-6"><h3 className="text-xl font-extrabold text-slate-800">Derniers épisodes</h3><p className="mt-1 text-sm text-slate-500">Données récupérées depuis le catalogue réel et le détail lazy des séries.</p></div>{episodes.length ? <VirtualGrid items={episodes} rowSize={330} className="no-scrollbar mb-8 max-h-[430px] overflow-y-auto" renderItem={renderEpisode} getKey={key} /> : <div className="mb-8"><EmptyState icon="clapper" title="Aucun épisode disponible" text="Les épisodes sont chargés depuis le fournisseur Xtream lorsqu'un détail est disponible." /></div>}<h3 className="mb-4 text-xl font-extrabold text-slate-800">Toutes les séries</h3>{series.length ? <VirtualGrid items={series} rowSize={390} className="no-scrollbar overflow-y-auto" renderItem={renderSeries} getKey={key} /> : <EmptyState icon="clapper" title="Aucune série importée" />}</div>;
});

const FavoritesView = memo(function FavoritesView({ favorites, onPlay }) {
  const renderFavorite = useCallback((item, index) => <FavoriteCard item={item} index={index} onPlay={onPlay} />, [onPlay]);
  const key = useCallback((item, index) => `${item.kind}-${item.sourceKey || index}`, []);
  return favorites.length ? <VirtualGrid items={favorites} rowSize={390} className="no-scrollbar flex-1 overflow-y-auto pr-1" renderItem={renderFavorite} getKey={key} /> : <EmptyState icon="star" title="Aucun favori" text="Ajoutez des chaînes, films ou séries depuis les vues de contenu." />;
});

const GuideView = memo(function GuideView({ data, onPlay }) {
  const current = data.channels[0];
  const matches = useMemo(() => matchPrograms(data.channels, data.epg), [data.channels, data.epg]);
  const renderMatch = useCallback((entry) => <MatchCard channel={entry.channel} program={entry.program} onPlay={onPlay} />, [onPlay]);
  const key = useCallback((entry) => `${entry.channel.id}-${entry.program.id}`, []);
  return <div className="flex min-h-0 flex-1 gap-6 overflow-hidden"><VirtualList items={matches} itemSize={86} className="glass-card no-scrollbar w-1/3 overflow-y-auto rounded-3xl p-5" renderItem={renderMatch} getKey={key} empty={<div className="glass-card flex min-h-[180px] w-1/3 flex-col items-center justify-center rounded-3xl p-5 text-center"><p className="text-sm text-slate-500">Aucun match ou programme sportif en cours dans l’EPG.</p></div>} /><div className="glass-card flex min-w-0 flex-1 flex-col rounded-3xl p-6"><span className="text-xs font-extrabold uppercase tracking-wider text-indigo-600">Guide EPG réel</span><h2 className="mt-2 text-3xl font-extrabold text-slate-800">{current ? current.name : 'Aucune chaîne'}</h2><p className="mt-2 text-slate-500">Les données affichées proviennent uniquement de l'import XMLTV actif.</p><button className="tv-focusable mt-6 flex w-fit items-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 font-bold text-white" onClick={() => current && onPlay(current)}><Icon name="play" className="h-5 w-5" />Regarder</button></div></div>;
});

function SettingsView({ profile, onRefresh }) {
  return <div className="no-scrollbar flex-1 overflow-y-auto"><div className="glass-card max-w-4xl rounded-3xl p-7"><span className="text-xs font-extrabold uppercase tracking-wider text-indigo-600">Source active</span><h2 className="mt-2 text-3xl font-extrabold text-slate-800">{profile ? profile.name : 'Aucun profil'}</h2><p className="mt-2 text-slate-500">{profile ? `${sourceLabel(profile)} · ${profile.activeImportId ? 'catalogue synchronisé' : 'aucun import actif'}` : 'Sélectionnez un profil pour commencer.'}</p><div className="mt-7 grid grid-cols-2 gap-4"><div className="rounded-2xl bg-white/70 p-5"><small className="text-xs font-bold uppercase tracking-wider text-slate-400">EPG</small><strong className="mt-2 block text-slate-800">{profile && profile.activeEpgImportId ? 'Synchronisé' : 'Non disponible'}</strong></div><div className="rounded-2xl bg-white/70 p-5"><small className="text-xs font-bold uppercase tracking-wider text-slate-400">Lecteur</small><strong className="mt-2 block text-slate-800">HTML5 natif</strong></div></div><button className="tv-focusable mt-7 flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 font-bold text-white" onClick={onRefresh}><Icon name="refresh" className="h-5 w-5" />Relire les données</button></div></div>;
}

function PlayerOverlay({ item, profile, onClose }) {
  const [error, setError] = useState(false);
  const source = item && item.streamUrl;
  return <div className="fixed inset-0 z-[80] bg-slate-950"><button className="tv-focusable absolute left-7 top-7 z-10 flex items-center gap-2 rounded-xl bg-white/10 px-4 py-3 font-bold text-white" onClick={onClose}><Icon name="x" className="h-5 w-5" />Fermer</button><div className="flex h-full w-full items-center justify-center p-10"><div className="w-full max-w-6xl overflow-hidden rounded-3xl border border-white/10 bg-slate-900 shadow-2xl"><div className="aspect-video bg-black">{source ? <video className="h-full w-full" src={source} controls autoPlay onError={() => setError(true)} /> : <div className="flex h-full flex-col items-center justify-center text-center text-white"><Icon name={item && item.kind === 'series' ? 'clapper' : 'tv'} className="mb-4 h-16 w-16 text-indigo-300" /><p className="text-xl font-bold">Flux de lecture indisponible</p><p className="mt-2 text-sm text-slate-400">Cette entrée n'a pas de flux natif dans le catalogue chargé.</p></div>}</div><div className="flex items-center justify-between p-5 text-white"><div><h2 className="text-xl font-extrabold">{item && (item.name || item.title)}</h2><p className="mt-1 text-sm text-slate-400">{profile ? profile.name : ''}</p></div><span className="rounded-full bg-indigo-500/20 px-3 py-1 text-xs font-bold text-indigo-200">{error ? 'ERREUR FLUX' : 'LECTEUR NATIF'}</span></div></div></div></div>;
}

const MainAppScreen = memo(function MainAppScreen({ profile, data, onSwitchProfile, onRefresh }) {
  const [tab, setTab] = useState('tv');
  const [current, setCurrent] = useState(data.channels[0] || null);
  const [player, setPlayer] = useState(null);
  useEffect(() => { if (!current || !data.channels.some((item) => item.id === current.id)) setCurrent(data.channels[0] || null); }, [data.channels, current]);
  const [title, subtitle] = tabLabels[tab] || tabLabels.tv;
  const openSeries = useCallback(() => setTab('series'), []);
  const play = useCallback((item) => setPlayer(item), []);
  return <div className="glass-bg-animated flex h-screen w-screen overflow-hidden text-slate-800"><Sidebar tab={tab} setTab={setTab} onSwitchProfile={onSwitchProfile} /><main className="flex h-full min-w-0 flex-1 flex-col gap-6 overflow-hidden p-8"><header className="flex w-full items-center justify-between"><div><h2 className="text-3xl font-extrabold tracking-tight text-slate-800">{title}</h2><p className="mt-1 text-sm font-medium text-slate-500">{subtitle} · <span className="font-bold text-indigo-600">{profile ? profile.name : 'Profil'}</span></p></div><div className="flex items-center gap-4"><div className="glass-pill rounded-full px-5 py-2.5 text-sm font-bold text-slate-700">{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · WEBOS</div><div className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-600 text-sm font-bold text-white shadow-md">{profile && profile.name ? profile.name.charAt(0).toUpperCase() : 'U'}</div></div></header>{tab === 'tv' && <LiveView data={data} current={current} setCurrent={setCurrent} onPlay={play} />}{tab === 'movies' && <MoviesView movies={data.movies} onPlay={play} />}{tab === 'series' && <SeriesView series={data.series} episodes={data.episodes} onOpenSeries={openSeries} />}{tab === 'favorites' && <FavoritesView favorites={data.favorites} onPlay={play} />}{tab === 'guide' && <GuideView data={data} onPlay={play} />}{tab === 'settings' && <SettingsView profile={profile} onRefresh={onRefresh} />}</main>{player && <PlayerOverlay item={player} profile={profile} onClose={() => setPlayer(null)} />}</div>;
});

async function removeProfile(profile) {
  const imports = await iptvDb.imports.where('playlistId').equals(profile.id).primaryKeys();
  const tables = [iptvDb.playlists, iptvDb.imports, iptvDb.channels, iptvDb.epg, iptvDb.vod, iptvDb.series, iptvDb.series_info, iptvDb.categories];
  if (iptvDb.favorites) tables.push(iptvDb.favorites);
  await iptvDb.transaction('rw', tables, async () => {
    if (imports.length) {
      await Promise.all([
        iptvDb.channels.where('importId').anyOf(imports).delete(), iptvDb.epg.where('importId').anyOf(imports).delete(), iptvDb.vod.where('importId').anyOf(imports).delete(), iptvDb.series.where('importId').anyOf(imports).delete(), iptvDb.series_info.where('importId').anyOf(imports).delete(), iptvDb.categories.where('importId').anyOf(imports).delete(), iptvDb.imports.bulkDelete(imports)
      ]);
    }
    if (iptvDb.favorites) await iptvDb.favorites.where('playlistId').equals(profile.id).delete();
    await iptvDb.playlists.delete(profile.id);
  });
}

export default function App() {
  useTvNavigation();
  const [profiles, setProfiles] = useState([]);
  const [activeProfile, setActiveProfile] = useState(null);
  const [data, setData] = useState({ channels: [], movies: [], series: [], favorites: [], epg: [], episodes: [] });
  const [screen, setScreen] = useState('profiles');
  const [loading, setLoading] = useState(true);
  const loadProfiles = useCallback(async () => { setLoading(true); try { const rows = await readProfiles(); setProfiles(rows); } finally { setLoading(false); } }, []);
  useEffect(() => { loadProfiles(); }, [loadProfiles]);
  useEffect(() => { if (!activeProfile) return undefined; let cancelled = false; setLoading(true); readProfileData(activeProfile).then((next) => { if (!cancelled) setData(next); }).finally(() => { if (!cancelled) setLoading(false); }); return () => { cancelled = true; }; }, [activeProfile]);
  const selectProfile = useCallback((profile) => { setActiveProfile(profile); setScreen('main'); }, []);
  const create = useCallback(async (form, onProgress) => {
    const profileId = await createProfile(form);
    try {
      await importProfileAndEpg(profileId, onProgress);
    } finally {
      await loadProfiles();
    }
  }, [loadProfiles]);
  const remove = useCallback(async (profile) => { await removeProfile(profile); if (activeProfile && activeProfile.id === profile.id) { setActiveProfile(null); setScreen('profiles'); } await loadProfiles(); }, [activeProfile, loadProfiles]);
  const refresh = useCallback(async () => { if (activeProfile) setData(await readProfileData(activeProfile)); }, [activeProfile]);
  const switchProfile = useCallback(() => { setScreen('profiles'); setActiveProfile(null); }, []);
  if (loading && !profiles.length && !activeProfile) return <div className="glass-bg-animated flex h-screen items-center justify-center text-xl font-bold text-indigo-600">Chargement des profils réels…</div>;
  return screen === 'profiles' ? <ProfileScreen profiles={profiles} onSelectProfile={selectProfile} onCreate={create} onDelete={remove} /> : <MainAppScreen profile={activeProfile} data={data} onSwitchProfile={switchProfile} onRefresh={refresh} />;
}
