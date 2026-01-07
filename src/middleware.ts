import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { getToken } from "next-auth/jwt"

// Edge-safe middleware that doesn't import bcryptjs or db modules
export async function middleware(req: NextRequest) {
  const token = await getToken({ 
    req, 
    secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET 
  })
  
  const isLoggedIn = !!token
  const isOnChat = req.nextUrl.pathname.startsWith("/chat")
  const isOnAccount = req.nextUrl.pathname.startsWith("/account")

  if ((isOnChat || isOnAccount) && !isLoggedIn) {
    return NextResponse.redirect(new URL("/login", req.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
}
