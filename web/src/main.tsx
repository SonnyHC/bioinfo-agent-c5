import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import Chat from './Chat';
import { safeAppLink } from './navigation';
import './styles.css';

// Historical local-analysis links now restore inside the main conversation shell.
if (/^\/workbench\/?$/.test(window.location.pathname)) {
  const destination = safeAppLink(window.location.pathname + window.location.search);
  if (destination) window.history.replaceState(null, '', destination);
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{/^\/workbench\/cloud\/?$/.test(window.location.pathname) ? <App /> : <Chat />}</React.StrictMode>,
);
