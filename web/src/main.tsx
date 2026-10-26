import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import Chat from './Chat';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{window.location.pathname.startsWith('/workbench') ? <App /> : <Chat />}</React.StrictMode>,
);
