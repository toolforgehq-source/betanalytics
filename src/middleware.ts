import { NextResponse } from "next/server"

// Middleware runs in Edge runtime - do NOT import @/auth here as it includes
// bcryptjs which doesn't work in Edge runtime and causes session reading to fail.
// Auth protection is handled at the page level in /chat/page.tsx and /account/page.tsx
// which run in Node runtime where bcryptjs works correctly.

export function middleware() {
  // Just pass through - auth is handled at page level
  return NextResponse.next()
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
}
