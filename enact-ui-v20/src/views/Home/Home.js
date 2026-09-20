import React, {useCallback, useEffect, useMemo, useState} from 'react';
import Heading from '@enact/sandstone/Heading';
import BodyText from '@enact/sandstone/BodyText';
import Button from '@enact/sandstone/Button';
import Icon from '@enact/sandstone/Icon';
import VirtualList from '@enact/sandstone/VirtualList';
import {VirtualGridList} from '@enact/sandstone/VirtualList';
import SpotlightContainerDecorator from '@enact/spotlight/SpotlightContainerDecorator';
import {EmptyState, LiveCard, MovieCard} from '../../components/MediaCards';
import css from './Home.module.less';

const LiveRow = SpotlightContainerDecorator({enterTo: 'default-element'}, 'section');
const VodRow = SpotlightContainerDecorator({enterTo: 'default-element'}, 'section');

function nowProgram(channel, byChannel) {
	const now = Date.now();
	const rows = byChannel[String(channel.channelId)] || [];
	return rows.filter((row) => Number(row.startTime) <= now && Number(row.stopTime) >= now).sort((a, b) => Number(a.startTime) - Number(b.startTime))[0] || null;
}

const Home = React.memo(function Home({data, profile, onPlay, onNavigate}) {
	const [selected, setSelected] = useState(data.channels[0] || null);
	useEffect(() => {
		if (!data.channels.length) {
			setSelected(null);
			return;
		}
		if (!selected || !data.channels.some((channel) => channel.id === selected.id)) setSelected(data.channels[0]);
	}, [data.channels, selected]);
	const programsByChannel = useMemo(() => {
		const map = Object.create(null);
		(data.epg || []).forEach((program) => {
			const key = String(program.channelId || '');
			if (!map[key]) map[key] = [];
			map[key].push(program);
		});
		return map;
	}, [data.epg]);
	const handlePlay = useCallback((item) => {
		if (item && item.kind === 'live') setSelected(item);
		onPlay(item);
	}, [onPlay]);
	const renderLive = useCallback(({index}) => {
		const channel = data.channels[index];
		return <LiveCard channel={channel} program={nowProgram(channel, programsByChannel)} onPlay={handlePlay} />;
	}, [data.channels, handlePlay, programsByChannel]);
	const renderMovie = useCallback(({index}) => <MovieCard movie={data.movies[index]} onPlay={handlePlay} />, [data.movies, handlePlay]);
	const goGuide = useCallback(() => onNavigate('guide'), [onNavigate]);
	const goVod = useCallback(() => onNavigate('vod'), [onNavigate]);
	const goSettings = useCallback(() => onNavigate('settings'), [onNavigate]);
	const playSelected = useCallback(() => { if (selected) handlePlay({...selected, kind: 'live'}); }, [handlePlay, selected]);
	const selectedProgram = selected ? nowProgram(selected, programsByChannel) : null;
	return <div className={css.home}>
		<LiveRow className={css.section} spotlightId="home-live-row">
			<div className={css.sectionHeader}>
				<div className={css.sectionTitle}>
					<Icon size="medium">liverecord</Icon>
					<div className={css.sectionTitleCopy}><Heading spacing="none">En Direct Maintenant</Heading><BodyText size="small">{data.channels.length} chaînes actives · catalogue réel V20</BodyText></div>
				</div>
				<div className={css.sectionHeaderActions}><span className={css.sectionTag}>HLS · LIVE</span><Button backgroundOpacity="transparent" size="small" icon="arrowrightskip" onClick={goGuide}>Grille EPG</Button></div>
			</div>
			{data.channels.length ? <VirtualList
				className={css.liveList}
				dataSize={data.channels.length}
				itemRenderer={renderLive}
				itemSize={450}
				direction="horizontal"
				horizontalScrollbar="hidden"
				verticalScrollbar="hidden"
				spotlightId="home-live-list"
				wrap="noAnimation"
			/> : <EmptyState icon="channel" title="Aucune chaîne importée" text="Le profil actif ne contient aucun catalogue Live réel." action="Ouvrir les réglages" onAction={goSettings} />}
		</LiveRow>

		<VodRow className={css.section} spotlightId="home-vod-row">
			<div className={css.sectionHeader}>
				<div className={css.sectionTitle}>
					<Icon size="medium">stargroup</Icon>
					<div className={css.sectionTitleCopy}><Heading spacing="none">Collection Masterpieces</Heading><BodyText size="small">Films réels · {profile && profile.activeImportId ? 'catalogue actif' : 'non synchronisé'}</BodyText></div>
				</div>
				<div className={css.sectionHeaderActions}><span className={css.sectionTag}>SÉLECTION V20</span><Button backgroundOpacity="transparent" size="small" icon="arrowrightskip" onClick={goVod}>Voir la VOD</Button></div>
			</div>
			{data.movies.length ? <VirtualGridList
				className={css.vodGrid}
				dataSize={data.movies.length}
				itemRenderer={renderMovie}
				itemSize={{minWidth: 270, minHeight: 455}}
				verticalScrollbar="hidden"
				horizontalScrollbar="hidden"
				spotlightId="home-vod-grid"
			/> : <EmptyState icon="movies" title="Aucun film importé" text="Les films s’afficheront après une synchronisation Xtream ou M3U réelle." action="Relire les données" onAction={goSettings} />}
		</VodRow>

		{selected && <footer className={css.quickDock}>
			<div className={css.quickInfo}><div className={css.quickPlay}><Icon size="medium">play</Icon></div><div><strong>{selected.name}</strong><BodyText size="small">{selectedProgram ? selectedProgram.title : 'Flux réel prêt à être lancé'} · {selected.groupName || 'Direct TV'}</BodyText></div></div>
			<div className={css.quickMeta}><span>EPG : {selectedProgram ? 'EN COURS' : 'NON DISPONIBLE'}</span><span>AUDIO : AUTO</span><span>{profile && profile.source ? profile.source.toUpperCase() : 'V20'}</span></div>
			<Button className={css.quickAction} icon="play" onClick={playSelected}>Lecture</Button>
		</footer>}
	</div>;
});

export default Home;
