export function Header() {
  return (
    <header className="top">
      <div className="wrap top-in">
        <a className="brand" href="#top" aria-label="Zilar, back to top">
          <svg width="26" height="26" viewBox="-60 -60 120 120" aria-hidden="true">
            <defs>
              <radialGradient id="mgp" cx="35%" cy="30%" r="75%">
                <stop offset="0" stopColor="#fff" />
                <stop offset=".4" stopColor="#a8a8a8" />
                <stop offset="1" stopColor="#1a1a1a" />
              </radialGradient>
            </defs>
            <g transform="rotate(-30)">
              <path d="M -50 0 A 50 15 0 0 1 50 0" fill="none" stroke="#bdbdbd" strokeWidth="6" />
              <circle r="24" fill="url(#mgp)" />
              <path d="M 50 0 A 50 15 0 0 1 -50 0" fill="none" stroke="#e6e6e6" strokeWidth="6" />
              <circle cx="40" cy="-9" r="10" fill="#f0b445" />
            </g>
          </svg>
          Zilar
        </a>
        <nav className="nav" aria-label="Main">
          <a className="link" href="#chat">
            How it works
          </a>
          <a className="link" href="#computer">
            AI computers
          </a>
          <a className="link" href="#install">
            Run your own
          </a>
          <a className="link" href="https://github.com/JulioFerrero/zilar">
            GitHub
          </a>
          <a
            className="key key-primary"
            href="https://github.com/JulioFerrero/zilar/releases/latest"
          >
            Get the app
          </a>
        </nav>
      </div>
      <div className="progress" id="progress" />
    </header>
  );
}
