import PicksPageClient from "./PicksPageClient"

// Always render public model data without a login or paid subscription.
export const dynamic = "force-dynamic"

export default async function PicksPage() {
  return <PicksPageClient />
}
