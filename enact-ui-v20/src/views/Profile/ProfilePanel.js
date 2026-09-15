import React, {useCallback, useState} from 'react';
import Heading from '@enact/sandstone/Heading';
import BodyText from '@enact/sandstone/BodyText';
import Button from '@enact/sandstone/Button';
import Icon from '@enact/sandstone/Icon';
import ProgressBar from '@enact/sandstone/ProgressBar';
import {InputField} from '@enact/sandstone/Input';
import Spottable from '@enact/spotlight/Spottable';
import css from './ProfilePanel.module.less';

const ProfileCard = Spottable('div');

function fieldValue(event) {
	return event && event.value !== undefined ? event.value : event && event.target ? event.target.value : '';
}

const ProfileCardView = React.memo(function ProfileCardView({profile, onSelect, onDelete}) {
	const select = useCallback(() => onSelect(profile), [onSelect, profile]);
	const remove = useCallback((event) => {
		event.stopPropagation();
		onDelete(profile);
	}, [onDelete, profile]);
	return <ProfileCard className={css.profileCard} onClick={select}>
		<div className={css.profileIcon}><Icon size="medium">{profile.source === 'xtream' ? 'profile' : 'link'}</Icon></div>
		<div className={css.profileText}><strong>{profile.name}</strong><BodyText size="small">{profile.source === 'xtream' ? 'Xtream Codes' : 'Lien M3U'} · {profile.activeImportId ? 'Synchronisé' : 'À importer'}</BodyText></div>
		<Button className={css.deleteButton} backgroundOpacity="transparent" size="small" icon="trash" onClick={remove} aria-label={`Supprimer ${profile.name}`} />
	</ProfileCard>;
});

const ProfilePanel = React.memo(function ProfilePanel({profiles, error, onSelect, onCreate, onDelete}) {
	const [open, setOpen] = useState(false);
	const [source, setSource] = useState('xtream');
	const [saving, setSaving] = useState(false);
	const [localError, setLocalError] = useState('');
	const [progress, setProgress] = useState(null);
	const [form, setForm] = useState({name: '', base: '', username: '', password: '', url: '', epgUrl: ''});
	const update = useCallback((key) => (event) => setForm((old) => ({...old, [key]: fieldValue(event)})), []);
	const reset = useCallback(() => { setForm({name: '', base: '', username: '', password: '', url: '', epgUrl: ''}); setLocalError(''); setProgress(null); }, []);
	const submit = useCallback(async () => {
		setSaving(true); setLocalError(''); setProgress({message: 'Création du profil…', percent: 0});
		try {
			await onCreate({...form, source}, setProgress);
			reset(); setOpen(false);
		} catch (submitError) {
			setLocalError(String(submitError.message || submitError));
		} finally { setSaving(false); }
	}, [form, onCreate, reset, source]);
	const startNew = useCallback(() => { reset(); setOpen(true); }, [reset]);
	const closeModal = useCallback(() => { if (!saving) { setOpen(false); reset(); } }, [reset, saving]);
	const chooseXtream = useCallback(() => setSource('xtream'), []);
	const chooseM3u = useCallback(() => setSource('m3u'), []);
	return <div className={css.profileShell}>
		<div className={css.profileBrand}><div className={css.brandBadge}><Icon size="large">mediaplayer</Icon></div><div><Heading spacing="none">Salon Prestige</Heading><BodyText size="small">IPTV V20 · Enact Sandstone</BodyText></div></div>
		{!profiles.length && !open ? <div className={css.welcome}><Icon size="large">tv</Icon><Heading spacing="none">Aucun profil réel</Heading><BodyText size="large">Ajoutez un compte Xtream ou un lien M3U/XMLTV pour charger votre catalogue V20.</BodyText><Button icon="plus" onClick={startNew}>Ajouter un profil</Button></div> : <div className={css.profileContent}>
			<div className={css.profileHeader}><div><Heading spacing="none">Sélectionnez votre profil</Heading><BodyText size="small">Les profils affichés proviennent uniquement de Dexie V4.</BodyText></div><Button icon="plus" onClick={startNew}>Nouveau profil</Button></div>
			<div className={css.profileGrid}>{profiles.map((profile) => <ProfileCardView key={profile.id} profile={profile} onSelect={onSelect} onDelete={onDelete} />)}</div>
		</div>}
		{(error || localError) && <div className={css.error}><Icon size="small">exclamation</Icon>{error || localError}</div>}
		{open && <div className={css.modalBackdrop}><div className={css.modal}><div className={css.modalHeader}><Heading spacing="none">Ajouter un profil IPTV</Heading><Button backgroundOpacity="transparent" size="small" icon="closex" onClick={closeModal} aria-label="Fermer" /></div><div className={css.sourceTabs}><Button size="small" selected={source === 'xtream'} onClick={chooseXtream}>Compte Xtream</Button><Button size="small" selected={source === 'm3u'} onClick={chooseM3u}>Lien M3U</Button></div><div className={css.formGrid}><InputField value={form.name} onChange={update('name')} placeholder="Nom du profil"/><InputField value={source === 'xtream' ? form.base : form.url} onChange={update(source === 'xtream' ? 'base' : 'url')} placeholder={source === 'xtream' ? 'Serveur http(s)://' : 'URL complète de la playlist M3U'} type="url"/>{source === 'xtream' ? <><InputField value={form.username} onChange={update('username')} placeholder="Nom d’utilisateur"/><InputField value={form.password} onChange={update('password')} placeholder="Mot de passe" type="password"/></> : <InputField value={form.epgUrl} onChange={update('epgUrl')} placeholder="URL XMLTV optionnelle" type="url"/>}</div>{saving && <div className={css.progress}><BodyText size="small">{progress && progress.message ? progress.message : 'Import en cours…'}</BodyText><ProgressBar progress={progress && progress.percent ? progress.percent / 100 : 0} /></div>}{(localError || error) && <div className={css.error}><Icon size="small">exclamation</Icon>{localError || error}</div>}<Button className={css.submitButton} icon={saving ? 'refresh' : 'play'} disabled={saving} onClick={submit}>{saving ? 'Import en cours…' : 'Créer et synchroniser'}</Button></div></div>}
	</div>;
});

export default ProfilePanel;
