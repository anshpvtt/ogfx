'use client';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts';

interface DataPoint {
  label: string;
  pnl: number;
  equity: number;
}

interface Props {
  data: DataPoint[];
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="custom-tooltip">
      <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem', marginBottom: 4 }}>{label}</div>
      {payload.map((p: any, i: number) => (
        <div key={i} style={{ color: p.color, fontWeight: 600 }}>
          {p.name}: {p.value >= 0 ? '+' : ''}{p.value.toFixed(2)}
        </div>
      ))}
    </div>
  );
}

export default function EquityChart({ data }: Props) {
  if (!data.length) return (
    <div className="empty-state">
      <div className="empty-icon">Chart</div>
      <div className="empty-title">No equity data yet</div>
      <div className="empty-sub">Trades will appear here as they execute</div>
    </div>
  );

  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
        <defs>
          <linearGradient id="pnl-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor="#10d989" stopOpacity={0.25} />
            <stop offset="95%" stopColor="#10d989" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis
          dataKey="label"
          tick={{ fill: '#475569', fontSize: 11, fontFamily: 'JetBrains Mono' }}
          axisLine={false} tickLine={false}
        />
        <YAxis
          tick={{ fill: '#475569', fontSize: 11, fontFamily: 'JetBrains Mono' }}
          axisLine={false} tickLine={false}
        />
        <Tooltip content={<CustomTooltip />} />
        <Area
          type="monotone"
          dataKey="pnl"
          name="PnL"
          stroke="#10d989"
          strokeWidth={2}
          fill="url(#pnl-grad)"
          dot={false}
          activeDot={{ r: 4, fill: '#10d989', stroke: '#080c14', strokeWidth: 2 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
