import { NextResponse } from "next/server"
import { hash } from "bcryptjs"
import { db } from "@/db"
import { sendWelcomeEmail } from "@/lib/email-sequence"
import { isEmailConfigured } from "@/lib/email"

export async function POST(request: Request) {
  try {
    const { email, password, name } = await request.json()

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 }
      )
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: "Invalid email format" },
        { status: 400 }
      )
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters" },
        { status: 400 }
      )
    }

    const existingUser = await db.users.findByEmail(email)

    if (existingUser) {
      return NextResponse.json(
        { error: "Email already registered" },
        { status: 400 }
      )
    }

    const passwordHash = await hash(password, 12)

    const newUser = await db.users.create({
      email: email.toLowerCase(),
      passwordHash,
      name: name || null,
      termsAcceptedAt: null,
      questionCount: 0,
    })

    if (isEmailConfigured()) {
      sendWelcomeEmail(newUser.id, newUser.email, newUser.name).catch((err) => {
        console.error('[Signup] Failed to send welcome email:', err)
      })
    }

    return NextResponse.json(
      { message: "User created successfully", userId: newUser.id },
      { status: 201 }
    )
  } catch (error) {
    console.error("Signup error:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}
