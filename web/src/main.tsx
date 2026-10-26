import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import Chat from './Chat';
import LocalWorkbench from './LocalWorkbench';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{window.location.pathname.startsWith('/workbench/cloud') ? <App /> : window.location.pathname.startsWith('/workbench') ? <LocalWorkbench /> : <Chat />}</React.StrictMode>,
);
