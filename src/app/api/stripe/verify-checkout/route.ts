import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { stripe, isStripeConfigured } from "@/lib/stripe"
import { db } from "@/db"
import Stripe from "stripe"

export async function POST(request: Request) {
  try {
    if (!isStripeConfigured() || !stripe) {
      return NextResponse.json({ error: "Stripe not configured" }, { status: 503 })
    }

    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { sessionId } = await request.json()
    if (!sessionId) {
      return NextResponse.json({ error: "Missing session ID" }, { status: 400 })
    }

    const existingSub = await db.subscriptions.findByUserId(session.user.id)
    if (existingSub && (existingSub.status === 'active' || existingSub.status === 'trialing')) {
      return NextResponse.json({ verified: true, alreadyActive: true })
    }

    const checkoutSession = await stripe.checkout.sessions.retrieve(sessionId)

    if (checkoutSession.metadata?.userId !== session.user.id) {
      return NextResponse.json({ error: "Session mismatch" }, { status: 403 })
    }

    if (checkoutSession.payment_status !== 'paid' || !checkoutSession.subscription) {
      return NextResponse.json({ verified: false, reason: "Payment not completed" })
    }

    const subscriptionResponse = await stripe.subscriptions.retrieve(
      checkoutSession.subscription as string
    )
    const subscription = subscriptionResponse as Stripe.Subscription
    const subscriptionItem = subscription.items.data[0]

    if (existingSub) {
      await db.subscriptions.update(existingSub.id, {
        stripeCustomerId: checkoutSession.customer as string,
        stripeSubscriptionId: subscription.id,
        stripePriceId: subscriptionItem.price.id,
        status: subscription.status,
        currentPeriodStart: new Date(subscriptionItem.current_period_start * 1000).toISOString(),
        currentPeriodEnd: new Date(subscriptionItem.current_period_end * 1000).toISOString(),
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
      })
    } else {
      await db.subscriptions.create({
        userId: session.user.id,
        stripeCustomerId: checkoutSession.customer as string,
        stripeSubscriptionId: subscription.id,
        stripePriceId: subscriptionItem.price.id,
        status: subscription.status,
        currentPeriodStart: new Date(subscriptionItem.current_period_start * 1000).toISOString(),
        currentPeriodEnd: new Date(subscriptionItem.current_period_end * 1000).toISOString(),
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
      })
    }

    console.log(`[verify-checkout] Subscription verified and synced for user ${session.user.id}, status: ${subscription.status}`)

    return NextResponse.json({ verified: true })
  } catch (error) {
    console.error("[verify-checkout] Error:", error)
    return NextResponse.json(
      { error: "Failed to verify checkout session" },
      { status: 500 }
    )
  }
}
