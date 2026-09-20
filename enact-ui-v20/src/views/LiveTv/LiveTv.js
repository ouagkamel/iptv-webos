import React, {useCallback, useEffect, useMemo, useState} from 'react';
import BodyText from '@enact/sandstone/BodyText';
import Button from '@enact/sandstone/Button';
import Heading from '@enact/sandstone/Heading';
import Icon from '@enact/sandstone/Icon';
import Image from '@enact/sandstone/Image';
import VirtualList from '@enact/sandstone/VirtualList';
import Spotlight from '@enact/spotlight';
import Spottable from '@enact/spotlight/Spottable';
import SpotlightContainerDecorator from '@enact/spotlight/SpotlightContainerDecorator';
import {EmptyState} from '../../components/MediaCards';
import css from './LiveTv.module.less';

const CategoryContainer = SpotlightContainerDecorator({enterTo: 'default-element'}, 'div');
const ChannelListContainer = SpotlightContainerDecorator({enterTo: 'last-focused'}, 'div');
const ProgramContainer = SpotlightContainerDecorator({enterTo: 'last-focused'}, 'div');
const ChannelItem = Spottable('div');
const ProgramItem = Spottable('div');

function groupName(channel) {
	return String(channel && channel.groupName || 'Autres').trim() || 'Autres';
}

