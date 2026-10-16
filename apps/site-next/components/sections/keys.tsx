import { SECTION } from '@/lib/sections';

export function Keys() {
  return (
    <section id={SECTION.keys} className="keys" aria-label="Your own keys">
      <div className="wrap keys-copy">
        <h2 className="display">Your keys. Your limits.</h2>
      </div>
    </section>
  );
}
