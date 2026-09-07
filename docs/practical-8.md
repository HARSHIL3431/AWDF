# Practical 8 — Performance Optimization and Lazy Loading

## Objective
The objective of Practical 8 is to optimize frontend web application performance by implementing **Route-Based Code Splitting** and **Component Lazy Loading** in React using `React.lazy()` and `Suspense`. 

Modern Single Page Applications (SPAs) bundle all client JavaScript into a single monolithic bundle by default. This forces users to download code for every page upfront, which degrades initial page load time and increases Time-to-Interactive (TTI). Route-based code splitting splits the bundle into smaller, on-demand JavaScript chunks that are downloaded only when the user navigates to the respective route.

---

## Baseline
Baseline production build metrics captured prior to applying code splitting (`npm run build` in `frontend`):

```text
vite v8.1.3 building client environment for production...
transforming...✓ 48 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                   0.85 kB │ gzip:  0.45 kB
dist/assets/index-CJRGLr2w.css   26.49 kB │ gzip:  5.98 kB
dist/assets/index-vqALA_eD.js   266.98 kB │ gzip: 84.44 kB

✓ built in 199ms
```

### Baseline Observations:
- **Monolithic Bundle**: A single JavaScript file (`index-vqALA_eD.js`, **266.98 kB** / 84.44 kB gzip) was generated for the entire application.
- **Upfront Overhead**: All code for `Home`, `Projects`, `Tasks`, `Contact`, `AuthForm`, and GitHub utilities was downloaded on the initial page visit, even if the user only viewed the landing page.

---

## Implementation

### 1. `React.lazy()` & Dynamic `import()`
In `frontend/src/App.jsx`, static imports of non-landing pages were replaced with dynamic imports wrapped in `React.lazy()`:

```jsx
import { useEffect, useState, lazy, Suspense } from 'react';
import { NavLink, Route, Routes, Navigate } from 'react-router-dom';
import './styles/App.css';
import Home from './pages/Home';
import { authService } from './services/authService';

// Dynamic route-level imports for code splitting
const Projects = lazy(() => import('./pages/Projects'));
const Contact = lazy(() => import('./pages/Contact'));
const Tasks = lazy(() => import('./pages/Tasks'));
const NotFound = lazy(() => import('./pages/NotFound'));
```

> **Design Choice**: `Home` remains statically imported so the initial landing page renders immediately without additional chunk network waterfall delays.

### 2. `Suspense` with Theme-Matching Fallback
The `<Routes>` block in `App.jsx` was wrapped in `<Suspense>` with a custom fallback matching the existing portfolio styling:

```jsx
<main className="page-content">
  <Suspense
    fallback={
      <div className="loading-container" role="status" aria-live="polite">
        <div className="spinner" />
        <p>Loading page...</p>
      </div>
    }
  >
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/projects" element={<Navigate to="/projects/HARSHIL3431" replace />} />
      <Route path="/projects/:username" element={<Projects />} />
      <Route path="/tasks" element={<Tasks user={user} onLoginSuccess={handleLoginSuccess} />} />
      <Route path="/contact" element={<Contact />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  </Suspense>
</main>
```

### 3. Additional Optimization: Lazy-Loaded `AuthForm`
In `frontend/src/pages/Tasks.jsx`, the authentication modal component (`AuthForm`) was optimized using `React.lazy` and `Suspense`:

```jsx
const AuthForm = lazy(() => import('../Components/AuthForm'));
```

**Why this component was selected**:
When an authenticated user visits the `/tasks` route, the `AuthForm` component is never rendered. By lazy-loading `AuthForm`, authenticated users avoid downloading authentication form logic and validation handlers, saving additional bandwidth on task management operations.

---

## Before vs After

### Production Build Comparison

| Metric | Before Optimization (Baseline) | After Optimization (Practical 8) | Change |
|---|---|---|---|
| **Main JS Bundle** | `index-vqALA_eD.js` (266.98 kB) | `index-DwwOE-05.js` (241.07 kB) | **-25.91 kB (-9.7%)** |
| **Main JS Gzip** | 84.44 kB | 77.22 kB | **-7.22 kB (-8.5%)** |
| **Main CSS Bundle** | 26.49 kB (monolithic) | 17.18 kB (core) + 9.31 kB (Projects) | **-9.31 kB initial CSS** |
| **Projects Chunk** | Bundled in main | `Projects-D1DrRuAR.js` (17.01 kB / 5.57 kB gzip) | Dynamic on `/projects` |
| **Tasks Chunk** | Bundled in main | `Tasks-BwWFQ9C7.js` (6.46 kB / 2.26 kB gzip) | Dynamic on `/tasks` |
| **AuthForm Chunk** | Bundled in main | `AuthForm-4l5oYEeF.js` (2.07 kB / 0.91 kB gzip) | Dynamic on Auth needed |
| **Contact Chunk** | Bundled in main | `Contact-DWZ6rEBY.js` (1.39 kB / 0.65 kB gzip) | Dynamic on `/contact` |
| **NotFound Chunk** | Bundled in main | `NotFound-PlMrERf_.js` (0.54 kB / 0.32 kB gzip) | Dynamic on 404 |
| **Total Chunks** | 1 JS chunk | 6 separate JS chunks | **Modular & On-Demand** |

