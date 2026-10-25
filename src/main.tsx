import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {MediaDockProvider} from './components/MediaDock';
import './index.css';
import {installNativeShell} from './utils/nativeShell';

installNativeShell();

createRoot(document.getElementById('root')!).render(
  <MediaDockProvider>
    <App />
  </MediaDockProvider>
);
