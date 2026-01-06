'use client'

import { TrendingUp } from 'lucide-react'

interface LogoProps {
  size?: 'sm' | 'md' | 'lg'
  showTagline?: boolean
}

export default function Logo({ size = 'md', showTagline = true }: LogoProps) {
  const sizes = {
    sm: { icon: 'w-8 h-8', iconInner: 'w-4 h-4', text: 'text-lg', tagline: 'text-xs' },
    md: { icon: 'w-10 h-10', iconInner: 'w-6 h-6', text: 'text-xl', tagline: 'text-xs' },
    lg: { icon: 'w-12 h-12', iconInner: 'w-7 h-7', text: 'text-4xl', tagline: 'text-lg' },
  }

  const s = sizes[size]

  return (
    <div className="flex items-center gap-3">
      <div className={`${s.icon} bg-gradient-to-br from-blue-500 to-cyan-400 rounded-lg flex items-center justify-center`}>
        <TrendingUp className={`${s.iconInner} text-white`} />
      </div>
      <div>
        <h1 className={`${s.text} font-bold bg-gradient-to-r from-blue-400 to-cyan-300 bg-clip-text text-transparent`}>
          Betanalytics.ai
        </h1>
        {showTagline && (
          <p className={`${s.tagline} text-slate-400`}>AI Sports Betting Intelligence</p>
        )}
      </div>
    </div>
  )
}
