import { requireAccess } from "@/lib/require-access"
import PerformancePageClient from "./PerformancePageClient"

// Force dynamic rendering to prevent caching issues with auth
export const dynamic = "force-dynamic"

export default async function PerformancePage() {
  await requireAccess()
  return <PerformancePageClient />
}
