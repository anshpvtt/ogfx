'use client';

interface Props {
  confidence: number;
  signal: 'BUY' | 'SELL' | 'SKIP';
  size?: number;
}

export default function ConfidenceGauge({ confidence, signal, size = 52 }: Props) {
  const radius = (size - 6) / 2;
  const circumference = 2 * Math.PI * radius;
  const filled = (confidence / 100) * circumference;

  const color =
    signal === 'BUY'  ? '#10d989' :
    signal === 'SELL' ? '#f43f5e' :
    '#64748b';

  return (
    <div className="confidence-gauge">
      <div className="gauge-ring" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          {/* Track */}
          <circle
            cx={size / 2} cy={size / 2} r={radius}
            fill="none"
            stroke="rgba(255,255,255,0.06)"
            strokeWidth="3"
          />
          {/* Fill */}
          <circle
            cx={size / 2} cy={size / 2} r={radius}
            fill="none"
            stroke={color}
            strokeWidth="3"
            strokeDasharray={`${filled} ${circumference - filled}`}
            strokeLinecap="round"
            style={{ filter: `drop-shadow(0 0 4px ${color}66)`, transition: 'stroke-dasharray 0.6s ease' }}
          />
        </svg>
        <div className="gauge-text" style={{ color }}>
          {confidence}
        </div>
      </div>
      <span className="gauge-label">conf%</span>
    </div>
  );
}
