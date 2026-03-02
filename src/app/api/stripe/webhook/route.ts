import { NextResponse } from "next/server"
import { headers } from "next/headers"
import { stripe, isStripeConfigured } from "@/lib/stripe"
import { db } from "@/db"
import { markUserConverted } from "@/lib/email-sequence"
import Stripe from "stripe"

export async function POST(request: Request) {
  // Check if Stripe is configured
  if (!isStripeConfigured() || !stripe) {
    console.warn('[Stripe Webhook] Stripe not configured - webhook disabled')
    return NextResponse.json(
      { error: 'Stripe not configured - payments disabled' },
      { status: 503 }
    )
  }

  const body = await request.text()
  const headersList = await headers()
  const signature = headersList.get("stripe-signature")

  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 })
  }

  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    console.warn('[Stripe Webhook] STRIPE_WEBHOOK_SECRET not configured')
    return NextResponse.json(
      { error: 'Stripe webhook secret not configured' },
      { status: 503 }
    )
  }

  let event: Stripe.Event

  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
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

      // Update referral conversion to 'subscribed' if this user was referred
      const refCode = session.metadata?.refCode
      if (refCode) {
        try {
          const existingConversion = await db.referralConversions.findByUserId(userId)
          if (existingConversion) {
            await db.referralConversions.update(existingConversion.id, {
              status: 'subscribed',
              stripeSubscriptionId: subscription.id,
              subscribedAt: new Date().toISOString(),
            })
            console.log(`[Stripe Webhook] Referral conversion updated to subscribed: userId=${userId}, refCode=${refCode}`)
          } else {
            // User might have signed up without the referral tracking, but used ref link for checkout
            const referral = await db.referrals.findByCode(refCode)
            if (referral && referral.active) {
              await db.referralConversions.create({
                referralId: referral.id,
                referralCode: referral.code,
                userId,
                stripeSubscriptionId: subscription.id,
                status: 'subscribed',
                subscribedAt: new Date().toISOString(),
              })
              console.log(`[Stripe Webhook] New referral conversion created at subscription: userId=${userId}, refCode=${refCode}`)
            }
          }
        } catch (refErr) {
          console.error('[Stripe Webhook] Failed to update referral conversion:', refErr)
        }
      }

      markUserConverted(userId).catch((err) => {
        console.error('[Stripe Webhook] Failed to mark user converted for email sequence:', err)
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

      // Mark referral conversion as churned if applicable
      const canceledSub = await db.subscriptions.findByStripeSubscriptionId(subscription.id)
      if (canceledSub) {
        try {
          const refConversion = await db.referralConversions.findByUserId(canceledSub.userId)
          if (refConversion && refConversion.status === 'subscribed') {
            await db.referralConversions.update(refConversion.id, {
              status: 'churned',
            })
          }
        } catch (refErr) {
          console.error('[Stripe Webhook] Failed to update referral churn:', refErr)
        }
      }
      break
    }
  }

  return NextResponse.json({ received: true })
}
