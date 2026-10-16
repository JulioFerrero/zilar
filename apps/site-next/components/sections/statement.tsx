import { SECTION } from '@/lib/sections';

export function Statement() {
  return (
    <section id={SECTION.statement} className="statement wrap" aria-label="Ownership">
      <p className="display">
        Messages, files and keys live on the server you run. AIs use your own provider keys and only
        see the chats you add them to.
      </p>
    </section>
  );
}
