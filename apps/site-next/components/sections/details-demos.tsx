import styles from './details.module.css';

// The prototype's per-bar delays (prototype.html:479).
const WAVE_DELAYS = [-0.1, -0.5, -0.3, -0.8, -0.2, -0.6, -0.4, -0.9, -0.15, -0.7, -0.35, -0.55];

function LockIcon() {
  return (
    <svg
      style={{ marginLeft: 6 }}
      width={12}
      height={12}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      role="img"
      aria-label="Private"
    >
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="#d4d4d4"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 4v11" />
      <path d="M7 10l5 5 5-5" />
      <path d="M5 20h14" />
    </svg>
  );
}

export function TopicsDemo() {
  return (
    <div className={styles.demo}>
      <div className={`${styles.topic} ${styles.topicOn}`}>
        <span className={styles.hash}>#</span>General
        <span className={styles.ai} role="img" aria-label="An AI is working" />
      </div>
      <div className={styles.topic}>
        <span className={styles.hash}>#</span>Trip to Lisbon
      </div>
      <div className={styles.topic}>
        <span className={styles.hash}>#</span>Budget
        <LockIcon />
      </div>
    </div>
  );
}

export function VoiceDemo() {
  return (
    <div className={styles.demo}>
      <div className={styles.wave} aria-hidden="true">
        {WAVE_DELAYS.map((delay, index) => (
          <i key={index} style={{ animationDelay: `${delay}s` }} />
        ))}
      </div>
      <span className={styles.typed}>Dinner at nine, I'll bring the wine</span>
    </div>
  );
}

export function SearchDemo() {
  return (
    <div className={styles.demo}>
      <div className={styles.search}>
        <SearchIcon />
        <span className={styles.query}>dinr frday</span>
      </div>
      <div className={styles.hit}>
        <mark>Dinner</mark> on <mark>Friday</mark>?{' '}
        <span className="mono" style={{ color: 'var(--subtle)', fontSize: 11 }}>
          · Friends
        </span>
      </div>
    </div>
  );
}

export function StickerDemo() {
  return (
    <div className={styles.demo}>
      <div className={styles.sticker} aria-hidden="true" />
    </div>
  );
}

export function LimitDemo() {
  return (
    <div className={styles.demo}>
      <div className={styles.meterRow}>
        <span>Deepseek today</span>
        <span>$5.00 limit</span>
      </div>
      <div className={styles.meter}>
        <i className={styles.meterFill} />
      </div>
      <div className={styles.meterRow}>
        <span>checked before every call</span>
        <span className={styles.stopped}>stopped</span>
      </div>
    </div>
  );
}

export function KillSwitchDemo() {
  return (
    <div className={styles.demo}>
      <div className={styles.sw}>
        <div className={styles.swTrack} aria-hidden="true">
          <i className={styles.swKnob} />
        </div>
        <div className={styles.swLabel}>
          <span className={styles.swRun}>running</span>
          <span className={styles.swStop}>stopped</span>
        </div>
      </div>
      <span className={styles.drop}>replies dropped · actions refused · routines refused</span>
    </div>
  );
}

export function AuditDemo() {
  return (
    <div className={styles.demo}>
      <div className={styles.log}>
        <span>approval.requested · req 1a32</span>
        <span>approval.approved · req 1a32</span>
        <span>UPDATE audit_log → refused</span>
      </div>
    </div>
  );
}

export function UpdaterDemo() {
  return (
    <div className={styles.demo}>
      <div className={styles.upd}>
        <span className={styles.tile} aria-hidden="true">
          <DownloadIcon />
        </span>
        <span>
          <b>Zilar 0.2.5 is ready</b>
          <small>0.2.4 → 0.2.5 · 67 MB</small>
        </span>
      </div>
      <div className={styles.meter}>
        <i className={styles.meterFill} />
      </div>
      <span
        className={`key key-primary ${styles.installKey}`}
        style={{ height: 30, padding: '0 12px', fontSize: 12, borderRadius: 8 }}
      >
        Install
      </span>
    </div>
  );
}
