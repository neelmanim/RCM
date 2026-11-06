import { createRoot } from 'react-dom/client';
import PublicPage from './pages/PublicPage';
import './public-pages.css';

const root = document.getElementById('public-root');
createRoot(root).render(<PublicPage />);
