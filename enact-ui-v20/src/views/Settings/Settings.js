import React from 'react';
import Heading from '@enact/sandstone/Heading';
import BodyText from '@enact/sandstone/BodyText';
import Button from '@enact/sandstone/Button';
import Icon from '@enact/sandstone/Icon';
import css from './Settings.module.less';

const Settings = React.memo(function Settings({profile, data, onRefresh, onSwitchProfile}) {
	return <div className={css.settings}>
		<Heading spacing="none">Réglages IPTV</Heading>
		<BodyText size="small" className={css.description}>Stockage V20/Dexie V4 · aucune donnée de démonstration.</BodyText>
		<div className={css.settingsCard}><div className={css.settingsIcon}><Icon size="large">profile</Icon></div><div><strong>{profile ? profile.name : 'Aucun profil'}</strong><BodyText size="small">{profile ? `${profile.source === 'xtream' ? 'Xtream Codes' : 'Lien M3U'} · ${profile.activeImportId ? 'catalogue synchronisé' : 'non synchronisé'}` : 'Sélectionnez un profil réel.'}</BodyText></div></div>
		<div className={css.metrics}><div><span>CHAÎNES</span><strong>{data.channels.length}</strong></div><div><span>FILMS</span><strong>{data.movies.length}</strong></div><div><span>SÉRIES</span><strong>{data.series.length}</strong></div><div><span>EPG</span><strong>{data.epg.length}</strong></div></div>
		<div className={css.actions}><Button icon="refresh" onClick={onRefresh}>Relire les données</Button><Button backgroundOpacity="transparent" icon="logout" onClick={onSwitchProfile}>Changer de profil</Button></div>
	</div>;
});

export default Settings;
