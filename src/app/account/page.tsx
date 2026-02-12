import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { checkSubscription } from "@/lib/subscription"
import { isUserSubscribedToAlerts } from "@/lib/edge-alerts"
import AccountPageClient from "./AccountPageClient"

// Force dynamic rendering to prevent caching issues with auth
export const dynamic = "force-dynamic"

export default async function AccountPage() {
  const session = await auth()
  
  if (!session?.user) {
    redirect("/login")
  }

  const subStatus = await checkSubscription()
  const edgeAlertsEnabled = session.user.id ? await isUserSubscribedToAlerts(session.user.id) : false

  return (
    <AccountPageClient 
      user={{
        email: session.user.email || '',
        name: session.user.name || '',
      }}
      isSubscribed={subStatus.isSubscribed}
      questionsRemaining={subStatus.questionsRemaining}
      edgeAlertsEnabled={edgeAlertsEnabled}
    />
  )
}
