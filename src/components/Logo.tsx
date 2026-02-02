'use client'

import Image from 'next/image'

interface LogoProps {
  size?: 'sm' | 'md' | 'lg'
  showTagline?: boolean
}

export default function Logo({ size = 'md', showTagline = true }: LogoProps) {
  const sizes = {
    sm: { icon: 56, text: 'text-xl', tagline: 'text-xs' },
    md: { icon: 64, text: 'text-2xl', tagline: 'text-sm' },
    lg: { icon: 80, text: 'text-4xl', tagline: 'text-lg' },
  }

  const s = sizes[size]

  return (
    <div className="flex items-center gap-3">
      <Image
        src="/logo.png"
        alt="BetAnalytics.ai Logo"
        width={s.icon}
        height={s.icon}
        className="rounded-lg"
      />
      <div>
        <h1 className={`${s.text} font-bold bg-gradient-to-r from-blue-400 to-cyan-300 bg-clip-text text-transparent`}>
          BetAnalytics.ai
        </h1>
        {showTagline && (
          <p className={`${s.tagline} text-slate-400`}>Elo-Powered Sports Betting Intelligence</p>
        )}
      </div>
    </div>
  )
}
