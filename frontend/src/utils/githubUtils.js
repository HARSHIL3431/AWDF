/**
 * Utility helpers for the Projects page.
 * Keeps business logic out of UI components.
 */

/** Language → color mapping (GitHub-style) */
const LANGUAGE_COLORS = {
  JavaScript: '#f1e05a',
  TypeScript: '#3178c6',
  Python: '#3572A5',
  Java: '#b07219',
  Go: '#00ADD8',
  Rust: '#dea584',
  Ruby: '#701516',
  'C++': '#f34b7d',
  C: '#555555',
  'C#': '#178600',
  PHP: '#4F5D95',
  Swift: '#F05138',
  Kotlin: '#A97BFF',
  Dart: '#00B4AB',
  HTML: '#e34c26',
  CSS: '#563d7c',
  Shell: '#89e051',
  Lua: '#000080',
  Vue: '#41b883',
  Svelte: '#ff3e00',
  Jupyter: '#DA5B0B',
  R: '#198CE7',
};

/**
 * Returns a hex color string for a given language.
 * Falls back to a neutral grey.
 */
export function getLanguageColor(language) {
  if (!language) return '#8b8b8b';
  return LANGUAGE_COLORS[language] || '#8b8b8b';
}

/**
 * Formats an ISO date string into a human-readable relative time.
 * e.g. "3 days ago", "2 months ago"
 */
export function formatRelativeDate(dateString) {
  const date = new Date(dateString);
  const now = new Date();
  const seconds = Math.floor((now - date) / 1000);

  const intervals = [
    { label: 'year', seconds: 31536000 },
    { label: 'month', seconds: 2592000 },
    { label: 'week', seconds: 604800 },
    { label: 'day', seconds: 86400 },
    { label: 'hour', seconds: 3600 },
    { label: 'minute', seconds: 60 },
  ];

  for (const interval of intervals) {
    const count = Math.floor(seconds / interval.seconds);
    if (count >= 1) {
      return `${count} ${interval.label}${count !== 1 ? 's' : ''} ago`;
    }
  }
  return 'just now';
}

/**
 * Calculates the total number of stars across all repositories.
 */
export function getTotalStars(repos) {
  return repos.reduce((sum, repo) => sum + (repo.stargazers_count || 0), 0);
}

/**
 * Extracts unique languages from a list of repositories.
 * Filters out nulls and returns a sorted array.
 */
export function getUniqueLanguages(repos) {
  const languages = new Set(repos.map(r => r.language).filter(Boolean));
  return [...languages].sort();
}

/**
 * Sorts a list of repos based on a sort key.
 * Returns a new array (does not mutate).
 */
export function sortRepos(repos, sortBy) {
  const sorted = [...repos];
  switch (sortBy) {
    case 'newest':
      return sorted.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
    case 'oldest':
      return sorted.sort((a, b) => new Date(a.updated_at) - new Date(b.updated_at));
    case 'stars':
      return sorted.sort((a, b) => b.stargazers_count - a.stargazers_count);
    case 'alpha':
      return sorted.sort((a, b) => a.name.localeCompare(b.name));
    default:
      return sorted;
  }
}

/**
 * Filters repositories by search term (name, description, language)
 * and optionally by language.
 */
export function filterRepos(repos, searchTerm, languageFilter) {
  return repos.filter(repo => {
    const term = searchTerm.toLowerCase();
    const matchesSearch =
      repo.name?.toLowerCase().includes(term) ||
      repo.description?.toLowerCase().includes(term) ||
      repo.language?.toLowerCase().includes(term);

    const matchesLanguage =
      !languageFilter || repo.language === languageFilter;

    return matchesSearch && matchesLanguage;
  });
}
