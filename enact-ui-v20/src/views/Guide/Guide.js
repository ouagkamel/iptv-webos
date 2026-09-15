import React, {useCallback, useMemo} from 'react';
import Heading from '@enact/sandstone/Heading';
import BodyText from '@enact/sandstone/BodyText';
import Button from '@enact/sandstone/Button';
import Icon from '@enact/sandstone/Icon';
import VirtualList from '@enact/sandstone/VirtualList';
import Spottable from '@enact/spotlight/Spottable';
import {EmptyState} from '../../components/MediaCards';
import css from './Guide.module.less';

const GuideCard = Spottable('div');

function time(value) {
	const date = new Date(Number(value));
	return Number.isNaN(date.getTime()) ? '--:--' : date.toLocaleTimeString('fr-FR', {hour: '2-digit', minute: '2-digit'});
}

function currentPrograms(channels, epg) {
	const byChannel = Object.create(null);
	(channels || []).forEach((channel) => {
		if (channel.channelId) byChannel[String(channel.channelId)] = channel;
	});
	const now = Date.now();
	return (epg || []).filter((program) => {
		return byChannel[String(program.channelId)] && Number(program.startTime) <= now && Number(program.stopTime) >= now;
	}).map((program) => ({channel: byChannel[String(program.channelId)], program})).sort((a, b) => Number(a.program.startTime) - Number(b.program.startTime));
}

const Guide = React.memo(function Guide({data, onPlay}) {
	const programs = useMemo(() => currentPrograms(data.channels, data.epg), [data.channels, data.epg]);
	const playProgram = useCallback((event) => {
		const entry = programs[Number(event.currentTarget.dataset.index)];
		if (entry) onPlay({...entry.channel, kind: 'live'});
	}, [onPlay, programs]);
	const renderProgram = useCallback(({index}) => {
		const entry = programs[index];
		return <GuideCard data-index={index} className={css.matchCard} onClick={playProgram}><span className={css.matchTime}><Icon size="small">liverecord</Icon> EN DIRECT · {time(entry.program.startTime)}</span><strong>{entry.program.title}</strong><BodyText size="small">{entry.channel.name}</BodyText></GuideCard>;
	}, [playProgram, programs]);
	const first = data.channels[0];
	const playFirst = useCallback(() => { if (first) onPlay({...first, kind: 'live'}); }, [first, onPlay]);
	return <div className={css.guide}>
		<div className={css.guideHeader}><div><Heading spacing="none">Grille EPG</Heading><BodyText size="small">Programmes issus exclusivement de l’import XMLTV actif.</BodyText></div>{first && <Button size="small" backgroundOpacity="transparent" icon="play" onClick={playFirst}>Lire la première chaîne</Button>}</div>
		<div className={css.guideColumns}>{programs.length ? <VirtualList className={css.matchList} dataSize={programs.length} itemRenderer={renderProgram} itemSize={110} verticalScrollbar="hidden" horizontalScrollbar="hidden" spotlightId="epg-program-list" /> : <EmptyState icon="tvguidefvp" title="Aucun programme EPG en cours" text="Le guide réel ne contient aucun programme à cet instant." />}<div className={css.guideInfo}><Icon size="large">tvguidefvp</Icon><Heading spacing="none">{first ? first.name : 'Aucune chaîne'}</Heading><BodyText size="small">{data.epg.length ? `${data.epg.length} programme(s) XMLTV chargé(s).` : 'Aucune donnée EPG active.'}</BodyText></div></div>
	</div>;
});

export default Guide;
