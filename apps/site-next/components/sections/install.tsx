import { SECTION } from '@/lib/sections';

export function Install() {
  return (
    <section id={SECTION.install} className="install" aria-label="Run your own">
      <div className="wrap install-in">
        <h2 className="display">One line. Your server.</h2>
      </div>
    </section>
  );
}
