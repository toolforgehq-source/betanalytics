'use client'

import { useState } from 'react'
import { signOut } from 'next-auth/react'
import { User, CreditCard, LogOut, ArrowLeft, Bell } from 'lucide-react'
import Link from 'next/link'
import Logo from '@/components/Logo'
import Footer from '@/components/Footer'

interface AccountPageClientProps {
  user: {
    email: string
    name: string
  }
  isSubscribed: boolean
  questionsRemaining: number
  edgeAlertsEnabled: boolean
}

export default function AccountPageClient({ 
  user, 
  isSubscribed,
  questionsRemaining,
  edgeAlertsEnabled
}: AccountPageClientProps) {
  const [isLoadingPortal, setIsLoadingPortal] = useState(false)
  const [alertsEnabled, setAlertsEnabled] = useState(edgeAlertsEnabled)
  const [isTogglingAlerts, setIsTogglingAlerts] = useState(false)

  const handleToggleAlerts = async () => {
    setIsTogglingAlerts(true)
    try {
      const response = await fetch('/api/account/edge-alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ subscribed: !alertsEnabled }),
      })
      const data = await response.json()
      if (data.success) {
        setAlertsEnabled(data.subscribed)
      }
    } catch (error) {
      console.error('Failed to toggle alerts:', error)
    } finally {
      setIsTogglingAlerts(false)
    }
  }

    const handleManageSubscription = async () => {
      setIsLoadingPortal(true)
      try {
        const response = await fetch('/api/stripe/portal', { 
          method: 'POST',
          credentials: 'include'
        })
      const data = await response.json()
      if (data.url) {
        window.location.href = data.url
      }
    } catch (error) {
      console.error('Failed to open portal:', error)
    } finally {
      setIsLoadingPortal(false)
    }
  }

    const handleSubscribe = async () => {
      try {
        const response = await fetch('/api/stripe/create-checkout', { 
          method: 'POST',
          credentials: 'include'
        })
      const data = await response.json()
      if (data.url) {
        window.location.href = data.url
      }
    } catch (error) {
      console.error('Failed to create checkout:', error)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-blue-950 to-slate-900 text-white flex flex-col">
      <header className="border-b border-slate-800/50 bg-slate-950/30 backdrop-blur-sm">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <Link href="/chat">
              <Logo />
            </Link>
            
            <div className="flex items-center gap-2">
              <Link
                href="/chat"
                className="flex items-center gap-2 px-4 py-2 bg-slate-800/50 hover:bg-slate-700/50 rounded-lg transition-colors text-sm"
              >
                <ArrowLeft className="w-4 h-4" />
                Back to Chat
              </Link>
              <button
                onClick={() => signOut({ callbackUrl: '/' })}
                className="flex items-center gap-2 px-4 py-2 bg-slate-800/50 hover:bg-slate-700/50 rounded-lg transition-colors text-sm"
              >
                <LogOut className="w-4 h-4" />
                Sign Out
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 py-8 px-4">
        <div className="container mx-auto max-w-2xl">
          <h1 className="text-3xl font-bold mb-8">Account Settings</h1>

          <div className="space-y-6">
            <div className="bg-slate-900/30 backdrop-blur-sm border border-slate-800/50 rounded-2xl p-6">
              <div className="flex items-center gap-3 mb-6">
                <User className="w-6 h-6 text-blue-400" />
                <h2 className="text-xl font-semibold">Profile</h2>
              </div>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-slate-400 mb-1">Email</label>
                  <p className="text-slate-200">{user.email}</p>
                </div>
                {user.name && (
                  <div>
                    <label className="block text-sm text-slate-400 mb-1">Name</label>
                    <p className="text-slate-200">{user.name}</p>
                  </div>
                )}
              </div>
            </div>

            <div className="bg-slate-900/30 backdrop-blur-sm border border-slate-800/50 rounded-2xl p-6">
              <div className="flex items-center gap-3 mb-6">
                <CreditCard className="w-6 h-6 text-blue-400" />
                <h2 className="text-xl font-semibold">Subscription</h2>
              </div>
              
              {isSubscribed ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 bg-green-400 rounded-full"></div>
                    <span className="text-green-400 font-semibold">Active Subscription</span>
                  </div>
                  <p className="text-slate-300">
                    You have unlimited access to all features.
                  </p>
                  <button
                    onClick={handleManageSubscription}
                    disabled={isLoadingPortal}
                    className="px-6 py-3 bg-slate-800/50 hover:bg-slate-700/50 border border-slate-700/30 rounded-xl font-semibold transition-colors"
                  >
                    {isLoadingPortal ? 'Loading...' : 'Manage Subscription'}
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 bg-yellow-400 rounded-full"></div>
                    <span className="text-yellow-400 font-semibold">Free Trial</span>
                  </div>
                  <p className="text-slate-300">
                    You have {questionsRemaining} free question{questionsRemaining !== 1 ? 's' : ''} remaining.
                  </p>
                  <div className="bg-gradient-to-br from-blue-900/20 to-cyan-900/20 border border-blue-500/30 rounded-xl p-4">
                    <p className="text-sm text-slate-300 mb-3">
                      Upgrade to Premium for unlimited questions and all features.
                    </p>
                    <div className="text-2xl font-bold mb-3">
                      $39<span className="text-sm text-slate-400">/month</span>
                    </div>
                    <button
                      onClick={handleSubscribe}
                      className="w-full py-3 bg-gradient-to-r from-blue-500 to-cyan-400 hover:from-blue-600 hover:to-cyan-500 rounded-xl font-semibold transition-all shadow-lg shadow-blue-500/30"
                    >
                      Subscribe Now
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

            {isSubscribed && (
              <div className="bg-slate-900/30 backdrop-blur-sm border border-slate-800/50 rounded-2xl p-6">
                <div className="flex items-center gap-3 mb-6">
                  <Bell className="w-6 h-6 text-blue-400" />
                  <h2 className="text-xl font-semibold">Notifications</h2>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-slate-200 font-medium">Big Edge Alerts</p>
                      <p className="text-sm text-slate-400 mt-1">
                        Get emailed when our model finds an edge above 10%. Max one alert per day.
                      </p>
                    </div>
                    <button
                      onClick={handleToggleAlerts}
                      disabled={isTogglingAlerts}
                      className={`relative w-12 h-7 rounded-full transition-colors ${
                        alertsEnabled ? 'bg-blue-500' : 'bg-slate-700'
                      }`}
                    >
                      <div
                        className={`absolute top-1 w-5 h-5 bg-white rounded-full transition-transform ${
                          alertsEnabled ? 'left-6' : 'left-1'
                        }`}
                      />
                    </button>
                  </div>
                  <p className="text-xs text-slate-500">
                    Also includes seasonal sport transition alerts when leagues wind down.
                  </p>
                </div>
              </div>
            )}
        </div>
      </main>

      <Footer />
    </div>
  )
}
