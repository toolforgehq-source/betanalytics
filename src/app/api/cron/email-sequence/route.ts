import { NextResponse } from 'next/server'
import { processEmailSequences } from '@/lib/email-sequence'
import { isEmailConfigured } from '@/lib/email'

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!isEmailConfigured()) {
    return NextResponse.json(
      { message: 'Email not configured - skipping sequence processing' },
      { status: 200 }
    )
  }

  try {
    const results = await processEmailSequences()
    console.log('[Email Sequence Cron] Results:', results)
    return NextResponse.json({
      message: 'Email sequence processed',
      ...results,
    })
  } catch (error) {
    console.error('[Email Sequence Cron] Error:', error)
    return NextResponse.json(
      { error: 'Failed to process email sequences' },
      { status: 500 }
    )
  }
}