function channelNumber(channel, index) {
	return channel && (channel.num || channel.number) ? String(channel.num || channel.number) : String(index + 1).padStart(2, '0');
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

function time(value) {
	const date = new Date(Number(value));
	return Number.isNaN(date.getTime()) ? '--:--' : date.toLocaleTimeString('fr-FR', {hour: '2-digit', minute: '2-digit'});
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
	return [channel.quality, channel.resolution, channel.streamType, channel.codec].filter(Boolean).map(String);
}

const ChannelRow = React.memo(function ChannelRow({channel, index, selected, program, onSelect}) {
	const select = useCallback(() => onSelect(channel), [channel, onSelect]);
	const details = metadata(channel);
	const now = Date.now();
	return <ChannelItem className={`${css.channelRow} ${selected ? css.channelRowSelected : ''}`} onClick={select} aria-label={`${channel.name}, ${program ? program.title : 'EPG indisponible'}`}>
		<div className={css.channelRowHeader}>
			<span className={css.channelNumber}>{channelNumber(channel, index)}</span>
			<div className={css.channelRowNames}>
				<strong>{channel.name}</strong>
				<span>{program ? program.title : 'Programme EPG indisponible'}</span>
			</div>
			{details.length > 0 && <span className={css.channelQuality}>{details[0]}</span>}
		</div>
		<div className={css.channelProgressLine}>
			<span>{program ? time(program.startTime) : '--:--'}</span>
			<div className={css.progressTrack}><span className={css.progressValue} style={{width: `${progress(program, now)}%`}} /></div>
			<span>{program ? time(program.stopTime) : '--:--'}</span>
		</div>
		<div className={css.channelRowFooter}>
			<span>{groupName(channel)}</span>
			<span>{program ? remaining(program, now) : 'Aucun EPG associé'}</span>
		</div>
	</ChannelItem>;
});

const ProgramRow = React.memo(function ProgramRow({program, current}) {
	return <ProgramItem className={`${css.programRow} ${current ? css.programRowCurrent : ''}`} aria-label={`${program.title}, ${time(program.startTime)}`}>
		<div className={css.programTime}>{time(program.startTime)} — {time(program.stopTime)}</div>
		<strong>{program.title}</strong>
		{program.description && <span>{program.description}</span>}
	</ProgramItem>;
});

const LiveTv = React.memo(function LiveTv({data, profile, onPlay, onNavigate}) {
	const [selectedId, setSelectedId] = useState(data.channels[0] ? data.channels[0].id : null);
	const [selectedGroup, setSelectedGroup] = useState('all');
	const [logoFailed, setLogoFailed] = useState(false);
	const [now, setNow] = useState(() => Date.now());
	const programs = useMemo(() => epgIndex(data.epg), [data.epg]);
	const categories = useMemo(() => {
		const counts = Object.create(null);
		const order = [];
		(data.channels || []).forEach((channel) => {
			const label = groupName(channel);
			if (!counts[label]) order.push(label);
			counts[label] = (counts[label] || 0) + 1;
		});
		return [{id: 'all', label: `Toutes (${data.channels.length})`}].concat(order.map((label) => ({id: label, label: `${label} (${counts[label]})`})));
	}, [data.channels]);
	const filteredChannels = useMemo(() => selectedGroup === 'all' ? data.channels : data.channels.filter((channel) => groupName(channel) === selectedGroup), [data.channels, selectedGroup]);
	const selected = data.channels.find((channel) => channel.id === selectedId) || filteredChannels[0] || data.channels[0] || null;
	const selectedIndex = selected ? data.channels.findIndex((channel) => channel.id === selected.id) : -1;
	const selectedProgram = selected ? currentProgram(selected, programs, now) : null;
	const upcoming = selected ? upcomingPrograms(selected, programs, now) : [];
	const selectedMetadata = selected ? metadata(selected) : [];
	const selectedLogo = selected ? selected.logo : '';
	const selectChannel = useCallback((channel) => {
		setSelectedId(channel.id);
		setLogoFailed(false);
	}, []);
	const renderChannel = useCallback(({index}) => {
		const channel = filteredChannels[index];
		if (!channel) return null;
		return <ChannelRow channel={channel} index={data.channels.indexOf(channel)} selected={selected && selected.id === channel.id} program={currentProgram(channel, programs, now)} onSelect={selectChannel} />;
	}, [data.channels, filteredChannels, now, programs, selectChannel, selected]);
	const playSelected = useCallback(() => {
		if (selected && selected.streamUrl) onPlay({...selected, kind: 'live'});
	}, [onPlay, selected]);
	const openGuide = useCallback(() => onNavigate('guide'), [onNavigate]);
	const openFavorites = useCallback(() => onNavigate('favorites'), [onNavigate]);
	const openHome = useCallback(() => onNavigate('home'), [onNavigate]);
	const openSettings = useCallback(() => onNavigate('settings'), [onNavigate]);
	const selectGroup = useCallback((event) => setSelectedGroup(event.currentTarget.dataset.group || 'all'), []);
	const failLogo = useCallback(() => setLogoFailed(true), []);
	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), 30000);
		return () => clearInterval(timer);
	}, []);
	useEffect(() => {
		if (!selected && filteredChannels.length) setSelectedId(filteredChannels[0].id);
		if (selected && selectedGroup !== 'all' && !filteredChannels.some((channel) => channel.id === selected.id) && filteredChannels[0]) setSelectedId(filteredChannels[0].id);
	}, [filteredChannels, selected, selectedGroup]);
	useEffect(() => {
		if (data.channels.length) Spotlight.focus('live-channel-list');
	}, [data.channels.length]);
	useEffect(() => setLogoFailed(false), [selectedLogo]);

	if (!data.channels.length) return <div className={css.liveScreen}><EmptyState icon="channel" title="Aucune chaîne Live importée" text="La vue Chaînes TV utilise uniquement les chaînes réelles du catalogue actif." action="Ouvrir les réglages" onAction={openSettings} /></div>;

	return <div className={css.liveScreen}>
		<aside className={css.channelSidebar}>
			<div className={css.sidebarHeading}>
				<div className={css.sidebarTitle}><span className={css.liveDot} /><Heading size="small" spacing="none">Chaînes en direct</Heading></div>
				<span className={css.actualCount}>{data.channels.length} réelles</span>
			</div>
			<CategoryContainer spotlightId="live-categories" className={css.categoryRow}>
				{categories.map((category) => <Button key={category.id} data-group={category.id} className={`${css.categoryPill} ${selectedGroup === category.id ? css.categoryPillActive : ''}`} backgroundOpacity="transparent" size="small" onClick={selectGroup}>{category.label}</Button>)}
			</CategoryContainer>
			<ChannelListContainer spotlightId="live-channel-list" className={css.channelList}>
					<VirtualList className={css.channelVirtualList} dataSize={filteredChannels.length} itemRenderer={renderChannel} itemSize={137} verticalScrollbar="hidden" horizontalScrollbar="hidden" spotlightId="live-channel-virtual-list" wrap="noAnimation" />
			</ChannelListContainer>
			<div className={css.remoteHint}><span>▲▼ Zapper</span><span>OK Sélectionner</span></div>
		</aside>

		<main className={css.liveStage}>
			<header className={css.liveTopBar}>
				<div className={css.liveHeaderIdentity}>
					<span className={css.onAirBadge}><span className={css.liveDotSmall} /> EN DIRECT</span>
					<span className={css.channelRef}>CANAL {selected ? channelNumber(selected, selectedIndex) : '--'}</span>
					<strong>{selected ? selected.name : 'Aucune chaîne'}</strong>
				</div>
				<div className={css.liveHeaderActions}>
					<span className={css.sourcePill}>{profile && profile.source ? profile.source.toUpperCase() : 'V20'}</span>
					<Button backgroundOpacity="transparent" size="small" icon="home" onClick={openHome} aria-label="Accueil">Accueil</Button>
				</div>
			</header>

			<section className={css.streamSurface} aria-label="Aperçu du canal sélectionné">
				<div className={css.surfaceGlow} />
				<div className={css.surfaceContent}>
						{selected && selected.logo && !logoFailed ? <Image className={css.channelLogo} src={selected.logo} alt={selected.name} onError={failLogo} /> : <div className={css.channelIcon}><Icon size="large">channel</Icon></div>}
					<span className={css.surfaceStatus}>{selected && selected.streamUrl ? 'Flux réel disponible' : 'URL de flux indisponible'}</span>
					<Heading spacing="none">{selected ? selected.name : 'Sélectionnez une chaîne'}</Heading>
					<BodyText size="small">{selectedProgram ? selectedProgram.title : 'Aucun programme EPG en cours pour ce canal.'}</BodyText>
					<Button className={css.playButton} icon="play" onClick={playSelected} disabled={!selected || !selected.streamUrl}>Lire le direct</Button>
				</div>
			</section>

			<aside className={css.epgPanel}>
				<div className={css.epgHeading}><Icon size="small">tvguidefvp</Icon><strong>Prochains programmes</strong><span>{selected ? `Canal ${channelNumber(selected, selectedIndex)}` : ''}</span></div>
				<ProgramContainer spotlightId="live-upcoming-programs" className={css.programList}>
					{upcoming.length ? upcoming.map((program, index) => <ProgramRow key={`${program.id || program.startTime}-${index}`} program={program} current={selectedProgram && program.id === selectedProgram.id} />) : <BodyText size="small" className={css.noEpg}>Aucun programme futur dans l’EPG réel.</BodyText>}
				</ProgramContainer>
			</aside>

			<footer className={css.osdDock}>
				<div className={css.osdTitleBlock}><div className={css.osdKicker}><span>DIRECT LIVE</span><span>{selected ? groupName(selected) : ''}</span></div><Heading spacing="none">{selectedProgram ? selectedProgram.title : selected ? selected.name : 'Aucun canal sélectionné'}</Heading><BodyText size="small">{selectedProgram ? `${time(selectedProgram.startTime)} — ${time(selectedProgram.stopTime)} · ${remaining(selectedProgram, now)}` : 'Les informations EPG s’afficheront lorsqu’elles seront disponibles.'}</BodyText></div>
				<div className={css.osdMeta}>{selectedMetadata.length ? selectedMetadata.map((item) => <span key={item}>{item}</span>) : <span>Métadonnées fournisseur non disponibles</span>}<span>{selected && selected.streamUrl ? 'Flux prêt' : 'Flux indisponible'}</span></div>
				<div className={css.osdActions}><Button className={css.osdPrimary} icon="play" onClick={playSelected} disabled={!selected || !selected.streamUrl}>Lecture</Button><Button className={css.osdButton} icon="tvguidefvp" onClick={openGuide}>Grille EPG</Button><Button className={css.osdButton} icon="bookmark" onClick={openFavorites}>Favoris</Button></div>
			</footer>
		</main>
	</div>;
});

export default LiveTv;
