import { useEffect, useState } from 'react';
import { NavLink, Route, Routes, Navigate } from 'react-router-dom';
import './styles/App.css';
import Home from './pages/Home';
import Projects from './pages/Projects';
import Contact from './pages/Contact';
import Tasks from './pages/Tasks';
import NotFound from './pages/NotFound';

function App() {
  const [isDarkMode, setIsDarkMode] = useState(false);

  useEffect(() => {
    const rootElement = document.documentElement;

    rootElement.classList.toggle('theme-dark', isDarkMode);
    rootElement.classList.toggle('theme-light', !isDarkMode);
  }, [isDarkMode]);

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

        <button
          type="button"
          className="theme-toggle"
          onClick={() => setIsDarkMode((currentValue) => !currentValue)}
        >
          {isDarkMode ? 'Light mode' : 'Dark mode'}
        </button>
      </header>

      <main className="page-content">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/projects" element={<Navigate to="/projects/HARSHIL3431" replace />} />
          <Route path="/projects/:username" element={<Projects />} />
          <Route path="/tasks" element={<Tasks />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;