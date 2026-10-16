import { SECTION } from '@/lib/sections';

export function Details() {
  return (
    <section id={SECTION.details} className="strip" aria-label="Details">
      <div className="wrap strip-head">
        <h2 className="display">The rest is already there.</h2>
      </div>
    </section>
  );
}
