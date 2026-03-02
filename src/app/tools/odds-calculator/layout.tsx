import { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Betting Odds Converter | American, Decimal, Fractional - BetAnalytics.ai',
  description: 'Free betting odds converter. Convert between American, decimal, and fractional odds instantly. See implied probability for any odds format. No signup required.',
  alternates: {
    canonical: '/tools/odds-calculator',
  },
  openGraph: {
    title: 'Free Betting Odds Converter',
    description: 'Convert between American, decimal, and fractional odds instantly. See implied probability for any odds format.',
    url: 'https://betanalytics.ai/tools/odds-calculator',
    type: 'website',
  },
}

export default function OddsCalculatorLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
