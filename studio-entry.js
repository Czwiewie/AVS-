import {installStudio} from './src/studio.js';

const studio = installStudio(window, window, 'extension');
window.addEventListener('pagehide', () => studio.dispose(), {once:true});
