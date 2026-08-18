import { useState, useEffect, useCallback } from 'react';

/**
 * Custom hook to fetch a GitHub user's profile and repositories.
 * Accepts username from route params and an optional auth token.
 */
export function useGitHubData(username) {
  const [profile, setProfile] = useState(null);
  const [repos, setRepos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const token = import.meta.env.VITE_GITHUB_TOKEN;

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    setProfile(null);
    setRepos([]);

    try {
      if (!username) {
        throw new Error('NO_USERNAME');
      }

      const headers = token ? { Authorization: `Bearer ${token}` } : {};

      const [profileRes, reposRes] = await Promise.all([
        fetch(`https://api.github.com/users/${username}`, { headers }),
        fetch(`https://api.github.com/users/${username}/repos?per_page=100&sort=updated`, { headers }),
      ]);

      if (profileRes.status === 404 || reposRes.status === 404) {
        throw new Error('USER_NOT_FOUND');
      }

      if (profileRes.status === 403 || reposRes.status === 403) {
        throw new Error('RATE_LIMIT');
      }

      if (!profileRes.ok || !reposRes.ok) {
        throw new Error('FETCH_ERROR');
      }

      const profileData = await profileRes.json();
      const reposData = await reposRes.json();

      const sortedRepos = reposData.sort(
        (a, b) => new Date(b.updated_at) - new Date(a.updated_at)
      );

      setProfile(profileData);
      setRepos(sortedRepos);
    } catch (err) {
      if (err.message === 'RATE_LIMIT') {
        setError({ type: 'rate_limit', message: 'GitHub API rate limit exceeded. Please try again later.' });
      } else if (err.message === 'USER_NOT_FOUND') {
        setError({ type: 'not_found', message: `GitHub user "${username}" was not found.` });
      } else if (err.message === 'NO_USERNAME') {
        setError({ type: 'invalid', message: 'No username provided.' });
      } else {
        setError({ type: 'network', message: 'Failed to fetch data. Please check your connection and try again.' });
      }
    } finally {
      setLoading(false);
    }
  }, [username, token]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchData();
  }, [fetchData]);

  return { profile, repos, loading, error, retry: fetchData };
}
