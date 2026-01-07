import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { db } from "@/db"

export async function POST() {
  try {
    const session = await auth()
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    await db.users.update(session.user.id, {
      termsAcceptedAt: new Date().toISOString(),
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Terms acceptance error:", error)
    return NextResponse.json(
      { error: "Failed to accept terms" },
      { status: 500 }
    )
  }
}
