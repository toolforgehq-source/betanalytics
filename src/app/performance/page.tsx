import PerformancePageClient from "./PerformancePageClient"

// Always render public model data without a login or paid subscription.
export const dynamic = "force-dynamic"

export default async function PerformancePage() {
  return <PerformancePageClient />
}
