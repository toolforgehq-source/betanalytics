import { auth } from "@/auth"
import { NextResponse } from "next/server"

export default auth((req) => {
  const host = req.headers.get("host") || ""
  
  // Redirect www to apex domain to ensure cookies work consistently
  if (host.startsWith("www.")) {
    const newUrl = new URL(req.url)
    newUrl.host = host.replace("www.", "")
    return NextResponse.redirect(newUrl, 301)
  }
  
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
