const foundationItems = [
  ['Local-first', 'Projects and media remain on this machine.'],
  ['Codex operator', 'Research and writing flow through versioned artifacts.'],
  ['Human gates', 'Creative decisions stay explicit and reviewable.'],
  ['Remotion-ready', 'The render core will consume validated scene data.'],
] as const;

export const App = () => (
  <main className="shell">
    <header className="hero">
      <p className="eyebrow">NARRA STUDIO · FOUNDATION</p>
      <h1>From question to documentary.</h1>
      <p className="intro">
        A local production workspace for sourced research, deliberate storytelling,
        and recoverable video rendering.
      </p>
    </header>

    <section className="status" aria-labelledby="foundation-title">
      <div>
        <p className="label">CURRENT STAGE</p>
        <h2 id="foundation-title">Foundation contract</h2>
      </div>
      <span className="badge">PHASE 0</span>
    </section>

    <section className="grid" aria-label="Foundation principles">
      {foundationItems.map(([title, description]) => (
        <article className="card" key={title}>
          <h3>{title}</h3>
          <p>{description}</p>
        </article>
      ))}
    </section>

    <footer>
      <span>GPT-5.6 Sol · Medium</span>
      <span>Local artifact contract v1</span>
    </footer>
  </main>
);

