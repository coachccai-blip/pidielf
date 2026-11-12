import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/index.css';
import { App } from './App';
import { initI18n } from './i18n';
import { watchTheme } from './lib/settings';
import { initPwa } from './pwa/register';

watchTheme();
void initI18n().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  initPwa();
});
