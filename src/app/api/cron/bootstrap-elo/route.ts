import { NextResponse } from 'next/server'
import { bootstrapEmptyElo } from '@/lib/free-elo-bootstrap'

export const runtime='nodejs'
export const dynamic='force-dynamic'
export const maxDuration=300

/** Protected, one-time, non-destructive historical seeding. */
export async function GET(request:Request) {
  const secret=process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== 'Bearer '+secret) {
    return NextResponse.json({success:false,error:'Unauthorized'}, {status:401})
  }
  try {
    const result=await bootstrapEmptyElo()
    return NextResponse.json({success:true,...result})
  } catch(error) {
    console.error('[bootstrap-elo] Seeding failed; no intentional reset or partial update',error)
    return NextResponse.json({success:false,error:'Historical ESPN bootstrap failed; inspect server logs and retry next scheduled run.'},{status:503})
  }
}
