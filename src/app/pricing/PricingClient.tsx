'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface PricingClientProps {
  isLoggedIn: boolean
}

export default function PricingClient({ isLoggedIn }: PricingClientProps) {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)

  const handleSubscribe = async () => {
    if (!isLoggedIn) {
      router.push('/signup')
      return
    }

    setIsLoading(true)
    try {
      const response = await fetch('/api/stripe/create-checkout', { 
        method: 'POST',
        credentials: 'include'
      })
      const data = await response.json()
      if (data.url) {
        window.location.href = data.url
      } else {
        console.error('No checkout URL returned')
        setIsLoading(false)
      }
    } catch (error) {
      console.error('Failed to create checkout:', error)
      setIsLoading(false)
    }
  }

  return (
    <>
      <button
        onClick={handleSubscribe}
        disabled={isLoading}
        className="w-full py-4 bg-gradient-to-r from-blue-500 to-cyan-400 hover:from-blue-600 hover:to-cyan-500 disabled:from-slate-600 disabled:to-slate-500 rounded-xl font-semibold text-lg transition-all shadow-lg shadow-blue-500/30"
      >
        {isLoading ? 'Loading...' : isLoggedIn ? 'Subscribe Now' : 'Start Free Trial'}
      </button>
      <p className="text-center text-sm text-slate-400 mt-4">
        {isLoggedIn 
          ? 'You will be redirected to Stripe to complete payment.'
          : '3 questions free. No credit card required to start.'
        }
      </p>
    </>
  )
}
