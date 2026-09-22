import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';
import './styles/ui-unified.css';
import './styles/responsive-hardening.css';
import { registerPwa } from './lib/pwa';
import { initOfflineMode } from './lib/offline';

registerPwa();
initOfflineMode();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
