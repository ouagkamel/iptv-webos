import React, {useCallback, useEffect, useMemo, useState} from 'react';
import kind from '@enact/core/kind';
import ThemeDecorator from '@enact/sandstone/ThemeDecorator';
import Heading from '@enact/sandstone/Heading';
import BodyText from '@enact/sandstone/BodyText';
import Button from '@enact/sandstone/Button';
import Icon from '@enact/sandstone/Icon';

import HomeView from '../views/Home/Home';
import CatalogView from '../views/Catalog/Catalog';
import LiveTvView from '../views/LiveTv/LiveTv';
import GuideView from '../views/Guide/Guide';
import SettingsView from '../views/Settings/Settings';
import ProfilePanel from '../views/Profile/ProfilePanel';
import VideoPlayerView from '../views/Player/VideoPlayer';
import NavigationRail from '../components/NavigationRail';
import {
	createProfile,
	iptvDb,
	readProfileData,
	readProfiles
} from '../services/iptvDb';
import {importProfileAndEpg} from '../services/importer';

import css from './App.module.less';

const tabLabels = {
	home: ['Salon Prestige', 'En Direct et sélection haute définition'],
	live: ['En Direct Maintenant', 'Chaînes et EPG du catalogue actif'],
	vod: ['Collection Masterpieces', 'Films du catalogue réel'],
	series: ['Séries et épisodes', 'Détails du catalogue Xtream réel'],
	guide: ['Grille EPG', 'Programmes en cours du guide XMLTV'],
	favorites: ['Mes Favoris', 'Contenus enregistrés dans V20'],
	settings: ['Réglages IPTV', 'Profil, import et état du stockage']
};

function removeProfileData(profile) {
	return iptvDb.imports.where('playlistId').equals(profile.id).primaryKeys().then((imports) => {
		const tables = [iptvDb.playlists, iptvDb.imports, iptvDb.channels, iptvDb.epg, iptvDb.vod, iptvDb.series, iptvDb.series_info, iptvDb.categories];
		if (iptvDb.favorites) tables.push(iptvDb.favorites);
		return iptvDb.transaction('rw', tables, async () => {
			if (imports.length) {
				await Promise.all([
					iptvDb.channels.where('importId').anyOf(imports).delete(),
					iptvDb.epg.where('importId').anyOf(imports).delete(),
					iptvDb.vod.where('importId').anyOf(imports).delete(),
					iptvDb.series.where('importId').anyOf(imports).delete(),
					iptvDb.series_info.where('importId').anyOf(imports).delete(),
					iptvDb.categories.where('importId').anyOf(imports).delete(),
					iptvDb.imports.bulkDelete(imports)
				]);
			}
			if (iptvDb.favorites) await iptvDb.favorites.where('playlistId').equals(profile.id).delete();
			await iptvDb.playlists.delete(profile.id);
		});
	});
}

const StatusBar = React.memo(function StatusBar({profile, tab, onRefresh}) {
	const [clock, setClock] = useState(() => new Date().toLocaleTimeString('fr-FR', {hour: '2-digit', minute: '2-digit'}));
	const [title, subtitle] = tabLabels[tab] || tabLabels.home;
	useEffect(() => {
		const timer = setInterval(() => setClock(new Date().toLocaleTimeString('fr-FR', {hour: '2-digit', minute: '2-digit'})), 10000);
		return () => clearInterval(timer);
	}, []);
	return <header className={css.headerBar}>
		<div className={css.headerTitleBlock}>
			<div className={css.headerKickerRow}>
				<span className={css.premiumPill}>PREMIUM EXPERIENCE</span>
				<span className={css.headerTech}><Icon size="small">wifi3</Icon> V20 · Enact Sandstone</span>
			</div>
			<Heading size="large" spacing="none" className={css.pageTitle}>{title} <span className={css.hdrBadge}>4K HDR</span></Heading>
			<BodyText size="small" className={css.pageSubtitle}>{subtitle} · <strong>{profile ? profile.name : 'Aucun profil'}</strong></BodyText>
		</div>
		<div className={css.headerStatusGroup}>
			<span className={css.statusPill}><span className={css.statusDot} /> {profile && profile.activeImportId ? 'Catalogue actif' : 'Profil non synchronisé'}</span>
			<span className={css.dpadPill}><Icon size="small">remotecontrol</Icon> D-PAD NAVIGATION ACTIVE</span>
			<span className={css.clockPill}><Icon size="small">timer</Icon> {clock}</span>
			<Button className={css.refreshButton} backgroundOpacity="transparent" size="small" icon="refresh" onClick={onRefresh} aria-label="Relire les données" />
		</div>
	</header>;
});

const LoadingPanel = React.memo(function LoadingPanel({message = 'Chargement des données V20…'}) {
	return <div className={css.loadingPanel}><span className={css.loadingMark}><Icon size="large">refresh</Icon></span><Heading size="large" spacing="none">{message}</Heading><BodyText size="small">Aucune donnée fictive n’est utilisée.</BodyText></div>;
});

