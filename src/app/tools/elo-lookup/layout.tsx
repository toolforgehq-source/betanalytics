import { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Elo Rating Lookup | Search 800+ Teams - BetAnalytics.ai',
  description: 'Free Elo rating lookup for 800+ teams across NBA, NFL, NHL, MLB, college sports, and soccer. Search any team to see their current Elo rating and tier.',
  alternates: {
    canonical: '/tools/elo-lookup',
  },
  openGraph: {
    title: 'Elo Rating Lookup | 800+ Teams Across All Sports',
    description: 'Search Elo ratings for NBA, NFL, college, and soccer teams. See where every team ranks.',
    url: 'https://betanalytics.ai/tools/elo-lookup',
    type: 'website',
  },
}

export default function EloLookupLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
