import Stripe from 'stripe'

// Make Stripe optional - allows build to succeed without Stripe env vars
// Stripe will be configured properly when setting up payments
let stripeClient: Stripe | null = null

try {
  if (process.env.STRIPE_SECRET_KEY) {
    stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: '2026-01-28.clover',
      typescript: true,
    })
  } else {
    console.warn('[Stripe] STRIPE_SECRET_KEY not configured - payments disabled')
  }
} catch (error) {
  console.warn('[Stripe] Failed to initialize:', error)
}

export const stripe = stripeClient
export const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID || ''

// Helper to check if Stripe is configured
export function isStripeConfigured(): boolean {
  return stripeClient !== null
}
