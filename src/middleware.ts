import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

// Middleware runs in Edge runtime - do NOT import @/auth here as it includes
// bcryptjs which doesn't work in Edge runtime and causes session reading to fail.
// Auth protection is handled at the page level in /chat/page.tsx and /account/page.tsx
// which run in Node runtime where bcryptjs works correctly.

export function middleware(request: NextRequest) {
  const response = NextResponse.next()

  // Capture referral code from ?ref= query parameter and store in cookie
  const refCode = request.nextUrl.searchParams.get('ref')
  if (refCode && !request.cookies.get('ref_code')) {
    response.cookies.set('ref_code', refCode, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30, // 30 days
      path: '/',
    })
  }

  return response
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
}
