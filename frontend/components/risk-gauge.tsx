'use client'

export function RiskScoreGauge({ score = 12, label = "Low Risk" }: { score?: number; label?: string }) {
  // Score range 0..100
  const radius = 54
  const strokeWidth = 10
  const normalizedRadius = radius - strokeWidth * 0.5
  const circumference = normalizedRadius * 2 * Math.PI
  // Show 270 degree arc (75% of circumference)
  const arcLength = circumference * 0.75
  const strokeDashoffset = arcLength - (score / 100) * arcLength

  const color = score > 50 ? '#f43f5e' : score > 25 ? '#f59e0b' : '#10b981'

  return (
    <div className="relative flex flex-col items-center justify-center py-2">
      <svg height={radius * 2} width={radius * 2} className="rotate-[135deg]">
        {/* Background track */}
        <circle
          stroke="rgba(255, 255, 255, 0.08)"
          fill="transparent"
          strokeWidth={strokeWidth}
          strokeDasharray={`${arcLength} ${circumference}`}
          r={normalizedRadius}
          cx={radius}
          cy={radius}
          strokeLinecap="round"
        />
        {/* Animated value ring */}
        <circle
          stroke={color}
          fill="transparent"
          strokeWidth={strokeWidth}
          strokeDasharray={`${arcLength} ${circumference}`}
          style={{ strokeDashoffset, transition: 'stroke-dashoffset 0.8s ease-in-out' }}
          r={normalizedRadius}
          cx={radius}
          cy={radius}
          strokeLinecap="round"
          className="drop-shadow-[0_0_10px_rgba(16,185,129,0.5)]"
        />
      </svg>
      {/* Center score readout */}
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="font-mono text-3xl font-bold tracking-tight text-white">{score}</span>
        <span className="mt-0.5 text-[11px] font-semibold tracking-wide" style={{ color }}>{label}</span>
      </div>
    </div>
  )
}