const AppView = (props) => {
		const [profiles, setProfiles] = useState([]);
		const [activeProfile, setActiveProfile] = useState(null);
		const [data, setData] = useState({channels: [], movies: [], series: [], favorites: [], epg: [], episodes: []});
		const [activeTab, setActiveTab] = useState('home');
		const [loading, setLoading] = useState(true);
		const [dataLoading, setDataLoading] = useState(false);
		const [player, setPlayer] = useState(null);
		const [error, setError] = useState('');

		const loadProfiles = useCallback(async () => {
			setLoading(true);
			try {
				setProfiles(await readProfiles());
			} catch (loadError) {
				setError(String(loadError.message || loadError));
			} finally {
				setLoading(false);
			}
		}, []);

		useEffect(() => { loadProfiles(); }, [loadProfiles]);

		useEffect(() => {
			if (!activeProfile) return undefined;
			let cancelled = false;
			setDataLoading(true);
			readProfileData(activeProfile).then((next) => {
				if (!cancelled) setData(next);
			}).catch((loadError) => {
				if (!cancelled) setError(String(loadError.message || loadError));
			}).finally(() => {
				if (!cancelled) setDataLoading(false);
			});
			return () => { cancelled = true; };
		}, [activeProfile]);

		const selectProfile = useCallback((profile) => {
			setError('');
			setActiveProfile(profile);
			setActiveTab('home');
		}, []);

		const createAndImport = useCallback(async (form, onProgress) => {
			const profileId = await createProfile(form);
			await importProfileAndEpg(profileId, onProgress);
			const nextProfiles = await readProfiles();
			setProfiles(nextProfiles);
			const created = nextProfiles.find((profile) => profile.id === profileId) || nextProfiles[0];
			if (created) selectProfile(created);
		}, [selectProfile]);

		const deleteProfile = useCallback(async (profile) => {
			await removeProfileData(profile);
			if (activeProfile && activeProfile.id === profile.id) {
				setActiveProfile(null);
				setData({channels: [], movies: [], series: [], favorites: [], epg: [], episodes: []});
			}
			await loadProfiles();
		}, [activeProfile, loadProfiles]);

		const refresh = useCallback(async () => {
			if (!activeProfile) return;
			setDataLoading(true);
			try { setData(await readProfileData(activeProfile)); } catch (loadError) { setError(String(loadError.message || loadError)); } finally { setDataLoading(false); }
		}, [activeProfile]);

		const openPlayer = useCallback((item) => {
			if (item && item.streamUrl) setPlayer(item);
		}, []);
		const closePlayer = useCallback(() => setPlayer(null), []);
		const switchProfile = useCallback(() => { setPlayer(null); setActiveProfile(null); setActiveTab('home'); }, []);
		const dismissError = useCallback(() => setError(''), []);
		const content = useMemo(() => {
			if (dataLoading) return <LoadingPanel message="Lecture du catalogue V20…" />;
			if (activeTab === 'home') return <HomeView data={data} profile={activeProfile} onPlay={openPlayer} onNavigate={setActiveTab} />;
			if (activeTab === 'live') return <LiveTvView data={data} profile={activeProfile} onPlay={openPlayer} onNavigate={setActiveTab} />;
			if (activeTab === 'vod') return <CatalogView mode="vod" data={data} profile={activeProfile} onPlay={openPlayer} />;
			if (activeTab === 'series') return <CatalogView mode="series" data={data} profile={activeProfile} onPlay={openPlayer} />;
			if (activeTab === 'favorites') return <CatalogView mode="favorites" data={data} profile={activeProfile} onPlay={openPlayer} />;
			if (activeTab === 'guide') return <GuideView data={data} onPlay={openPlayer} />;
			return <SettingsView profile={activeProfile} data={data} onRefresh={refresh} onSwitchProfile={switchProfile} />;
		}, [activeProfile, activeTab, data, dataLoading, openPlayer, refresh, switchProfile]);

		if (loading) return <div className={css.app}><LoadingPanel message="Ouverture de la base V20…" /></div>;
		if (!activeProfile) return <div className={css.app}><ProfilePanel profiles={profiles} error={error} onSelect={selectProfile} onCreate={createAndImport} onDelete={deleteProfile} /></div>;
		return <div {...props} className={css.app}>
			<NavigationRail activeTab={activeTab} onNavigate={setActiveTab} onSwitchProfile={switchProfile} />
			<main className={css.contentStage}>
				<StatusBar profile={activeProfile} tab={activeTab} onRefresh={refresh} />
				{error && <div className={css.errorBanner}><Icon size="small">exclamation</Icon>{error}<Button size="small" backgroundOpacity="transparent" onClick={dismissError}>Fermer</Button></div>}
				<div className={css.contentScroll}>{content}</div>
			</main>
			{player && <VideoPlayerView item={player} onClose={closePlayer} />}
		</div>;
};

const App = kind({
	name: 'App',
	// AppView uses React hooks; Enact kind defaults to a class component.
	// The functional kind keeps the hook dispatcher active on Chromium 68.
	functional: true,
	styles: {
		css,
		className: 'app'
	},
	render: AppView
});

export default ThemeDecorator(App);
