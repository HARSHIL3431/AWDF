function About({ title, description }) {
  return (
    <section className="section-card about-block">
      <span className="about-block__tag">about</span>
      <h2>{title}</h2>
      <p className="muted about-block__desc">{description}</p>
    </section>
  );
}

export default About;
