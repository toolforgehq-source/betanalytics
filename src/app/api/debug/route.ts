import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { headers, cookies } from "next/headers"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const headersList = await headers()
  const cookieStore = await cookies()
  
  // Get session info
  let sessionInfo = null
  let sessionError = null
  try {
    const session = await auth()
    sessionInfo = session ? {
      user: session.user ? {
        id: session.user.id,
        email: session.user.email,
        name: session.user.name,
      } : null,
      expires: session.expires,
    } : null
  } catch (error) {
    sessionError = error instanceof Error ? error.message : 'Unknown error'
  }

  // Get relevant headers
  const relevantHeaders = {
    host: headersList.get('host'),
    'x-forwarded-host': headersList.get('x-forwarded-host'),
    'x-forwarded-proto': headersList.get('x-forwarded-proto'),
    'x-vercel-id': headersList.get('x-vercel-id'),
    'x-vercel-deployment-url': headersList.get('x-vercel-deployment-url'),
    origin: headersList.get('origin'),
    referer: headersList.get('referer'),
    'user-agent': headersList.get('user-agent'),
  }

  // Get cookie names (not values for security)
  const cookieNames = cookieStore.getAll().map(c => ({
    name: c.name,
    hasValue: !!c.value,
  }))

  // Build info
  const buildInfo = {
    deploymentId: process.env.VERCEL_DEPLOYMENT_ID || 'not-set',
    gitCommit: process.env.VERCEL_GIT_COMMIT_SHA || 'not-set',
    env: process.env.NODE_ENV,
    nextauthUrl: process.env.NEXTAUTH_URL || 'not-set',
    hasNextauthSecret: !!process.env.NEXTAUTH_SECRET || !!process.env.AUTH_SECRET,
  }

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    session: sessionInfo,
    sessionError,
    headers: relevantHeaders,
    cookies: cookieNames,
    build: buildInfo,
    requestUrl: req.url,
  })
}
