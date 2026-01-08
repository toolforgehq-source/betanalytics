import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { checkSubscription } from "@/lib/subscription"
import AccountPageClient from "./AccountPageClient"

// Force dynamic rendering to prevent caching issues with auth
export const dynamic = "force-dynamic"

export default async function AccountPage() {
  const session = await auth()
  
  if (!session?.user) {
    redirect("/login")
  }

  const subStatus = await checkSubscription()

  return (
    <AccountPageClient 
      user={{
        email: session.user.email || '',
        name: session.user.name || '',
      }}
      isSubscribed={subStatus.isSubscribed}
      questionsRemaining={subStatus.questionsRemaining}
    />
  )
}
