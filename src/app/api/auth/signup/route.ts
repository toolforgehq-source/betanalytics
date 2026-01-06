import { NextResponse } from "next/server"
import { hash } from "bcryptjs"
import { db } from "@/db"

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

    const existingUser = db.users.findByEmail(email)

    if (existingUser) {
      return NextResponse.json(
        { error: "Email already registered" },
        { status: 400 }
      )
    }

    const passwordHash = await hash(password, 12)

    const newUser = db.users.create({
      email: email.toLowerCase(),
      passwordHash,
      name: name || null,
      termsAcceptedAt: null,
      questionCount: 0,
    })

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
