import { useEffect, useState } from 'react';
import { NavLink, Route, Routes, Navigate } from 'react-router-dom';
import './styles/App.css';
import Home from './pages/Home';
import Projects from './pages/Projects';
import Contact from './pages/Contact';
import Tasks from './pages/Tasks';
import NotFound from './pages/NotFound';
import { authService } from './services/authService';

function App() {
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [user, setUser] = useState(() => authService.getUser());

  useEffect(() => {
    const rootElement = document.documentElement;
    rootElement.classList.toggle('theme-dark', isDarkMode);
    rootElement.classList.toggle('theme-light', !isDarkMode);
  }, [isDarkMode]);

  useEffect(() => {
    const handleUnauthorized = () => {
      setUser(null);
    };
    window.addEventListener('auth-unauthorized', handleUnauthorized);
    return () => {
      window.removeEventListener('auth-unauthorized', handleUnauthorized);
    };
  }, []);

  const handleLogout = () => {
    authService.removeToken();
    setUser(null);
  };

  const handleLoginSuccess = (userData) => {
    setUser(userData);
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Student Portfolio</p>
          <h1 className="site-title">Harshil Thakkar</h1>
        </div>

        <nav className="nav-links" aria-label="Primary navigation">
          <NavLink to="/" end>
            Home
          </NavLink>
          <NavLink to="/projects">Projects</NavLink>
          <NavLink to="/tasks">Tasks</NavLink>
          <NavLink to="/contact">Contact</NavLink>
        </nav>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {user && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className="muted" style={{ fontSize: '0.85rem' }}>{user.email}</span>
              <button
                type="button"
                className="form-button"
                onClick={handleLogout}
                style={{ padding: '6px 14px', fontSize: '0.85rem' }}
              >
                Logout
              </button>
            </div>
          )}

          <button
            type="button"
            className="theme-toggle"
            onClick={() => setIsDarkMode((currentValue) => !currentValue)}
          >
            {isDarkMode ? 'Light mode' : 'Dark mode'}
          </button>
        </div>
      </header>

      <main className="page-content">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/projects" element={<Navigate to="/projects/HARSHIL3431" replace />} />
          <Route path="/projects/:username" element={<Projects />} />
          <Route path="/tasks" element={<Tasks user={user} onLoginSuccess={handleLoginSuccess} />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;