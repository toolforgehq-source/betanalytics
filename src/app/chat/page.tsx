import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { checkSubscription, checkTermsAccepted } from "@/lib/subscription"
import ChatPageClient from "./ChatPageClient"

// Force dynamic rendering to prevent caching issues with auth
export const dynamic = "force-dynamic"

export default async function ChatPage({ searchParams }: { searchParams: Promise<{ success?: string; session_id?: string }> }) {
  const session = await auth()
  
  if (!session?.user) {
    redirect("/login")
  }

  const params = await searchParams
  const isPostCheckout = params.success === 'true' && !!params.session_id

  const subStatus = await checkSubscription()
  const termsAccepted = await checkTermsAccepted()

  return (
    <ChatPageClient 
      isSubscribed={subStatus.isSubscribed}
      questionsRemaining={subStatus.questionsRemaining}
      trialDaysRemaining={subStatus.trialDaysRemaining}
      termsAccepted={termsAccepted}
      checkoutSessionId={isPostCheckout && !subStatus.isSubscribed ? params.session_id : undefined}
    />
  )
}
