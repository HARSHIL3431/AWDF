/**
 * Toolbar — Search bar with language filter and sort dropdown.
 */
function Toolbar({
  searchTerm,
  onSearchChange,
  languages,
  languageFilter,
  onLanguageChange,
  sortBy,
  onSortChange,
  resultCount,
  totalCount,
}) {
  return (
    <div className="toolbar" role="toolbar" aria-label="Repository filters">
      <div className="search-bar">
        <svg className="search-bar__icon" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <path d="M10.68 11.74a6 6 0 01-7.922-8.982 6 6 0 018.982 7.922l3.04 3.04a.749.749 0 01-.326 1.275.749.749 0 01-.734-.215l-3.04-3.04zM11.5 7a4.499 4.499 0 10-8.997 0A4.499 4.499 0 0011.5 7z" />
        </svg>
        <input
          type="text"
          className="search-bar__input"
          placeholder="Search repositories..."
          value={searchTerm}
          onChange={(e) => onSearchChange(e.target.value)}
          aria-label="Search repositories"
        />
      </div>

      <select
        className="toolbar__select"
        value={languageFilter}
        onChange={(e) => onLanguageChange(e.target.value)}
        aria-label="Filter by language"
      >
        <option value="">All Languages</option>
        {languages.map((lang) => (
          <option key={lang} value={lang}>{lang}</option>
        ))}
      </select>

      <select
        className="toolbar__select"
        value={sortBy}
        onChange={(e) => onSortChange(e.target.value)}
        aria-label="Sort repositories"
      >
        <option value="newest">Newest</option>
        <option value="oldest">Oldest</option>
        <option value="stars">Stars</option>
        <option value="alpha">Alphabetical</option>
      </select>

      <span className="toolbar__count" aria-live="polite">
        {resultCount} of {totalCount} repositories
      </span>
    </div>
  );
}

export default Toolbar;
