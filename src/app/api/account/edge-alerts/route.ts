import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { isUserSubscribedToAlerts, subscribeToAlerts, unsubscribeFromAlerts } from '@/lib/edge-alerts'

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const subscribed = await isUserSubscribedToAlerts(session.user.id)
  return NextResponse.json({ subscribed })
}

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const { subscribed } = body as { subscribed: boolean }

  let success: boolean
  if (subscribed) {
    success = await subscribeToAlerts(session.user.id)
  } else {
    success = await unsubscribeFromAlerts(session.user.id)
  }

  return NextResponse.json({ success, subscribed })
}
