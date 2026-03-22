import { auth } from "@/auth"
import { db } from "@/db"
import { stripe, isStripeConfigured } from "@/lib/stripe"
import Stripe from "stripe"

async function syncSubscriptionFromStripe(userId: string, email: string): Promise<boolean> {
  if (!isStripeConfigured() || !stripe) return false

  try {
    const customers = await stripe.customers.list({ email: email.toLowerCase(), limit: 1 })
    if (customers.data.length === 0) return false

    const customer = customers.data[0]
    const subscriptions = await stripe.subscriptions.list({
      customer: customer.id,
      status: 'active',
      limit: 1,
    })

    if (subscriptions.data.length === 0) {
      const trialingSubs = await stripe.subscriptions.list({
        customer: customer.id,
        status: 'trialing',
        limit: 1,
      })
      if (trialingSubs.data.length === 0) return false
      subscriptions.data = trialingSubs.data
    }

    const subscription = subscriptions.data[0] as Stripe.Subscription
    const subscriptionItem = subscription.items.data[0]

    const existingSub = await db.subscriptions.findByUserId(userId)
    if (existingSub) {
      await db.subscriptions.update(existingSub.id, {
        stripeCustomerId: customer.id,
        stripeSubscriptionId: subscription.id,
        stripePriceId: subscriptionItem.price.id,
        status: subscription.status,
        currentPeriodStart: new Date(subscriptionItem.current_period_start * 1000).toISOString(),
        currentPeriodEnd: new Date(subscriptionItem.current_period_end * 1000).toISOString(),
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
      })
    } else {
      await db.subscriptions.create({
        userId,
        stripeCustomerId: customer.id,
        stripeSubscriptionId: subscription.id,
        stripePriceId: subscriptionItem.price.id,
        status: subscription.status,
        currentPeriodStart: new Date(subscriptionItem.current_period_start * 1000).toISOString(),
        currentPeriodEnd: new Date(subscriptionItem.current_period_end * 1000).toISOString(),
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
      })
    }

    console.log(`[subscription] Synced subscription from Stripe for user ${userId}, status: ${subscription.status}`)
    return true
  } catch (error) {
    console.error('[subscription] Failed to sync from Stripe:', error)
    return false
  }
}

export async function checkSubscription() {
  const session = await auth()
  
  if (!session?.user?.id) {
    return {
      isSubscribed: false,
      isFreeTrialAvailable: false,
      questionsRemaining: 0,
      trialDaysRemaining: 0,
    }
  }

  try {
    const sub = await db.subscriptions.findByUserId(session.user.id)

    if (sub && (sub.status === 'active' || sub.status === 'trialing')) {
      return {
        isSubscribed: true,
        isFreeTrialAvailable: false,
        questionsRemaining: -1,
        trialDaysRemaining: 0,
      }
    }

    if (session.user.email) {
      const synced = await syncSubscriptionFromStripe(session.user.id, session.user.email)
      if (synced) {
        return {
          isSubscribed: true,
          isFreeTrialAvailable: false,
          questionsRemaining: -1,
          trialDaysRemaining: 0,
        }
      }
    }

    const user = await db.users.findById(session.user.id)
    const createdAt = user?.createdAt ? new Date(user.createdAt) : new Date()
    const now = new Date()
    const trialEndDate = new Date(createdAt.getTime() + 3 * 24 * 60 * 60 * 1000)
    const trialDaysRemaining = Math.max(0, Math.ceil((trialEndDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)))
    const isInTrial = trialDaysRemaining > 0

    return {
      isSubscribed: false,
      isFreeTrialAvailable: isInTrial,
      questionsRemaining: isInTrial ? -1 : 0,
      trialDaysRemaining,
    }
  } catch (error) {
    // If Redis is rate-limited or unavailable, fail open — allow access rather than crashing the page.
    // The user is already authenticated (session exists). Blocking them due to a Redis outage is worse
    // than temporarily granting access.
    console.error('[subscription] Redis/DB error during subscription check — failing open:', error)
    return {
      isSubscribed: true,
      isFreeTrialAvailable: false,
      questionsRemaining: -1,
      trialDaysRemaining: 0,
    }
  }
}

export async function checkTermsAccepted() {
  const session = await auth()
  
  if (!session?.user?.id) {
    return false
  }

  try {
    const user = await db.users.findById(session.user.id)
    return user?.termsAcceptedAt !== null
  } catch (error) {
    console.error('[subscription] Redis/DB error during terms check — failing open:', error)
    return true
  }
}
