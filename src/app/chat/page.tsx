import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { checkSubscription, checkTermsAccepted } from "@/lib/subscription"
import ChatPageClient from "./ChatPageClient"

// Force dynamic rendering to prevent caching issues with auth
export const dynamic = "force-dynamic"

export default async function ChatPage() {
  const session = await auth()
  
  if (!session?.user) {
    redirect("/login")
  }

  const subStatus = await checkSubscription()
  const termsAccepted = await checkTermsAccepted()

  return (
    <ChatPageClient 
      isSubscribed={subStatus.isSubscribed}
      questionsRemaining={subStatus.questionsRemaining}
      termsAccepted={termsAccepted}
    />
  )
}
