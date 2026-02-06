import { NextResponse } from 'next/server'
import { runPropBacktest, formatBacktestResults } from '@/lib/prop-backtest'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    console.log('[Backtest] Starting prop model backtest...')
    const startTime = Date.now()

    const results = await runPropBacktest()

    const duration = Date.now() - startTime
    console.log(`[Backtest] Complete in ${duration}ms: ${results.totalPredictions} predictions, ${results.overallHitRate}% hit rate`)

    const formatted = formatBacktestResults(results)

    return NextResponse.json({
      success: true,
      results,
      formatted,
      duration: `${duration}ms`,
    })
  } catch (error) {
    console.error('[Backtest] Error:', error)
    return NextResponse.json(
      { error: 'Backtest failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
