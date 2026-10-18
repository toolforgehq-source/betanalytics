import DailyTopThreeClient from './DailyTopThreeClient'

export const dynamic = 'force-dynamic'

// One ranked list from immutable, timestamped football model selections.
// It does not require the quota-blocked primary Neon database.
export default function PicksPage() {
  return <DailyTopThreeClient />
}
