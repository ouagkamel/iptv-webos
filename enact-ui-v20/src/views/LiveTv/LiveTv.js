import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import BodyText from '@enact/sandstone/BodyText';
import Button from '@enact/sandstone/Button';
import Heading from '@enact/sandstone/Heading';
import Icon from '@enact/sandstone/Icon';
import VirtualList from '@enact/sandstone/VirtualList';
import Spotlight from '@enact/spotlight';
import Spottable from '@enact/spotlight/Spottable';
import SpotlightContainerDecorator from '@enact/spotlight/SpotlightContainerDecorator';
import {EmptyState} from '../../components/MediaCards';
import css from './LiveTv.module.less';

const HeaderContainer = SpotlightContainerDecorator({enterTo: 'last-focused'}, 'nav');
const CategoryContainer = SpotlightContainerDecorator({enterTo: 'default-element'}, 'div');
const ChannelListContainer = SpotlightContainerDecorator({enterTo: 'last-focused'}, 'div');
const ChannelItem = Spottable('div');

const NAV_ITEMS = [
	{id: 'live', label: 'Chaînes TV', icon: 'tvguidefvp'},
	{id: 'vod', label: 'Films', icon: 'movies'},
	{id: 'series', label: 'Séries', icon: 'folder'},
	{id: 'profiles', label: 'Profils', icon: 'profile'},
	{id: 'settings', label: 'Paramètres', icon: 'gear'}
];

function groupName(channel) {
	return String(channel && channel.groupName || 'Autres').trim() || 'Autres';
}

function channelNumber(channel, index) {
	const value = channel && (channel.num || channel.number);
	return value ? String(value) : String(index + 1).padStart(2, '0');
}

function channelTitle(channel) {
	return String(channel && (channel.name || channel.title) || 'Chaîne sans nom');
}

function programTitle(program) {
	return String(program && (program.title || program.name) || 'Programme sans titre');
}

function programDescription(program) {
	return String(program && (program.description || program.plot || program.desc) || '').trim();
}

function epgIndex(rows) {
	const index = Object.create(null);
	(rows || []).forEach((program) => {
		const key = String(program.channelId || '');
		if (!key) return;
		if (!index[key]) index[key] = [];
		index[key].push(program);
	});
	Object.keys(index).forEach((key) => index[key].sort((a, b) => Number(a.startTime) - Number(b.startTime)));
	return index;
}

function programsFor(channel, index) {
	return channel && channel.channelId ? index[String(channel.channelId)] || [] : [];
}

function currentProgram(channel, index, now) {
	return programsFor(channel, index).filter((program) => Number(program.startTime) <= now && Number(program.stopTime) >= now)[0] || null;
}

function upcomingPrograms(channel, index, now) {
	return programsFor(channel, index).filter((program) => Number(program.startTime) > now).slice(0, 3);
}

function formatTime(value) {
	const date = new Date(Number(value));
	return Number.isNaN(date.getTime()) ? '--:--' : date.toLocaleTimeString('fr-FR', {hour: '2-digit', minute: '2-digit'});
}

function formatDate(date) {
	return date.toLocaleDateString('fr-FR', {weekday: 'long', day: 'numeric', month: 'long'});
}

function progress(program, now) {
	if (!program) return 0;
	const start = Number(program.startTime);
	const stop = Number(program.stopTime);
	if (!Number.isFinite(start) || !Number.isFinite(stop) || stop <= start) return 0;
	return Math.max(0, Math.min(100, Math.round((now - start) * 100 / (stop - start))));
}

function remaining(program, now) {
	if (!program) return '';
	const stop = Number(program.stopTime);
	if (!Number.isFinite(stop)) return '';
	const minutes = Math.max(0, Math.round((stop - now) / 60000));
	return minutes < 60 ? `${minutes} min restantes` : `${Math.floor(minutes / 60)} h ${minutes % 60} min restantes`;
}

function metadata(channel) {
	return [channel && channel.quality, channel && channel.resolution, channel && channel.streamType, channel && channel.codec]
		.filter(Boolean).map(String);
}

function favoriteKey(item) {
	return String(item && (item.channelId || item.contentId || item.itemId || item.id) || '');
}

function initials(value) {
	const words = String(value || '?').trim().split(/\s+/).filter(Boolean);
	return words.slice(0, 2).map((word) => word.charAt(0)).join('').toUpperCase() || '?';
}

