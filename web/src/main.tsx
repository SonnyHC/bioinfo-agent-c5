import React from 'react';
import ReactDOM from 'react-dom/client';
import Chat from './Chat';
import { safeAppLink } from './navigation';
import './styles.css';
const Launch = React.lazy(() => import('./Launch'));

// Historical local-analysis links now restore inside the main conversation shell.
if (/^\/workbench(?:\/cloud)?\/?$/.test(window.location.pathname)) {
  const destination = safeAppLink('/workbench' + window.location.search);
  if (destination) window.history.replaceState(null, '', destination);
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{window.location.pathname === '/' && !window.location.search
    ? <React.Suspense fallback={<p style={{padding:32}}>正在打开 BioInfoBuddy… <a href="/?view=chat">进入工作台</a></p>}><Launch/></React.Suspense>
    : <Chat />}</React.StrictMode>,
);
