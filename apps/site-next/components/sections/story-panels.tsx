import styles from './story.module.css';

// The prototype builds these bars from a fixed height array (prototype.html:551).
const WAVE_BARS = [6, 14, 9, 18, 22, 12, 16, 8, 20, 11, 6, 15, 19, 9, 13, 7, 17, 10, 5, 12];

const FRIENDS_ORB = 'radial-gradient(circle at 35% 30%, #fde68a, #b45309 55%, #2b1404)';
const GROUP_ORB = 'radial-gradient(circle at 35% 30%, #fde68a, #ea580c 55%, #431407)';

function Head({ label, title, orb }: { label?: string; title: string; orb: string }) {
  return (
    <div className={styles.phHead}>
      <span className={styles.phOrb} style={{ background: orb }} />
      <span className={styles.phTitle}>
        {label === undefined ? null : <small>{label}</small>}
        <b>{title}</b>
        <span>4 members, 3 online</span>
      </span>
    </div>
  );
}

function GreenCheck() {
  return (
    <svg
      className={styles.ck}
      viewBox="0 0 24 24"
      fill="none"
      stroke="#22c55e"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12l5 5 9-10" />
    </svg>
  );
}

function RepeatIcon({ className, size }: { className?: string | undefined; size?: number }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M17 2l4 4-4 4" />
      <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
      <path d="M7 22l-4-4 4-4" />
      <path d="M21 13v1a4 4 0 0 1-4 4H3" />
    </svg>
  );
}

function PricesRow({ animated = false }: { animated?: boolean }) {
  const tick = animated ? { 'data-tick': '' } : {};
  const valueClass = animated ? `${styles.v} ${styles.tick}` : styles.v;
  return (
    <span className={styles.tbl}>
      <span>BTC</span>
      <span className={valueClass} {...tick}>
        $82,302
      </span>
      <span>Gold</span>
      <span className={valueClass} {...tick}>
        $4,152
      </span>
      <span>S&P 500</span>
      <span className={valueClass} {...tick}>
        7,744
      </span>
    </span>
  );
}

export function FriendsPanel() {
  return (
    <div className={styles.panel} data-panel>
      <Head title="Friends" orb={FRIENDS_ORB} />
      <div className={styles.phBody}>
        <span className={styles.who} style={{ color: '#93c5fd' }}>
          Ane
        </span>
        <div className={`${styles.b} ${styles.bIn}`} data-bubble>
          Dinner on Friday? <span className={styles.t}>19:02</span>
        </div>
        <span className={styles.who} data-bubble style={{ color: '#fca5a5' }}>
          Mikel
        </span>
        <div className={`${styles.b} ${styles.bIn}`} data-bubble>
          In. Somewhere near the river <span className={styles.t}>19:03</span>
        </div>
        <div className={`${styles.b} ${styles.bOut}`} data-bubble>
          Booking a table for four <span className={styles.t}>19:05</span>
        </div>
        <span className={styles.react} data-bubble>
          +1 · 3
        </span>
        <span className={styles.who} data-bubble style={{ color: '#93c5fd' }}>
          Ane
        </span>
        <div className={`${styles.b} ${styles.bIn}`} data-bubble>
          <span className={styles.voice}>
            <span className={styles.play} aria-hidden="true">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" />
              </svg>
            </span>
            <span className={styles.wave}>
              {WAVE_BARS.map((height, index) => (
                <i key={index} style={{ height }} />
              ))}
            </span>
            <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>
              0:07
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}

export function WorkPanel() {
  return (
    <div className={styles.panel} data-panel>
      <Head label="ai test" title="General" orb={GROUP_ORB} />
      <div className={styles.phBody}>
        <div className={`${styles.b} ${styles.bOut}`} data-bubble>
          @Deepseek post BTC, gold and the S&P 500 every 5 minutes{' '}
          <span className={styles.t}>09:00</span>
        </div>
        <span className={styles.who} data-bubble style={{ color: '#c4b5fd' }}>
          Deepseek
        </span>
        <div className={styles.card} data-bubble>
          <div className={styles.cardRow}>
            <GreenCheck />
            <b>Check the prices</b>
            <span className={styles.meta}>0:06</span>
          </div>
          <div className={styles.stp} data-step>
            <span className={`${styles.dot} ${styles.dotOk}`} />
            Looking up prices
          </div>
          <div className={styles.stp} data-step>
            <span className={`${styles.dot} ${styles.dotOk}`} />
            Saving the tool
          </div>
          <div className={styles.stp} data-step>
            <span className={`${styles.dot} ${styles.dotSpin}`} />
            Scheduling the routine
          </div>
        </div>
        <div className={`${styles.b} ${styles.bIn}`} data-bubble>
          Here's the first one.
          <PricesRow />
          <span className={styles.t}>09:00</span>
        </div>
      </div>
    </div>
  );
}

export function ApprovalPanel() {
  return (
    <div className={styles.panel} data-panel>
      <Head label="ai test" title="General" orb={GROUP_ORB} />
      <div className={styles.phBody}>
        <span className={styles.who} style={{ color: '#c4b5fd' }}>
          Deepseek
        </span>
        <div className={`${styles.card} ${styles.askCard}`} data-ask>
          <small>Deepseek asks</small>
          <div className={styles.cardRow}>
            <RepeatIcon className={styles.ck} />
            <b>Prices</b>
            <span className={styles.meta}>every 5 min</span>
          </div>
          <div className={styles.btns}>
            <span className="key key-dark">Deny</span>
            <span className="key key-primary" data-allow>
              Allow
            </span>
          </div>
        </div>
        <div className={`${styles.card} ${styles.doneLine}`} data-allowed>
          <GreenCheck />
          <span style={{ flex: 1 }}>Prices</span>
          <span className="mono" style={{ fontSize: 11, color: 'var(--subtle)' }}>
            every 5 min
          </span>
        </div>
      </div>
    </div>
  );
}

export function RoutinePanel() {
  return (
    <div className={styles.panel} data-panel>
      <Head label="ai test" title="General" orb={GROUP_ORB} />
      <div className={styles.phBody}>
        <div className={`${styles.card} ${styles.doneLine}`}>
          <GreenCheck />
          <span style={{ flex: 1 }}>Prices</span>
          <span className="mono" style={{ fontSize: 11, color: 'var(--subtle)' }}>
            every 5 min
          </span>
        </div>
        <span className={styles.who} style={{ color: '#c4b5fd' }}>
          Deepseek
        </span>
        <div className={`${styles.b} ${styles.bIn}`} style={{ maxWidth: '88%' }}>
          <span className={styles.rhead}>
            <RepeatIcon size={13} />
            Prices
            <span className={styles.rheadMeta}>every 5 min</span>
          </span>
          <PricesRow animated />
          <span className={styles.edited} data-edited>
            edited 09:00
          </span>
        </div>
      </div>
    </div>
  );
}
