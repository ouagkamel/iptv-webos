import React, {useCallback, useMemo} from 'react';
import Heading from '@enact/sandstone/Heading';
import BodyText from '@enact/sandstone/BodyText';
import VirtualList, {VirtualGridList} from '@enact/sandstone/VirtualList';
import {EmptyState, LiveCard, MovieCard, SeriesCard, EpisodeCard, FavoriteCard} from '../../components/MediaCards';
import css from './Catalog.module.less';

function currentProgram(channel, epg) {
	if (!channel || !channel.channelId) return null;
	const now = Date.now();
	return (epg || []).filter((row) => String(row.channelId) === String(channel.channelId) && Number(row.startTime) <= now && Number(row.stopTime) >= now).sort((a, b) => Number(a.startTime) - Number(b.startTime))[0] || null;
}

const Catalog = React.memo(function Catalog({mode, data, profile, onPlay}) {
	const label = mode === 'live' ? 'Chaînes Live réelles' : mode === 'vod' ? 'Films du catalogue réel' : mode === 'series' ? 'Séries et épisodes' : 'Favoris V20';
	const renderLive = useCallback(({index}) => <LiveCard channel={data.channels[index]} program={currentProgram(data.channels[index], data.epg)} onPlay={onPlay} />, [data.channels, data.epg, onPlay]);
	const renderMovie = useCallback(({index}) => <MovieCard movie={data.movies[index]} onPlay={onPlay} />, [data.movies, onPlay]);
	const renderSeries = useCallback(({index}) => <SeriesCard series={data.series[index]} />, [data.series]);
	const renderEpisode = useCallback(({index}) => <EpisodeCard entry={data.episodes[index]} profile={profile} onPlay={onPlay} />, [data.episodes, onPlay, profile]);
	const renderFavorite = useCallback(({index}) => <FavoriteCard item={data.favorites[index]} onPlay={onPlay} />, [data.favorites, onPlay]);
	const empty = useMemo(() => {
		const text = mode === 'live' ? 'Aucune chaîne réelle dans l’import actif.' : mode === 'vod' ? 'Aucun film réel dans l’import actif.' : mode === 'series' ? 'Aucune série ou épisode disponible.' : 'Aucun favori enregistré dans V20.';
		return <EmptyState icon={mode === 'live' ? 'channel' : mode === 'favorites' ? 'bookmark' : 'movies'} title="État vide réel" text={text} />;
	}, [mode]);
	if (mode === 'live') return <div className={css.catalog}><Heading spacing="none">{label}</Heading><BodyText size="small" className={css.description}>Navigation Spotlight horizontale · {data.channels.length} élément(s) réel(s)</BodyText>{data.channels.length ? <VirtualList className={css.liveList} dataSize={data.channels.length} itemRenderer={renderLive} itemSize={450} direction="horizontal" horizontalScrollbar="hidden" verticalScrollbar="hidden" spotlightId="catalog-live-list" wrap="noAnimation" /> : empty}</div>;
	if (mode === 'series') return <div className={css.catalog}><Heading spacing="none">{label}</Heading><BodyText size="small" className={css.description}>Les épisodes sont lus uniquement depuis les détails Xtream chargés.</BodyText>{data.episodes.length > 0 && <><h3 className={css.subHeading}>Derniers épisodes</h3><VirtualGridList className={css.episodeGrid} dataSize={data.episodes.length} itemRenderer={renderEpisode} itemSize={{minWidth: 270, minHeight: 430}} verticalScrollbar="hidden" horizontalScrollbar="hidden" spotlightId="catalog-episodes-grid" /></>}{data.series.length > 0 && <><h3 className={css.subHeading}>Toutes les séries</h3><VirtualGridList className={css.posterGrid} dataSize={data.series.length} itemRenderer={renderSeries} itemSize={{minWidth: 270, minHeight: 455}} verticalScrollbar="hidden" horizontalScrollbar="hidden" spotlightId="catalog-series-grid" /></>}{!data.series.length && !data.episodes.length && empty}</div>;
	const list = mode === 'vod' ? data.movies : data.favorites;
	const renderer = mode === 'vod' ? renderMovie : renderFavorite;
	return <div className={css.catalog}><Heading spacing="none">{label}</Heading><BodyText size="small" className={css.description}>Composants Sandstone virtualisés · {list.length} élément(s) réel(s)</BodyText>{list.length ? <VirtualGridList className={css.posterGrid} dataSize={list.length} itemRenderer={renderer} itemSize={{minWidth: 270, minHeight: 455}} verticalScrollbar="hidden" horizontalScrollbar="hidden" spotlightId={`catalog-${mode}-grid`} /> : empty}</div>;
});

export default Catalog;
