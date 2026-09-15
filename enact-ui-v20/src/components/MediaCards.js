import React, {useCallback, useState} from 'react';
import Spottable from '@enact/spotlight/Spottable';
import Image from '@enact/sandstone/Image';
import Icon from '@enact/sandstone/Icon';
import BodyText from '@enact/sandstone/BodyText';
import css from './MediaCards.module.less';

const SpottableCard = Spottable('div');

const fallbackArt = (from, to, label) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 600"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="900" height="600" fill="url(#g)"/><circle cx="760" cy="110" r="130" fill="white" fill-opacity=".12"/><path d="M0 500c180-120 300-70 430-150s280-100 470 25v225H0z" fill="white" fill-opacity=".1"/><text x="52" y="500" fill="white" fill-opacity=".86" font-family="Arial,sans-serif" font-size="64" font-weight="700">${label}</text></svg>`)}`;
const FALLBACKS = {
	live: fallbackArt('#78350f', '#9a3412', 'LIVE'),
	movie: fallbackArt('#312e81', '#7c3aed', 'FILM'),
	series: fallbackArt('#075985', '#0f766e', 'SERIES')
};

function MediaArt({src, kind = 'movie', alt = ''}) {
	const fallback = FALLBACKS[kind] || FALLBACKS.movie;
	const [image, setImage] = useState(src || fallback);
	const handleError = useCallback(() => { if (image !== fallback) setImage(fallback); }, [fallback, image]);
	return <Image className={css.mediaImage} src={image} alt={alt} onError={handleError} />;
}

export const EmptyState = React.memo(function EmptyState({icon = 'movies', title, text, action, onAction}) {
	return <div className={css.emptyState}>
		<Icon size="large">{icon}</Icon>
		<BodyText size="large" className={css.emptyTitle}>{title}</BodyText>
		{text && <BodyText size="small" className={css.emptyText}>{text}</BodyText>}
		{action && <button className={css.emptyAction} onClick={onAction}>{action}</button>}
	</div>;
});

export const LiveCard = React.memo(function LiveCard({channel, program, onPlay}) {
	const play = useCallback(() => onPlay({...channel, kind: 'live'}), [channel, onPlay]);
	return <SpottableCard className={css.liveCard} onClick={play}>
		<div className={css.liveMedia}><MediaArt src={channel.logo} kind="live" alt={channel.name} /><div className={css.mediaShade} />
			<div className={css.mediaBadges}><span className={css.liveBadge}><span className={css.redDot} /> LIVE</span>{channel.groupName && <span className={css.darkBadge}>{channel.groupName}</span>}</div>
			<div className={css.liveMeta}><strong>{channel.name}</strong><span>{program ? program.title : 'Programme EPG indisponible'}</span><div className={css.progressTrack}><span className={css.progressValue} style={{width: program ? '62%' : '0%'}} /></div></div>
		</div>
	</SpottableCard>;
});

export const MovieCard = React.memo(function MovieCard({movie, onPlay}) {
	const play = useCallback(() => onPlay(movie), [movie, onPlay]);
	return <SpottableCard className={css.posterCard} onClick={play}>
		<div className={css.posterMedia}><MediaArt src={movie.logo} kind="movie" alt={movie.name} /><span className={css.qualityBadge}>{movie.rating ? `★ ${movie.rating}` : 'VOD'}</span></div>
		<div className={css.posterInfo}><strong>{movie.name}</strong><span>{movie.releaseDate || 'Catalogue VOD'}{movie.groupName ? ` · ${movie.groupName}` : ''}</span></div>
	</SpottableCard>;
});

export const SeriesCard = React.memo(function SeriesCard({series}) {
	return <SpottableCard className={css.posterCard}>
		<div className={css.posterMedia}><MediaArt src={series.logo} kind="series" alt={series.name} /><span className={css.qualityBadge}>SÉRIE</span></div>
		<div className={css.posterInfo}><strong>{series.name}</strong><span>{series.groupName || 'Catalogue séries'}</span></div>
	</SpottableCard>;
});

export const EpisodeCard = React.memo(function EpisodeCard({entry, profile, onPlay}) {
	const episode = entry && entry.episode;
	const series = entry && entry.series;
	const play = useCallback(() => {
		if (episode && series) onPlay({name: `${series.name} · ${episode.title}`, streamUrl: episodeUrlFor(profile, episode), kind: 'series'});
	}, [episode, onPlay, profile, series]);
	return <SpottableCard className={css.posterCard} onClick={play}>
		<div className={css.posterMedia}><MediaArt src={series.logo} kind="series" alt={series.name} /><span className={css.qualityBadge}>S{entry.season.number} E{episode.episodeId}</span></div>
		<div className={css.posterInfo}><strong>{series.name}</strong><span>{episode.title}</span></div>
	</SpottableCard>;
});

function episodeUrlFor(profile, episode) {
	if (!profile || !episode) return '';
	const base = String(profile.base || '').replace(/\/+$/, '');
	return `${base}/series/${encodeURIComponent(profile.username || '')}/${encodeURIComponent(profile.password || '')}/${encodeURIComponent(episode.id)}.${encodeURIComponent(episode.ext || 'mp4')}`;
}

export const FavoriteCard = React.memo(function FavoriteCard({item, onPlay}) {
	const kind = item.kind === 'live' ? 'live' : item.kind === 'series' ? 'series' : 'movie';
	const play = useCallback(() => onPlay(item), [item, onPlay]);
	return <SpottableCard className={css.posterCard} onClick={play}>
		<div className={css.posterMedia}><MediaArt src={item.logo} kind={kind} alt={item.name} /><span className={css.qualityBadge}>FAVORI</span></div>
		<div className={css.posterInfo}><strong>{item.name}</strong><span>{item.groupName || item.kind || 'V20'}</span></div>
	</SpottableCard>;
});
