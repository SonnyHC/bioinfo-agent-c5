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

// Enter the workbench only through an explicit, valid app destination.
// Unrelated query parameters and unrecognized paths still open the launch page.
const destination = safeAppLink(window.location.pathname + window.location.search);
const query = new URL(destination ?? '/', window.location.origin).searchParams;
const openWorkbench = ['view', 'plan', 'run', 'dataset'].some(key => query.has(key));

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{openWorkbench
    ? <Chat />
    : <React.Suspense fallback={<p style={{padding:32}}>正在打开 BioInfoBuddy… <a href="/?view=chat">进入工作台</a></p>}><Launch/></React.Suspense>}</React.StrictMode>,
);
