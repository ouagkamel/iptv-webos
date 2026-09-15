/* global ENACT_PACK_ISOMORPHIC */
import {createRoot, hydrateRoot} from 'react-dom/client';
import Spotlight from '@enact/spotlight';
import App from './App';

// Enact Spotlight est la seule couche de navigation 5-way de cette variante.
// Le mode pointeur est désactivé pour conserver un comportement télécommande.
Spotlight.setPointerMode(false);

const appElement = (<App />);

if (typeof window !== 'undefined') {
	if (ENACT_PACK_ISOMORPHIC) {
		hydrateRoot(document.getElementById('root'), appElement);
	} else {
		createRoot(document.getElementById('root')).render(appElement);
	}
}

export default appElement;
