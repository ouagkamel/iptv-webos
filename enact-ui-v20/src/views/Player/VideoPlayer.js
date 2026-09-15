import React, {useCallback, useState} from 'react';
import VideoPlayer from '@enact/sandstone/VideoPlayer';
import Icon from '@enact/sandstone/Icon';
import Heading from '@enact/sandstone/Heading';
import BodyText from '@enact/sandstone/BodyText';
import Button from '@enact/sandstone/Button';
import css from './VideoPlayer.module.less';

const PlayerView = React.memo(function PlayerView({item, onClose}) {
	const [error, setError] = useState(false);
	const handleError = useCallback(() => setError(true), []);
	if (!item || !item.streamUrl) return <div className={css.playerFallback}><Icon size="large">tv</Icon><Heading spacing="none">Flux de lecture indisponible</Heading><BodyText size="small">Cette entrée réelle ne fournit pas d’URL de flux exploitable.</BodyText><Button onClick={onClose}>Retour</Button></div>;
	return <div className={css.playerOverlay}>
		<VideoPlayer
			className={css.videoPlayer}
			title={item.name || item.title || 'Lecture V20'}
			onBack={onClose}
			onError={handleError}
			noAutoShowMediaControls={false}
			jumpBy={15}
			spotlightId="enact-player"
		>
			<source src={item.streamUrl} />
		</VideoPlayer>
		{error && <div className={css.playerError}><Icon size="small">exclamation</Icon><span>Le moteur webOS n’a pas pu lire ce flux.</span><Button size="small" backgroundOpacity="transparent" onClick={onClose}>Fermer</Button></div>}
	</div>;
});

export default PlayerView;
