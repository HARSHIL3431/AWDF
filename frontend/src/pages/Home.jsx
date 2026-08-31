import Header from '../components/Header';
import About from '../components/About';
import Skills from '../components/Skills';
import Footer from '../components/Footer';

const skills = [
  'HTML',
  'CSS',
  'JavaScript',
  'React',
  'Python',
  'Machine Learning',
];

function Home() {
  return (
    <div className="home-wrap">
      {/* Decorative creative graphics */}
      <span className="deco deco--blob" style={{ top: '-20px', left: '-40px', background: 'rgba(157,77,255,0.55)' }} aria-hidden="true" />
      <span className="deco deco--blob" style={{ top: '120px', right: '-60px', background: 'rgba(55,227,255,0.4)' }} aria-hidden="true" />
      <span className="deco deco--blob" style={{ bottom: '60px', left: '30%', background: 'rgba(215,255,63,0.3)' }} aria-hidden="true" />
      <span className="deco deco--star deco--ring-lime" style={{ top: '40px', right: '18%' }} aria-hidden="true">✦</span>
      <span className="deco deco--star deco--ring-cyan" style={{ top: '200px', left: '4%', fontSize: '14px' }} aria-hidden="true">✺</span>
      <span className="deco deco--circle deco--ring-orange" style={{ top: '340px', right: '8%', width: '26px', height: '26px' }} aria-hidden="true" />
      <span className="deco deco--circle deco--ring-purple" style={{ bottom: '180px', right: '32%', width: '14px', height: '14px' }} aria-hidden="true" />

      <div className="content-layer">
        <Header
          name="Harshil Thakkar"
          role="AI & ML Student | Full Stack Developer"
        />

        <div className="hero-grid">
          <About
            title="About Me"
            description="I am passionate about Artificial Intelligence, Web Development, and creating impactful software solutions."
          />

          <section className="section-card">
            <span className="about-block__tag">ui analysis</span>
            <h2>UI Analysis</h2>
            <p className="muted">
              The portfolio is structured as a reusable layout with separate
              sections for identity, background, skills, and contact details.
            </p>
            <ul className="stack-list">
              <li>Header introduces the student and role.</li>
              <li>About explains the personal summary.</li>
              <li>Skills lists the technical stack.</li>
              <li>Footer carries direct contact information.</li>
            </ul>
          </section>
        </div>

        <Skills skills={skills} />

        <div className="info-grid">
          <section className="section-card">
            <h2>Component Re-rendering</h2>
            <p className="muted">
              React re-renders when props or state change, then updates only the
              affected parts of the UI through the virtual DOM diff.
            </p>
          </section>

          <section className="section-card">
            <h2>Why Reusability Matters</h2>
            <p className="muted">
              Reusable components reduce duplication, make large interfaces easier
              to maintain, and let teams change one piece of UI without breaking
              every page that depends on it.
            </p>
          </section>
        </div>

        <Footer
          email="harshilthakkar3435@gmail.com"
          copyright="© 2026 Harshil Thakkar"
        />
      </div>
    </div>
  );
}

export default Home;
