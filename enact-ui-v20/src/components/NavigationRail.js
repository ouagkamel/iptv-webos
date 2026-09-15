import React, {useCallback} from 'react';
import Button from '@enact/sandstone/Button';
import Icon from '@enact/sandstone/Icon';
import SpotlightContainerDecorator from '@enact/spotlight/SpotlightContainerDecorator';
import css from './NavigationRail.module.less';

const NavContainer = SpotlightContainerDecorator({enterTo: 'last-focused'}, 'nav');

const NAV_ITEMS = [
	{id: 'home', icon: 'home', label: 'Accueil'},
	{id: 'live', icon: 'channel', label: 'En Direct'},
	{id: 'vod', icon: 'movies', label: 'Films'},
	{id: 'series', icon: 'folder', label: 'Séries'},
	{id: 'guide', icon: 'tvguidefvp', label: 'Grille EPG'},
	{id: 'favorites', icon: 'bookmark', label: 'Favoris'},
	{id: 'settings', icon: 'gear', label: 'Réglages'}
];

const NavigationRail = React.memo(function NavigationRail({activeTab, onNavigate, onSwitchProfile}) {
	const navigate = useCallback((event) => {
		const id = event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.nav;
		if (id) onNavigate(id);
	}, [onNavigate]);
	return <NavContainer className={css.rail} spotlightId="main-rail">
		<div className={css.brandBadge} aria-label="Salon Prestige IPTV"><Icon size="large">mediaplayer</Icon></div>
		<div className={css.menuGroup}>
			{NAV_ITEMS.map((item) => <Button
				key={item.id}
				data-nav={item.id}
				className={`${css.navItem} ${activeTab === item.id ? css.active : ''}`}
				backgroundOpacity="transparent"
				size="small"
				icon={item.icon}
				onClick={navigate}
				aria-label={item.label}
				title={item.label}
			/>)}
		</div>
		<div className={css.railFooter}>
			<Button className={css.navItem} backgroundOpacity="transparent" size="small" icon="logout" onClick={onSwitchProfile} aria-label="Changer de profil" title="Changer de profil" />
			<span className={css.onlineDot} title="Base V20 disponible" />
		</div>
	</NavContainer>;
});

export default NavigationRail;