### Post-Optimization Build Output:
```text
vite v8.1.3 building client environment for production...
transforming...✓ 48 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                      0.85 kB │ gzip:  0.45 kB
dist/assets/Projects-CiAyNF6M.css    9.31 kB │ gzip:  2.46 kB
dist/assets/index-DQbxhcCf.css      17.18 kB │ gzip:  4.44 kB
dist/assets/NotFound-PlMrERf_.js     0.54 kB │ gzip:  0.32 kB
dist/assets/Contact-DWZ6rEBY.js      1.39 kB │ gzip:  0.65 kB
dist/assets/AuthForm-4l5oYEeF.js     2.07 kB │ gzip:  0.91 kB
dist/assets/Tasks-BwWFQ9C7.js        6.46 kB │ gzip:  2.26 kB
dist/assets/Projects-D1DrRuAR.js    17.01 kB │ gzip:  5.57 kB
dist/assets/index-DwwOE-05.js      241.07 kB │ gzip: 77.22 kB

✓ built in 146ms
```

> **Note on JavaScript Total**: Lazy loading does not eliminate the application's overall code volume; it optimizes **when** route-specific code is downloaded, drastically improving initial page loading and reducing bandwidth for unused routes.

---

## Network Verification
1. **Initial Landing (`/`)**:
   - Only the core bundle (`index-*.js`, `index-*.css`) and landing components are fetched.
   - `Projects-*.js`, `Tasks-*.js`, `Contact-*.js`, and `AuthForm-*.js` are **NOT** fetched upfront.
2. **Navigating to `/projects`**:
   - The browser initiates dynamic HTTP GET requests for `Projects-*.js` and `Projects-*.css`.
3. **Navigating to `/contact`**:
   - The browser initiates dynamic HTTP GET request for `Contact-*.js`.
4. **Navigating to `/tasks`**:
   - The browser initiates dynamic HTTP GET request for `Tasks-*.js` (and `AuthForm-*.js` if unauthenticated).

---

## Suspense Verification (Slow 3G Simulation)
- Tested under simulated **Slow 3G** throttling in Chrome DevTools Network tab.
- When transitioning to `/projects`, `/contact`, or `/tasks`, the themed `<Suspense>` fallback with rotating accent spinner and `"Loading page..."` text is smoothly rendered while the chunk downloads over the simulated connection.
- Upon chunk resolution, the fallback seamlessly unmounts and the page renders without visual flicker.

---

## React DevTools Profiler
- **Observation**: Profiled tab transitions and state changes across the portfolio and tasks manager.
- **Finding**: In `Projects.jsx`, sorting and filtering logic is memoized with `useMemo` (`languages` and `processedRepos`). When the search query or sort order changes, child items render cleanly without unnecessary recalculation of unchanged filters.
- **Theme Switch Re-render**: Toggling dark/light mode triggers a re-render of `App` to synchronize the CSS class on `document.documentElement` and persist preference to `localStorage`, which is intentional and performant.

---

## Result
- **Performance**: Initial JavaScript bundle size reduced by **25.91 kB (9.7%)**, and initial CSS reduced by **9.31 kB (35.1%)**.
- **User Experience**: Page loads faster on first visit, and page transitions are visually guided by themed Suspense loading indicators.
- **Functionality Preserved**: 100% of existing Practical 4–7 features (JWT Auth, Task CRUD, GitHub explorer, dark/light theme, interactive contact form) remain fully operational without breaking changes or regression.

---

## Screenshots & Submission Evidence Checklist
The following screenshots demonstrate Practical 8 completion:

1. **[Screenshot 1] Baseline Build Output**: Terminal showing baseline `npm run build` with single monolithic `index-*.js` bundle.
2. **[Screenshot 2] Baseline Network Tab**: DevTools Network tab showing initial download of the un-split bundle.
3. **[Screenshot 3] Lazy-Loading Code**: Code snippet of `App.jsx` showing `React.lazy()` and `<Suspense>` implementation.
4. **[Screenshot 4] Post-Build Separate Chunks**: Terminal showing `npm run build` output with distinct `Projects-*.js`, `Contact-*.js`, `Tasks-*.js`, `AuthForm-*.js` chunks.
5. **[Screenshot 5] Network Tab Lazy Chunk Request**: DevTools Network tab showing `Projects-*.js` loading on-demand upon clicking "Projects".
6. **[Screenshot 6] Slow 3G Suspense Fallback**: Browser showing the styled spinner and `"Loading page..."` fallback during Slow 3G throttling.
7. **[Screenshot 7] Final Working Projects Page**: GitHub profile and repo explorer loaded successfully at `/projects/HARSHIL3431`.
8. **[Screenshot 8] Final Working Contact Page**: Contact form with live message preview and character count functioning.
