import { SECTION } from '@/lib/sections';

export function Computer() {
  return (
    <section id={SECTION.computer} className="computer" aria-label="AI computers">
      <div className="wrap computer-in">
        <h2 className="display">Its own computer.</h2>
      </div>
    </section>
  );
}
