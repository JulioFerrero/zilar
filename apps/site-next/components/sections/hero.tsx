import { SECTION } from '@/lib/sections';

export function Hero() {
  return (
    <section id={SECTION.hero} className="hero" aria-label="Zilar">
      <div className="wrap hero-grid">
        <h1 className="display">Your friends and your AIs, in one chat.</h1>
      </div>
    </section>
  );
}
