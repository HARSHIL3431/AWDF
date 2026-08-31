import { useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useGitHubData } from '../hooks/useGitHubData';
import { getUniqueLanguages, sortRepos, filterRepos } from '../utils/githubUtils';
import GitHubProfile from '../components/Projects/GitHubProfile';
import StatsSection from '../components/Projects/StatsSection';
import Toolbar from '../components/Projects/Toolbar';
import RepositoryList from '../components/Projects/RepositoryList';
import LoadingSkeleton from '../components/Projects/LoadingSkeleton';
import ErrorState from '../components/Projects/ErrorState';
import EmptyState from '../components/Projects/EmptyState';
import '../styles/Projects.css';

/**
 * ProjectsPage — Main composition root for the GitHub portfolio viewer.
 * Reads the username from the URL, fetches data via the custom hook,
 * and composes all child components.
 */
function ProjectsPage() {
  const { username } = useParams();
  const { profile, repos, loading, error, retry } = useGitHubData(username);

  const [searchTerm, setSearchTerm] = useState('');
  const [languageFilter, setLanguageFilter] = useState('');
  const [sortBy, setSortBy] = useState('newest');

  const languages = useMemo(() => getUniqueLanguages(repos), [repos]);

  const processedRepos = useMemo(() => {
    const filtered = filterRepos(repos, searchTerm, languageFilter);
    return sortRepos(filtered, sortBy);
  }, [repos, searchTerm, languageFilter, sortBy]);

  // Loading state → skeleton loaders
  if (loading) {
    return <LoadingSkeleton />;
  }

  // Error state → friendly message + retry
  if (error) {
    return (
      <div className="projects-page">
        <ErrorState error={error} onRetry={retry} />
      </div>
    );
  }

  // No repos at all (before any filtering)
  const hasRepos = repos.length > 0;

  return (
    <div className="projects-page">
      {/* Profile Hero */}
      {profile && <GitHubProfile profile={profile} username={username} />}

      {/* Statistics */}
      {profile && <StatsSection profile={profile} repos={repos} />}

      {/* Toolbar (only if there are repos to filter) */}
      {hasRepos && (
        <Toolbar
          searchTerm={searchTerm}
          onSearchChange={setSearchTerm}
          languages={languages}
          languageFilter={languageFilter}
          onLanguageChange={setLanguageFilter}
          sortBy={sortBy}
          onSortChange={setSortBy}
          resultCount={processedRepos.length}
          totalCount={repos.length}
        />
      )}

      {/* Repository List or Empty States */}
      {!hasRepos ? (
        <EmptyState type="no_repos" />
      ) : processedRepos.length === 0 ? (
        <EmptyState type="no_results" />
      ) : (
        <RepositoryList repos={processedRepos} />
      )}
    </div>
  );
}

export default ProjectsPage;
