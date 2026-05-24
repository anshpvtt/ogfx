import { Signal } from '@/lib/api';
import ConfidenceGauge from './ConfidenceGauge';
import { formatDistanceToNow } from 'date-fns';

interface Props {
  signal: Signal;
  compact?: boolean;
}

function fmt(n: number | null | undefined, decimals = 5): string {
  if (n == null) return '—';
  return n.toFixed(decimals);
}

export default function SignalCard({ signal, compact = false }: Props) {
  const isBuy  = signal.signal === 'BUY';
  const isSell = signal.signal === 'SELL';
  const dirClass = isBuy ? 'buy' : isSell ? 'sell' : 'skip';

  const age = (() => {
    try { return formatDistanceToNow(new Date(signal.created_at), { addSuffix: true }); }
    catch { return '—'; }
  })();

  return (
    <div className={`signal-card ${dirClass}`}>
      {/* Direction badge */}
      <div className={`signal-direction ${dirClass}`}>
        {signal.signal}
      </div>

      {/* Info */}
      <div className="signal-info">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="signal-symbol">{signal.symbol}</span>
          <span className={`status-badge ${signal.status}`}>{signal.status}</span>
        </div>
        <div className="signal-strategy">
          {signal.strategy_name ?? 'AI Analysis'} · {age}
        </div>
        {!compact && (
          <div className="signal-reason">{signal.reason}</div>
        )}
        {!compact && signal.key_factors && signal.key_factors.length > 0 && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
            {signal.key_factors.slice(0, 3).map((f, i) => (
              <span key={i} style={{
                fontSize: '0.68rem', padding: '2px 7px',
                background: 'var(--bg-elevated)', borderRadius: '100px',
                color: 'var(--text-muted)',
              }}>{f}</span>
            ))}
          </div>
        )}
      </div>

      {/* Prices */}
      {!compact && (
        <div className="price-group">
          <div className="price-row">
            <span className="price-label">Entry</span>
            <span className="price-val entry">{fmt(signal.entry_price)}</span>
          </div>
          <div className="price-row">
            <span className="price-label">SL</span>
            <span className="price-val sl">{fmt(signal.stop_loss)}</span>
          </div>
          <div className="price-row">
            <span className="price-label">TP</span>
            <span className="price-val tp">{fmt(signal.take_profit)}</span>
          </div>
          {signal.risk_reward && (
            <div className="price-row">
              <span className="price-label">RR</span>
              <span className="price-val" style={{ color: 'var(--accent-bright)' }}>
                1:{signal.risk_reward.toFixed(1)}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Gauge */}
      <ConfidenceGauge confidence={signal.confidence} signal={signal.signal} />
    </div>
  );
}
