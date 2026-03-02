import { NextResponse } from "next/server"
import { db } from "@/db"

export async function GET() {
  try {
    const referrals = await db.referrals.listAll()

    // For each referral, get conversion stats
    const referralsWithStats = await Promise.all(
      referrals.map(async (referral) => {
        const conversions = await db.referralConversions.findByReferralId(referral.id)
        const signups = conversions.filter(c => c.status === 'signed_up').length
        const subscribers = conversions.filter(c => c.status === 'subscribed').length
        const churned = conversions.filter(c => c.status === 'churned').length
        const monthlyRevenue = subscribers * 39 // $39/mo per subscriber
        const monthlyCommission = monthlyRevenue * (referral.commissionPercent / 100)

        return {
          ...referral,
          stats: {
            totalSignups: conversions.length,
            signedUp: signups,
            activeSubscribers: subscribers,
            churned,
            monthlyRevenue,
            monthlyCommission,
          },
          conversions,
        }
      })
    )

    return NextResponse.json({ success: true, referrals: referralsWithStats })
  } catch (error) {
    console.error("[Admin Referrals] Error fetching referrals:", error)
    return NextResponse.json(
      { error: "Failed to fetch referrals" },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const { code, partnerName, partnerEmail, commissionPercent } = await request.json()

    if (!code || !partnerName) {
      return NextResponse.json(
        { error: "Code and partner name are required" },
        { status: 400 }
      )
    }

    // Check if code already exists
    const existing = await db.referrals.findByCode(code)
    if (existing) {
      return NextResponse.json(
        { error: "Referral code already exists" },
        { status: 400 }
      )
    }

    // Validate code format: alphanumeric and hyphens only
    if (!/^[a-zA-Z0-9-]+$/.test(code)) {
      return NextResponse.json(
        { error: "Code can only contain letters, numbers, and hyphens" },
        { status: 400 }
      )
    }

    const referral = await db.referrals.create({
      code: code.toUpperCase(),
      partnerName,
      partnerEmail: partnerEmail || null,
      commissionPercent: commissionPercent || 25,
      active: true,
    })

    return NextResponse.json({ success: true, referral }, { status: 201 })
  } catch (error) {
    console.error("[Admin Referrals] Error creating referral:", error)
    return NextResponse.json(
      { error: "Failed to create referral" },
      { status: 500 }
    )
  }
}
