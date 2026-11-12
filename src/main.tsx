import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/index.css';
import { App } from './App';
import { initI18n } from './i18n';
import { watchTheme } from './lib/settings';
import { initPwa } from './pwa/register';

// Après une mise à jour, un écran pas encore chargé peut ne plus exister sous son ancien nom :
// on recharge l'application (une seule fois, pour ne jamais boucler).
window.addEventListener('vite:preloadError', (event) => {
  try {
    const last = Number(sessionStorage.getItem('pidielf:rechargement') ?? 0);
    if (Date.now() - last < 30_000) return;
    sessionStorage.setItem('pidielf:rechargement', String(Date.now()));
  } catch {
    return;
  }
  event.preventDefault();
  location.reload();
});

watchTheme();
void initI18n().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  initPwa();
});
