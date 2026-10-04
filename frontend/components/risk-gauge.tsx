'use client'

export function RiskScoreGauge({ score = 12, label = "Low Risk" }: { score?: number; label?: string }) {
  // Score range 0..100
  const radius = 46
  const strokeWidth = 7
  const normalizedRadius = radius - strokeWidth * 0.5
  const circumference = normalizedRadius * 2 * Math.PI
  // Show 270 degree arc (75% of circumference)
  const arcLength = circumference * 0.75
  const strokeDashoffset = arcLength - (score / 100) * arcLength

  const color = score > 75 ? '#ef4444' : score > 50 ? '#f97316' : score > 25 ? '#f59e0b' : '#10b981'

  return (
    <div className="relative flex flex-col items-center justify-center py-1 flex-shrink-0" role="meter" aria-valuenow={score} aria-valuemin={0} aria-valuemax={100} aria-label={`Risk score: ${score} out of 100, ${label}`}>
      <svg height={radius * 2} width={radius * 2} className="rotate-[135deg]">
        {/* Background track */}
        <circle
          stroke="rgba(148, 163, 184, 0.06)"
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
        />
      </svg>
      {/* Center score readout */}
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="font-mono text-xl font-bold tracking-tight text-white">{score}</span>
        <span className="text-[9px] font-mono text-slate-500">/100</span>
        <span className="mt-0.5 text-[10px] font-medium" style={{ color }}>{label}</span>
      </div>
    </div>
  )
}