const ChannelLogo = React.memo(function ChannelLogo({channel}) {
	const [failed, setFailed] = useState(false);
	const fail = useCallback(() => setFailed(true), []);
	const logo = channel && channel.logo;
	if (logo && !failed) return <img className={css.channelLogoImage} src={logo} alt="" onError={fail} />;
	return <span className={css.channelLogoFallback}>{initials(channelTitle(channel))}</span>;
});

const ChannelRow = React.memo(function ChannelRow({channel, index, selected, favorite, program, onSelect, onPlay}) {
	const select = useCallback(() => {
		onSelect(channel);
		if (channel && channel.streamUrl) onPlay({...channel, kind: 'live'});
	}, [channel, onPlay, onSelect]);
	const number = channelNumber(channel, index);
	const name = channelTitle(channel);
	const details = metadata(channel);
	const now = Date.now();
	return <ChannelItem className={`${css.channelRow} ${selected ? css.channelRowSelected : ''}`} onClick={select} aria-label={`${number} ${name}`}>
		<span className={css.channelNumber}>{number}</span>
		<div className={css.channelLogo}><ChannelLogo channel={channel} /></div>
		<div className={css.channelNameBlock}>
			<strong>{name}</strong>
			<span>{program ? programTitle(program) : 'Programme EPG indisponible'}</span>
		</div>
		{details[0] && <span className={css.channelQuality}>{details[0]}</span>}
		<span className={`${css.favoriteMark} ${favorite || channel.favorite || channel.favorited ? css.favoriteMarkActive : ''}`} aria-hidden="true">★</span>
		<div className={css.channelProgressLine}>
			<span>{program ? formatTime(program.startTime) : '--:--'}</span>
			<div className={css.progressTrack}><span className={css.progressValue} style={{width: `${progress(program, now)}%`}} /></div>
			<span>{program ? formatTime(program.stopTime) : '--:--'}</span>
		</div>
	</ChannelItem>;
});

export const LiveHeader = React.memo(function LiveHeader({active, clock, profile, onNavigate, onSwitchProfile}) {
	const navigate = useCallback((event) => {
		const id = event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.nav;
		if (id === 'profiles') {
			if (onSwitchProfile) onSwitchProfile();
			return;
		}
		if (id) onNavigate(id);
	}, [onNavigate, onSwitchProfile]);
	const goHome = useCallback(() => onNavigate('home'), [onNavigate]);
	return <header className={css.liveHeader}>
		<Button className={css.brandButton} backgroundOpacity="transparent" onClick={goHome} aria-label="Accueil">
			<span className={css.brandMark} aria-hidden="true"><svg viewBox="0 0 54 60" focusable="false"><path d="M8 5c-3 0-5 3-5 7v36c0 5 5 8 9 5l35-22c4-3 4-9 0-12L12 6c-1-1-3-1-4-1Z" fill="#159cff" /><path d="M8 5c-2 1-3 4-3 7v11l23 14 19-12c4-3 4-9 0-12L12 6c-1-1-3-1-4-1Z" fill="#0865d7" opacity=".9" /></svg></span>
			<span className={css.brandCopy}><strong>IPTV</strong><span>PLUS QUE DE LA TV</span></span>
		</Button>
		<HeaderContainer className={css.topNavigation} spotlightId="live-top-navigation">
			{NAV_ITEMS.map((item) => <Button
				key={item.id}
				data-nav={item.id}
				className={`${css.topNavItem} ${active === item.id ? css.topNavItemActive : ''}`}
				backgroundOpacity="transparent"
				size="small"
				icon={item.icon}
				onClick={navigate}
			>{item.label}</Button>)}
		</HeaderContainer>
		<div className={css.clockBlock}><strong>{clock.toLocaleTimeString('fr-FR', {hour: '2-digit', minute: '2-digit'})}</strong><span>{formatDate(clock)}</span></div>
		<span className={css.sourceIndicator}>{profile && profile.source ? profile.source.toUpperCase() : 'V20'}</span>
	</header>;
});

