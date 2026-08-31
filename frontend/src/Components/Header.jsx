function Header({ name, role }) {
  const [firstName, ...rest] = name.split(' ');
  return (
    <header className="home-header">
      <span className="home-header__kicker">/ creative web developer</span>
      <h1 className="home-header__name">
        {firstName} <span className="uighl">{rest.join(' ')}</span>
        <span className="home-header__asterisk" aria-hidden="true">*</span>
      </h1>
      <p className="home-header__role">
        {role.split('|')[0].trim()} <em>|</em> {role.split('|')[1]?.trim()}
      </p>
    </header>
  );
}

export default Header;
