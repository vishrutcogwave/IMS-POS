import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import './utilities.css';
import './ims-theme.css';

if (/^\/platform\/?$/.test(window.location.pathname)) window.history.replaceState(null, '', '/');
createRoot(document.getElementById('root')!).render(<App />);
