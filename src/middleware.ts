import { auth } from "@/auth"
import { NextResponse } from "next/server"

export default auth((req) => {
  const isLoggedIn = !!req.auth
  const isOnChat = req.nextUrl.pathname.startsWith("/chat")
  const isOnAccount = req.nextUrl.pathname.startsWith("/account")

  if ((isOnChat || isOnAccount) && !isLoggedIn) {
    return NextResponse.redirect(new URL("/login", req.url))
  }

  return NextResponse.next()
})

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
}
