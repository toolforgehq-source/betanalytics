import { auth } from "@/auth"
import { db } from "@/db"

export async function checkSubscription() {
  const session = await auth()
  
  if (!session?.user?.id) {
    return {
      isSubscribed: false,
      isFreeTrialAvailable: false,
      questionsRemaining: 0,
    }
  }

  const sub = await db.subscriptions.findByUserId(session.user.id)

  if (sub && sub.status === 'active') {
    return {
      isSubscribed: true,
      isFreeTrialAvailable: false,
      questionsRemaining: -1, // -1 means unlimited (Infinity is not JSON-serializable)
    }
  }

  const user = await db.users.findById(session.user.id)
  const questionsUsed = user?.questionCount || 0
  const questionsRemaining = Math.max(0, 3 - questionsUsed)

  return {
    isSubscribed: false,
    isFreeTrialAvailable: questionsRemaining > 0,
    questionsRemaining,
  }
}

export async function checkTermsAccepted() {
  const session = await auth()
  
  if (!session?.user?.id) {
    return false
  }

  const user = await db.users.findById(session.user.id)
  return user?.termsAcceptedAt !== null
}