const LiveTv = React.memo(function LiveTv({data, profile, onPlay, onNavigate, onSwitchProfile}) {
	const channels = useMemo(() => data.channels || [], [data.channels]);
	const favorites = useMemo(() => data.favorites || [], [data.favorites]);
	const [selectedId, setSelectedId] = useState(channels[0] ? channels[0].id : null);
	const [selectedGroup, setSelectedGroup] = useState('all');
	const [now, setNow] = useState(() => new Date());
	const programs = useMemo(() => epgIndex(data.epg), [data.epg]);
	const favoriteIds = useMemo(() => new Set(favorites.map(favoriteKey).filter(Boolean)), [favorites]);
	const favoriteChannels = useMemo(() => channels.filter((channel) => favoriteIds.has(String(channel.id)) || favoriteIds.has(String(channel.channelId))), [channels, favoriteIds]);
	const categories = useMemo(() => {
		const counts = Object.create(null);
		const order = [];
		channels.forEach((channel) => {
			const label = groupName(channel);
			if (!counts[label]) order.push(label);
			counts[label] = (counts[label] || 0) + 1;
		});
		return [{id: 'all', label: 'Toutes les chaînes', count: channels.length}, {id: 'favorites', label: 'Favoris', count: favoriteChannels.length}]
			.concat(order.map((label) => ({id: label, label, count: counts[label]})));
		}, [channels, favoriteChannels]);
	const filteredChannels = useMemo(() => {
		if (selectedGroup === 'favorites') return favoriteChannels;
		if (selectedGroup === 'all') return channels;
		return channels.filter((channel) => groupName(channel) === selectedGroup);
	}, [channels, favoriteChannels, selectedGroup]);
	const selected = channels.find((channel) => channel.id === selectedId) || filteredChannels[0] || channels[0] || null;
	const selectedProgram = selected ? currentProgram(selected, programs, now.getTime()) : null;
	const upcoming = selected ? upcomingPrograms(selected, programs, now.getTime()) : [];
	const selectChannel = useCallback((channel) => setSelectedId(channel.id), []);
	const zapTimer = useRef(null);
	const playChannel = useCallback((channel) => {
		if (!channel || !channel.streamUrl) return;
		if (zapTimer.current) clearTimeout(zapTimer.current);
		zapTimer.current = setTimeout(() => {
			zapTimer.current = null;
			onPlay({...channel, kind: 'live'});
		}, 250);
	}, [onPlay]);
	const playSelected = useCallback(() => {
		playChannel(selected);
	}, [playChannel, selected]);
	useEffect(() => () => {
		if (zapTimer.current) clearTimeout(zapTimer.current);
	}, []);
	const openGuide = useCallback(() => onNavigate('guide'), [onNavigate]);
	const openFavorites = useCallback(() => onNavigate('favorites'), [onNavigate]);
	const openSettings = useCallback(() => onNavigate('settings'), [onNavigate]);
	const goHome = useCallback(() => onNavigate('home'), [onNavigate]);
	const selectGroup = useCallback((event) => setSelectedGroup(event.currentTarget.dataset.group || 'all'), []);
	const renderChannel = useCallback(({index}) => {
		const channel = filteredChannels[index];
		if (!channel) return null;
		return <ChannelRow channel={channel} index={channels.indexOf(channel)} selected={selected && selected.id === channel.id} favorite={favoriteIds.has(String(channel.id)) || favoriteIds.has(String(channel.channelId))} program={currentProgram(channel, programs, now.getTime())} onSelect={selectChannel} onPlay={playChannel} />;
		}, [channels, favoriteIds, filteredChannels, now, playChannel, programs, selectChannel, selected]);
	useEffect(() => {
		const timer = setInterval(() => setNow(new Date()), 30000);
		return () => clearInterval(timer);
	}, []);
	useEffect(() => {
		if (!selected && filteredChannels.length) setSelectedId(filteredChannels[0].id);
		if (selected && selectedGroup !== 'all' && !filteredChannels.some((channel) => channel.id === selected.id) && filteredChannels[0]) setSelectedId(filteredChannels[0].id);
	}, [filteredChannels, selected, selectedGroup]);
	useEffect(() => {
		if (channels.length) Spotlight.focus('live-channel-list');
	}, [channels.length]);

	const header = <LiveHeader active="live" clock={now} profile={profile} onNavigate={onNavigate} onSwitchProfile={onSwitchProfile} />;
	if (!channels.length) return <div className={css.liveScreen}>{header}<div className={css.emptyLayout}><EmptyState icon="channel" title="Aucune chaîne Live importée" text="Cette vue utilise uniquement les chaînes réelles du catalogue actif." action="Ouvrir les réglages" onAction={openSettings} /></div><footer className={css.liveFooter}><span>OK Sélectionner</span><Button backgroundOpacity="transparent" size="small" onClick={goHome}>Retour</Button></footer></div>;

	return <div className={css.liveScreen}>
		{header}
		<div className={css.liveGrid}>
			<aside className={css.categoryPanel}>
				<div className={css.panelHeading}><span>CATÉGORIES</span><span className={css.panelCount}>{channels.length}</span></div>
				<CategoryContainer className={css.categoryList} spotlightId="live-categories">
					{categories.map((category) => <Button key={category.id} data-group={category.id} className={`${css.categoryButton} ${selectedGroup === category.id ? css.categoryButtonActive : ''}`} backgroundOpacity="transparent" size="small" onClick={selectGroup}>
						<span className={css.categoryIcon}><Icon size="small">{category.id === 'all' ? 'list' : category.id === 'favorites' ? 'bookmark' : 'folder'}</Icon></span><span className={css.categoryLabel}>{category.label}</span><small>{category.count}</small>
					</Button>)}
				</CategoryContainer>
			</aside>

			<section className={css.channelPanel}>
				<div className={css.panelHeading}><span>CHAÎNES ({filteredChannels.length})</span><span className={css.panelCount}>{selectedGroup === 'all' ? 'CATALOGUE' : selectedGroup}</span></div>
				<ChannelListContainer className={css.channelList} spotlightId="live-channel-list">
					{filteredChannels.length ? <VirtualList className={css.channelVirtualList} dataSize={filteredChannels.length} itemRenderer={renderChannel} itemSize={88} verticalScrollbar="hidden" horizontalScrollbar="hidden" spotlightId="live-channel-virtual-list" wrap="noAnimation" /> : <div className={css.filteredEmpty}><Icon size="medium">bookmark</Icon><strong>Aucune chaîne dans ce filtre</strong><span>Le catalogue réel ne contient pas encore de chaîne correspondante.</span></div>}
				</ChannelListContainer>
			</section>

			<main className={css.detailColumn}>
				<section className={css.programCard}>
					<div className={css.programCardHeader}><span>MAINTENANT SUR {selected ? channelTitle(selected).toUpperCase() : '—'}</span><Button backgroundOpacity="transparent" size="small" onClick={openGuide}>EPG</Button></div>
					<Heading spacing="none">{selectedProgram ? programTitle(selectedProgram) : 'Programme EPG indisponible'}</Heading>
					<div className={css.programTiming}><span>{selectedProgram ? formatTime(selectedProgram.startTime) : '--:--'} — {selectedProgram ? formatTime(selectedProgram.stopTime) : '--:--'}</span><div className={css.programProgress}><span style={{width: `${progress(selectedProgram, now.getTime())}%`}} /></div><small>{selectedProgram ? remaining(selectedProgram, now.getTime()) : 'Aucune donnée'}</small></div>
					{programDescription(selectedProgram) ? <BodyText size="small" className={css.programDescription}>{programDescription(selectedProgram)}</BodyText> : <BodyText size="small" className={css.programDescription}>Les informations détaillées seront affichées lorsque l’EPG réel les fournira.</BodyText>}
					<div className={css.nextHeading}>PROCHAIN PROGRAMME</div>
					<strong className={css.nextTitle}>{upcoming[0] ? programTitle(upcoming[0]) : 'Aucun programme suivant'}</strong>
					<span className={css.nextTime}>{upcoming[0] ? `${formatTime(upcoming[0].startTime)} — ${formatTime(upcoming[0].stopTime)}` : 'EPG réel indisponible'}</span>
				</section>

				<section className={css.cataloguePanel}>
					<div className={css.catalogueGlow} />
					{selected && <div className={css.catalogueLogo} aria-hidden="true"><ChannelLogo channel={selected} /></div>}
					<div className={css.catalogueContent}><span className={css.catalogueKicker}>CATALOGUE ACTIF · V20</span><Heading spacing="none">{selected ? channelTitle(selected) : 'Direct TV'}</Heading><BodyText size="small">{selected ? 'Flux et métadonnées fournis par le profil actif.' : 'Sélectionnez une chaîne réelle du catalogue.'}</BodyText><div className={css.catalogueStats}><span><strong>{channels.length}</strong> CHAÎNES</span><span><strong>{data.epg.length}</strong> PROGRAMMES</span><span><strong>{data.movies.length}</strong> FILMS</span></div><div className={css.catalogueActions}><Button className={css.playButton} onClick={playSelected} disabled={!selected || !selected.streamUrl} icon="play">Lire le direct</Button><Button className={css.guideButton} onClick={openGuide} icon="tvguidefvp">Ouvrir le guide</Button></div></div>
				</section>
			</main>
		</div>
		<footer className={css.liveFooter}><div className={css.footerHints}><span><b>OK</b> Ouvrir la chaîne</span><span><b>↑ ↓</b> Naviguer</span><span><b>← →</b> Changer de panneau</span><Button className={css.footerFavorite} backgroundOpacity="transparent" size="small" onClick={openFavorites}>★ Favoris</Button></div><Button backgroundOpacity="transparent" size="small" onClick={goHome}>↩ Retour</Button></footer>
	</div>;
});

export default LiveTv;
