import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
import { compare } from "bcryptjs"
import { db } from "@/db"

// 30 days in seconds
const THIRTY_DAYS = 30 * 24 * 60 * 60

export const { handlers, signIn, signOut, auth } = NextAuth({
  // Explicit secret configuration - supports both AUTH_SECRET and NEXTAUTH_SECRET
  secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" }
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null
        }

        const user = await db.users.findByEmail(credentials.email as string)

        if (!user) {
          return null
        }

        const isPasswordValid = await compare(
          credentials.password as string,
          user.passwordHash
        )

        if (!isPasswordValid) {
          return null
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
        }
      },
    }),
  ],
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
    maxAge: THIRTY_DAYS, // 30 days - users stay logged in
    updateAge: 24 * 60 * 60, // Refresh session every 24 hours
  },
  // Let NextAuth use default cookie settings - custom overrides can cause issues with v5
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string
      }
      return session
    },
  },
  trustHost: true,
})
