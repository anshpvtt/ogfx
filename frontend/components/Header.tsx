'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const links = [
  { href: '/',            label: 'Dashboard',   icon: '⬛' },
  { href: '/signals',     label: 'Signals',     icon: '📡' },
  { href: '/trades',      label: 'Trades',      icon: '📋' },
  { href: '/strategies',  label: 'Strategies',  icon: '🧠' },
];

export default function Header() {
  const pathname = usePathname();
  return (
    <>
      {/* Ticker bar */}
      <div className="ticker-bar">
        <div className="ticker-track">
          {[
            { sym: 'EURUSD', price: '1.08432', change: '+0.12%', up: true },
            { sym: 'GBPUSD', price: '1.26781', change: '-0.08%', up: false },
            { sym: 'XAUUSD', price: '2341.50', change: '+0.54%', up: true },
            { sym: 'BTCUSDT', price: '68,240.0', change: '+1.23%', up: true },
            { sym: 'EURUSD', price: '1.08432', change: '+0.12%', up: true },
            { sym: 'GBPUSD', price: '1.26781', change: '-0.08%', up: false },
            { sym: 'XAUUSD', price: '2341.50', change: '+0.54%', up: true },
            { sym: 'BTCUSDT', price: '68,240.0', change: '+1.23%', up: true },
          ].map((item, i) => (
            <div key={i} className="ticker-item">
              <span className="ticker-sym">{item.sym}</span>
              <span className="ticker-price">{item.price}</span>
              <span className={`ticker-change ${item.up ? 'up' : 'down'}`}>
                {item.change}
              </span>
              <span style={{ color: 'var(--border)', fontSize: '0.6rem' }}>|</span>
            </div>
          ))}
        </div>
      </div>

      {/* Main nav */}
      <nav className="nav">
        <div className="nav-inner">
          {/* Logo */}
          <Link href="/" className="nav-logo">
            <div className="nav-logo-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M2 16L8 10L12 14L22 4" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M16 4H22V10" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <span className="nav-logo-text">OGFX</span>
          </Link>

          {/* Links */}
          <ul className="nav-links">
            {links.map((l) => (
              <li key={l.href}>
                <Link
                  href={l.href}
                  className={`nav-link ${pathname === l.href ? 'active' : ''}`}
                >
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>

          {/* Status */}
          <div className="nav-status">
            <div className="live-badge">
              <div className="live-dot" />
              LIVE
            </div>
          </div>
        </div>
      </nav>
    </>
  );
}
