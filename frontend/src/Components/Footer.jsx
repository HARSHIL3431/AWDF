function Footer({ email, copyright }) {
  return (
    <footer className="home-footer">
      <a className="home-footer__mail" href={`mailto:${email}`}>
        <span className="home-footer__arrow" aria-hidden="true">✉</span> {email}
      </a>
      <p className="home-footer__copy">{copyright}</p>
    </footer>
  );
}

export default Footer;
