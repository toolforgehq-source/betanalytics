'use client'

import { useState, useEffect } from 'react'

interface ReferralConversion {
  id: string
  referralCode: string
  userId: string
  status: 'signed_up' | 'subscribed' | 'churned'
  createdAt: string
  subscribedAt: string | null
}

interface ReferralWithStats {
  id: string
  code: string
  partnerName: string
  partnerEmail: string | null
  commissionPercent: number
  active: boolean
  createdAt: string
  stats: {
    totalSignups: number
    signedUp: number
    activeSubscribers: number
    churned: number
    monthlyRevenue: number
    monthlyCommission: number
  }
  conversions: ReferralConversion[]
}

export default function AdminReferralsPage() {
  const [referrals, setReferrals] = useState<ReferralWithStats[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [creating, setCreating] = useState(false)

  // Form state
  const [newCode, setNewCode] = useState('')
  const [newPartnerName, setNewPartnerName] = useState('')
  const [newPartnerEmail, setNewPartnerEmail] = useState('')
  const [newCommission, setNewCommission] = useState('25')

  const fetchReferrals = async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/admin/referrals')
      const data = await res.json()
      if (data.success) {
        setReferrals(data.referrals)
      } else {
        setError(data.error || 'Failed to fetch referrals')
      }
    } catch (err) {
      setError('Failed to fetch referrals')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchReferrals()
  }, [])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setCreating(true)
    setError(null)

    try {
      const res = await fetch('/api/admin/referrals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: newCode,
          partnerName: newPartnerName,
          partnerEmail: newPartnerEmail || undefined,
          commissionPercent: parseInt(newCommission) || 25,
        }),
      })

      const data = await res.json()
      if (data.success) {
        setNewCode('')
        setNewPartnerName('')
        setNewPartnerEmail('')
        setNewCommission('25')
        setShowCreateForm(false)
        await fetchReferrals()
      } else {
        setError(data.error || 'Failed to create referral')
      }
    } catch (err) {
      setError('Failed to create referral')
      console.error(err)
    } finally {
      setCreating(false)
    }
  }

  // Calculate totals
  const totalActiveSubscribers = referrals.reduce((sum, r) => sum + r.stats.activeSubscribers, 0)
  const totalMonthlyRevenue = referrals.reduce((sum, r) => sum + r.stats.monthlyRevenue, 0)
  const totalMonthlyCommission = referrals.reduce((sum, r) => sum + r.stats.monthlyCommission, 0)
  const totalSignups = referrals.reduce((sum, r) => sum + r.stats.totalSignups, 0)

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 text-white p-8">
        <div className="max-w-6xl mx-auto">
          <h1 className="text-3xl font-bold mb-8">Referral Partners</h1>
          <div className="text-gray-400">Loading...</div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold">Referral Partners</h1>
            <p className="text-gray-400 mt-1">Manage affiliate partners and track referral conversions</p>
          </div>
          <button
            onClick={() => setShowCreateForm(!showCreateForm)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg font-semibold transition-colors"
          >
            {showCreateForm ? 'Cancel' : '+ New Partner'}
          </button>
        </div>

        {error && (
          <div className="bg-red-900/20 border border-red-500/30 rounded-xl p-4 text-red-400 text-sm mb-6">
            {error}
          </div>
        )}

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-gray-800 rounded-lg p-4">
            <div className="text-gray-400 text-sm mb-1">Total Partners</div>
            <div className="text-2xl font-bold">{referrals.length}</div>
          </div>
          <div className="bg-gray-800 rounded-lg p-4">
            <div className="text-gray-400 text-sm mb-1">Referred Signups</div>
            <div className="text-2xl font-bold">{totalSignups}</div>
          </div>
          <div className="bg-gray-800 rounded-lg p-4">
            <div className="text-gray-400 text-sm mb-1">Active Subscribers</div>
            <div className="text-2xl font-bold text-green-400">{totalActiveSubscribers}</div>
          </div>
          <div className="bg-gray-800 rounded-lg p-4">
            <div className="text-gray-400 text-sm mb-1">Monthly Revenue</div>
            <div className="text-2xl font-bold text-green-400">${totalMonthlyRevenue.toFixed(0)}</div>
            <div className="text-gray-500 text-sm">-${totalMonthlyCommission.toFixed(0)} commission</div>
          </div>
        </div>

        {/* Create Form */}
        {showCreateForm && (
          <div className="bg-gray-800 rounded-lg p-6 mb-8">
            <h2 className="text-xl font-semibold mb-4">Create New Referral Partner</h2>
            <form onSubmit={handleCreate} className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Referral Code</label>
                <input
                  type="text"
                  value={newCode}
                  onChange={(e) => setNewCode(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''))}
                  placeholder="e.g. JIMMY, SHARP-PLAYS"
                  required
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-gray-500 text-xs mt-1">
                  Link: betanalytics.ai?ref={newCode || 'CODE'}
                </p>
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Partner Name</label>
                <input
                  type="text"
                  value={newPartnerName}
                  onChange={(e) => setNewPartnerName(e.target.value)}
                  placeholder="e.g. Jimmy Boyd"
                  required
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Partner Email (optional)</label>
                <input
                  type="email"
                  value={newPartnerEmail}
                  onChange={(e) => setNewPartnerEmail(e.target.value)}
                  placeholder="partner@email.com"
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Commission %</label>
                <input
                  type="number"
                  value={newCommission}
                  onChange={(e) => setNewCommission(e.target.value)}
                  min="1"
                  max="50"
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-gray-500 text-xs mt-1">
                  Partner earns ${((parseInt(newCommission) || 25) * 39 / 100).toFixed(2)}/sub/month at {newCommission || 25}%
                </p>
              </div>
              <div className="md:col-span-2">
                <button
                  type="submit"
                  disabled={creating}
                  className="px-6 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 rounded-lg font-semibold transition-colors"
                >
                  {creating ? 'Creating...' : 'Create Partner'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Referral Partners Table */}
        {referrals.length > 0 ? (
          <div className="bg-gray-800 rounded-lg p-6">
            <h2 className="text-xl font-semibold mb-4">Partners</h2>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="text-left text-gray-400 border-b border-gray-700">
                    <th className="pb-3">Partner</th>
                    <th className="pb-3">Code</th>
                    <th className="pb-3">Commission</th>
                    <th className="pb-3">Signups</th>
                    <th className="pb-3">Active Subs</th>
                    <th className="pb-3">Revenue/mo</th>
                    <th className="pb-3">You Owe/mo</th>
                    <th className="pb-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {referrals.map((referral) => (
                    <tr key={referral.id} className="border-b border-gray-700">
                      <td className="py-3">
                        <div className="font-semibold">{referral.partnerName}</div>
                        {referral.partnerEmail && (
                          <div className="text-gray-500 text-sm">{referral.partnerEmail}</div>
                        )}
                      </td>
                      <td className="py-3">
                        <code className="bg-gray-700 px-2 py-1 rounded text-sm">{referral.code}</code>
                      </td>
                      <td className="py-3">{referral.commissionPercent}%</td>
                      <td className="py-3">{referral.stats.totalSignups}</td>
                      <td className="py-3">
                        <span className={referral.stats.activeSubscribers > 0 ? 'text-green-400' : ''}>
                          {referral.stats.activeSubscribers}
                        </span>
                        {referral.stats.churned > 0 && (
                          <span className="text-red-400 text-sm ml-1">(-{referral.stats.churned})</span>
                        )}
                      </td>
                      <td className="py-3">
                        <span className={referral.stats.monthlyRevenue > 0 ? 'text-green-400' : ''}>
                          ${referral.stats.monthlyRevenue.toFixed(0)}
                        </span>
                      </td>
                      <td className="py-3">
                        <span className={referral.stats.monthlyCommission > 0 ? 'text-yellow-400' : ''}>
                          ${referral.stats.monthlyCommission.toFixed(2)}
                        </span>
                      </td>
                      <td className="py-3">
                        <span className={`px-2 py-1 rounded text-xs ${referral.active ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                          {referral.active ? 'ACTIVE' : 'INACTIVE'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="bg-gray-800 rounded-lg p-8 text-center">
            <p className="text-gray-400 mb-4">No referral partners yet.</p>
            <button
              onClick={() => setShowCreateForm(true)}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg font-semibold transition-colors"
            >
              Create Your First Partner
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
