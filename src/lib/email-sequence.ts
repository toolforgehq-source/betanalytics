import { sendEmail } from './email'
import {
  welcomeEmail,
  day2ValueDemo,
  day3TrialEnding,
  day5TrialExpired,
  week2Winback,
} from './email-templates'

export type EmailStep = 'welcome' | 'day2_value' | 'day3_trial_ending' | 'day5_expired' | 'week2_winback'

export interface EmailSequenceState {
  userId: string
  email: string
  name: string | null
  signupDate: string
  emailsSent: EmailStep[]
  convertedAt: string | null
  unsubscribed: boolean
}

const EMAIL_SEQUENCE: { step: EmailStep; delayDays: number }[] = [
  { step: 'welcome', delayDays: 0 },
  { step: 'day2_value', delayDays: 2 },
  { step: 'day3_trial_ending', delayDays: 3 },
  { step: 'day5_expired', delayDays: 5 },
  { step: 'week2_winback', delayDays: 14 },
]

function getRedisConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
  return { url, token, useRedis: !!(url && token) }
}

async function redisCommand(command: string[]): Promise<unknown> {
  const { url, token } = getRedisConfig()
  if (!url || !token) {
    throw new Error('Redis not configured')
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(command),
    cache: 'no-store',
  })

  if (response.status === 429) {
    console.warn(`[EmailSequence] Redis rate-limited on ${command[0]} — returning null`)
    return null
  }

  const data = await response.json()
  if (data.error) {
    const msg = String(data.error).toLowerCase()
    if (msg.includes('rate') || msg.includes('limit') || msg.includes('too many') || msg.includes('max daily')) {
      console.warn(`[EmailSequence] Upstash limit hit on ${command[0]}: ${data.error}`)
      return null
    }
    throw new Error(data.error)
  }
  return data.result
}

const memorySequences: Map<string, EmailSequenceState> = new Map()

export async function createEmailSequence(userId: string, email: string, name: string | null): Promise<EmailSequenceState> {
  const state: EmailSequenceState = {
    userId,
    email,
    name,
    signupDate: new Date().toISOString(),
    emailsSent: [],
    convertedAt: null,
    unsubscribed: false,
  }

  const { useRedis } = getRedisConfig()
  if (useRedis) {
    await redisCommand(['SET', `email_seq:${userId}`, JSON.stringify(state)])
    await redisCommand(['SADD', 'email_seq_active', userId])
  } else {
    memorySequences.set(userId, state)
  }

  return state
}

export async function getEmailSequence(userId: string): Promise<EmailSequenceState | null> {
  const { useRedis } = getRedisConfig()
  if (useRedis) {
    const data = await redisCommand(['GET', `email_seq:${userId}`]) as string | null
    if (!data) return null
    return JSON.parse(data) as EmailSequenceState
  } else {
    return memorySequences.get(userId) || null
  }
}

export async function updateEmailSequence(userId: string, updates: Partial<EmailSequenceState>): Promise<void> {
  const existing = await getEmailSequence(userId)
  if (!existing) return

  const updated = { ...existing, ...updates }
  const { useRedis } = getRedisConfig()
  if (useRedis) {
    await redisCommand(['SET', `email_seq:${userId}`, JSON.stringify(updated)])
  } else {
    memorySequences.set(userId, updated)
  }
}

export async function markUserConverted(userId: string): Promise<void> {
  await updateEmailSequence(userId, { convertedAt: new Date().toISOString() })
  const { useRedis } = getRedisConfig()
  if (useRedis) {
    await redisCommand(['SREM', 'email_seq_active', userId])
  }
}

export async function getActiveSequenceUserIds(): Promise<string[]> {
  const { useRedis } = getRedisConfig()
  if (useRedis) {
    const members = await redisCommand(['SMEMBERS', 'email_seq_active']) as string[]
    return members || []
  } else {
    return Array.from(memorySequences.entries())
      .filter(([, state]) => !state.convertedAt && !state.unsubscribed)
      .map(([userId]) => userId)
  }
}

function getEmailContent(step: EmailStep, name: string | null): { subject: string; html: string } {
  switch (step) {
    case 'welcome':
      return welcomeEmail(name)
    case 'day2_value':
      return day2ValueDemo(name)
    case 'day3_trial_ending':
      return day3TrialEnding(name)
    case 'day5_expired':
      return day5TrialExpired(name)
    case 'week2_winback':
      return week2Winback(name)
  }
}

function daysSinceSignup(signupDate: string): number {
  const signup = new Date(signupDate)
  const now = new Date()
  return Math.floor((now.getTime() - signup.getTime()) / (1000 * 60 * 60 * 24))
}

export async function sendWelcomeEmail(userId: string, email: string, name: string | null): Promise<void> {
  const sequence = await createEmailSequence(userId, email, name)
  const { subject, html } = getEmailContent('welcome', name)
  const result = await sendEmail({ to: email, subject, html })

  if (result.success) {
    await updateEmailSequence(userId, {
      emailsSent: [...sequence.emailsSent, 'welcome'],
    })
  }
}

export async function processEmailSequences(): Promise<{ processed: number; sent: number; errors: number }> {
  const activeUserIds = await getActiveSequenceUserIds()
  let processed = 0
  let sent = 0
  let errors = 0

  for (const userId of activeUserIds) {
    const state = await getEmailSequence(userId)
    if (!state || state.convertedAt || state.unsubscribed) continue

    processed++
    const days = daysSinceSignup(state.signupDate)

    for (const { step, delayDays } of EMAIL_SEQUENCE) {
      if (state.emailsSent.includes(step)) continue
      if (days < delayDays) continue

      const { subject, html } = getEmailContent(step, state.name)
      const result = await sendEmail({ to: state.email, subject, html })

      if (result.success) {
        await updateEmailSequence(userId, {
          emailsSent: [...state.emailsSent, step],
        })
        sent++
      } else {
        errors++
      }

      break
    }

    const allSent = EMAIL_SEQUENCE.every(({ step }) => state.emailsSent.includes(step))
    if (allSent) {
      const { useRedis } = getRedisConfig()
      if (useRedis) {
        await redisCommand(['SREM', 'email_seq_active', userId])
      }
    }
  }

  return { processed, sent, errors }
}
