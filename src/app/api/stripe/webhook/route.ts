import { NextResponse } from "next/server"
import { headers } from "next/headers"
import { stripe } from "@/lib/stripe"
import { db } from "@/db"
import Stripe from "stripe"

export async function POST(request: Request) {
  const body = await request.text()
  const headersList = await headers()
  const signature = headersList.get("stripe-signature")!

  let event: Stripe.Event

  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    )
  } catch (error) {
    console.error("Webhook signature verification failed:", error)
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 })
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session
      const userId = session.metadata?.userId

      if (!userId) break

      const subscriptionResponse = await stripe.subscriptions.retrieve(
        session.subscription as string
      )
      const subscription = subscriptionResponse as Stripe.Subscription
      const subscriptionItem = subscription.items.data[0]

      await db.subscriptions.create({
        userId,
        stripeCustomerId: session.customer as string,
        stripeSubscriptionId: subscription.id,
        stripePriceId: subscriptionItem.price.id,
        status: subscription.status,
        currentPeriodStart: new Date(subscriptionItem.current_period_start * 1000).toISOString(),
        currentPeriodEnd: new Date(subscriptionItem.current_period_end * 1000).toISOString(),
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
      })
      break
    }

    case 'customer.subscription.updated': {
      const subscription = event.data.object as Stripe.Subscription
      const subscriptionItem = subscription.items.data[0]

      await db.subscriptions.updateByStripeSubscriptionId(subscription.id, {
        status: subscription.status,
        currentPeriodStart: new Date(subscriptionItem.current_period_start * 1000).toISOString(),
        currentPeriodEnd: new Date(subscriptionItem.current_period_end * 1000).toISOString(),
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
      })
      break
    }

    case 'customer.subscription.deleted': {
      const subscription = event.data.object as Stripe.Subscription

      await db.subscriptions.updateByStripeSubscriptionId(subscription.id, {
        status: 'canceled',
      })
      break
    }
  }

  return NextResponse.json({ received: true })
}
