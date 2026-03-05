import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { checkSubscription } from "@/lib/subscription"

/**
 * Server-side access check for protected pages.
 * 
 * Flow:
 * 1. Not signed in → redirect to /login
 * 2. Signed in + active subscription → allowed
 * 3. Signed in + in 3-day free trial → allowed
 * 4. Signed in + trial expired + no subscription → redirect to /pricing
 * 
 * Must be called from a server component (not 'use client').
 */
export async function requireAccess() {
  const session = await auth()

  if (!session?.user) {
    redirect("/login")
  }

  const subStatus = await checkSubscription()

  // Allow if subscribed OR in free trial
  if (subStatus.isSubscribed || subStatus.isFreeTrialAvailable) {
    return { session, subStatus }
  }

  // Trial expired, no subscription → pricing page
  redirect("/pricing")
}
