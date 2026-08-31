import { getTotalStars, getUniqueLanguages } from '../../utils/githubUtils';

/**
 * StatsSection — Compact horizontal stats row showing key GitHub metrics.
 */
function StatsSection({ profile, repos }) {
  const totalStars = getTotalStars(repos);
  const languages = getUniqueLanguages(repos);

  const stats = [
    { label: 'Repositories', value: profile.public_repos ?? 0 },
    { label: 'Followers', value: profile.followers ?? 0 },
    { label: 'Following', value: profile.following ?? 0 },
    { label: 'Total Stars', value: totalStars },
    { label: 'Languages', value: languages.length },
  ];

  return (
    <section className="stats-row" aria-label="GitHub statistics">
      {stats.map((stat) => (
        <div className="stat-card" key={stat.label}>
          <span className="stat-card__value">{stat.value.toLocaleString()}</span>
          <span className="stat-card__label">{stat.label}</span>
        </div>
      ))}
    </section>
  );
}

export default StatsSection;
