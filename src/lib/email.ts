import { Resend } from 'resend'

let resendClient: Resend | null = null

try {
  if (process.env.RESEND_API_KEY) {
    resendClient = new Resend(process.env.RESEND_API_KEY)
  } else {
    console.warn('[Email] RESEND_API_KEY not configured - emails disabled')
  }
} catch (error) {
  console.warn('[Email] Failed to initialize Resend:', error)
}

export const resend = resendClient

const FROM_EMAIL = process.env.EMAIL_FROM || 'BetAnalytics.ai <noreply@betanalytics.ai>'

export function isEmailConfigured(): boolean {
  return resendClient !== null
}

export async function sendEmail({
  to,
  subject,
  html,
}: {
  to: string
  subject: string
  html: string
}): Promise<{ success: boolean; error?: string }> {
  if (!resendClient) {
    console.warn('[Email] Resend not configured - skipping email to', to)
    return { success: false, error: 'Email not configured' }
  }

  try {
    const { error } = await resendClient.emails.send({
      from: FROM_EMAIL,
      to,
      subject,
      html,
    })

    if (error) {
      console.error('[Email] Failed to send:', error)
      return { success: false, error: error.message }
    }

    console.log('[Email] Sent successfully to', to, '- Subject:', subject)
    return { success: true }
  } catch (error) {
    console.error('[Email] Unexpected error:', error)
    return { success: false, error: 'Unexpected error sending email' }
  }
}
