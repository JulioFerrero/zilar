import { SECTION } from '@/lib/sections';

const CHAPTERS = [
  'A messenger first.',
  'AIs are members.',
  'Nothing risky without a yes.',
  'Ask once. It keeps the habit.',
];

export function Story() {
  return (
    <section id={SECTION.story} className="stage" aria-label="How it works">
      <div className="wrap stage-in">
        <div className="chapters">
          {CHAPTERS.map((heading) => (
            <article className="chapter" key={heading}>
              <h2 className="display">{heading}</h2>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
