import { requireAccess } from "@/lib/require-access"
import PicksPageClient from "./PicksPageClient"

// Force dynamic rendering to prevent caching issues with auth
export const dynamic = "force-dynamic"

export default async function PicksPage() {
  await requireAccess()
  return <PicksPageClient />
}
