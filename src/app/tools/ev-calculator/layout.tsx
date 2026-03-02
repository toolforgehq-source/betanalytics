import { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Expected Value (EV) Calculator | Sports Betting - BetAnalytics.ai',
  description: 'Free expected value calculator for sports betting. Calculate EV, edge percentage, and Kelly Criterion stake sizing for any bet. No signup required.',
  alternates: {
    canonical: '/tools/ev-calculator',
  },
  openGraph: {
    title: 'Free Expected Value (EV) Calculator',
    description: 'Calculate expected value, edge, and optimal Kelly stake for any sports bet.',
    url: 'https://betanalytics.ai/tools/ev-calculator',
    type: 'website',
  },
}

export default function EVCalculatorLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
