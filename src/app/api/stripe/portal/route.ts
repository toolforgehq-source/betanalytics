import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { stripe } from "@/lib/stripe"
import { db } from "@/db"

export async function POST() {
  try {
    const session = await auth()
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const subscription = db.subscriptions.findByUserId(session.user.id)

    if (!subscription?.stripeCustomerId) {
      return NextResponse.json({ error: "No subscription found" }, { status: 404 })
    }

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: subscription.stripeCustomerId,
      return_url: `${process.env.NEXTAUTH_URL}/account`,
    })

    return NextResponse.json({ url: portalSession.url })
  } catch (error) {
    console.error("Portal error:", error)
    return NextResponse.json(
      { error: "Failed to create portal session" },
      { status: 500 }
    )
  }
}
