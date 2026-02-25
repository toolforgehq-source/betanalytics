'use client'

import { useState } from 'react'
import { Bell, BellOff, Mail, Smartphone, Zap, Clock, TrendingUp, Filter, Save, Check } from 'lucide-react'

// ============================================
// TYPES
// ============================================

interface AlertPreferences {
  // Notification channels
  emailEnabled: boolean
  pushEnabled: boolean
  email: string

  // Alert types
  bestBetOfDay: boolean
  highEdgePicks: boolean   // +5% edge or more
  parlayOfDay: boolean
  topPlayerProps: boolean
  lineMovements: boolean   // Significant line movement alerts

  // Filters
  minEdge: number          // Minimum edge % to trigger alert
  minProbability: number   // Minimum probability to trigger alert
  sports: string[]         // Which sports to alert on (empty = all)
  betTypes: string[]       // Which bet types to alert on (empty = all)

  // Timing
  frequency: 'instant' | 'hourly' | 'daily_morning' | 'daily_evening'
  quietHoursStart: string  // e.g. "22:00"
  quietHoursEnd: string    // e.g. "08:00"
}

const DEFAULT_PREFERENCES: AlertPreferences = {
  emailEnabled: true,
  pushEnabled: false,
  email: '',
  bestBetOfDay: true,
  highEdgePicks: true,
  parlayOfDay: false,
  topPlayerProps: false,
  lineMovements: false,
  minEdge: 3,
  minProbability: 55,
  sports: [],
  betTypes: [],
  frequency: 'instant',
  quietHoursStart: '23:00',
  quietHoursEnd: '07:00',
}

const ALL_SPORTS = [
  'NBA', 'NFL', 'NHL', 'MLB', 'NCAAB', 'NCAAF',
  'EPL', 'La Liga', 'Bundesliga', 'Serie A', 'Ligue 1', 'MLS',
  'UFC/MMA', 'Boxing',
]

const ALL_BET_TYPES = ['Moneyline', 'Spread', 'Total', 'Player Props']

const FREQUENCY_OPTIONS = [
  { value: 'instant', label: 'Instant', desc: 'Get alerts as soon as we find an edge' },
  { value: 'hourly', label: 'Hourly Digest', desc: 'Bundled summary every hour' },
  { value: 'daily_morning', label: 'Morning Brief', desc: 'Daily digest at 9:00 AM ET' },
  { value: 'daily_evening', label: 'Evening Brief', desc: 'Daily digest at 5:00 PM ET' },
]

// ============================================
// SUB-COMPONENTS
// ============================================

function Toggle({ enabled, onChange, label, description }: {
  enabled: boolean
  onChange: (val: boolean) => void
  label: string
  description?: string
}) {
  return (
    <div className="flex items-center justify-between py-3">
      <div>
        <p className="text-sm font-medium">{label}</p>
        {description && <p className="text-xs text-slate-500 mt-0.5">{description}</p>}
      </div>
      <button
        onClick={() => onChange(!enabled)}
        className={`relative w-11 h-6 rounded-full transition-colors ${
          enabled ? 'bg-cyan-500' : 'bg-slate-700'
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform shadow ${
            enabled ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  )
}

function ChipSelect({ options, selected, onChange }: {
  options: string[]
  selected: string[]
  onChange: (val: string[]) => void
}) {
  function toggle(option: string) {
    if (selected.includes(option)) {
      onChange(selected.filter(s => s !== option))
    } else {
      onChange([...selected, option])
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      {options.map(opt => (
        <button
          key={opt}
          onClick={() => toggle(opt)}
          className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
            selected.includes(opt) || selected.length === 0
              ? selected.includes(opt)
                ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                : 'bg-slate-800/50 text-slate-400 border border-slate-700/30 hover:bg-slate-700/50'
              : 'bg-slate-800/50 text-slate-500 border border-slate-700/30 hover:bg-slate-700/50'
          }`}
        >
          {opt}
        </button>
      ))}
      {selected.length > 0 && (
        <button
          onClick={() => onChange([])}
          className="px-3 py-1.5 rounded-full text-xs text-slate-500 hover:text-slate-300 transition-colors"
        >
          Clear (All)
        </button>
      )}
    </div>
  )
}

// ============================================
// MAIN COMPONENT
// ============================================

export default function AlertsClient() {
  const [prefs, setPrefs] = useState<AlertPreferences>(DEFAULT_PREFERENCES)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)

  function updatePref<K extends keyof AlertPreferences>(key: K, value: AlertPreferences[K]) {
    setPrefs(prev => ({ ...prev, [key]: value }))
    setSaved(false)
  }

  async function handleSave() {
    setSaving(true)
    try {
      const res = await fetch('/api/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(prefs),
      })
      if (res.ok) {
        setSaved(true)
        setTimeout(() => setSaved(false), 3000)
      }
    } catch (err) {
      console.error('Failed to save preferences:', err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-8 max-w-2xl">
      {/* Notification Channels */}
      <section className="bg-slate-900/50 border border-slate-800/50 rounded-xl p-6">
        <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
          <Bell className="w-5 h-5 text-cyan-400" />
          Notification Channels
        </h2>
        <div className="space-y-1">
          <Toggle
            enabled={prefs.emailEnabled}
            onChange={(v) => updatePref('emailEnabled', v)}
            label="Email Notifications"
            description="Receive alerts via email"
          />
          {prefs.emailEnabled && (
            <div className="pb-3">
              <label className="text-xs text-slate-500 block mb-1">Email Address</label>
              <div className="flex items-center gap-2">
                <Mail className="w-4 h-4 text-slate-500" />
                <input
                  type="email"
                  value={prefs.email}
                  onChange={(e) => updatePref('email', e.target.value)}
                  placeholder="you@example.com"
                  className="flex-1 bg-slate-800/50 border border-slate-700/50 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-500/50"
                />
              </div>
            </div>
          )}
          <Toggle
            enabled={prefs.pushEnabled}
            onChange={(v) => updatePref('pushEnabled', v)}
            label="Push Notifications"
            description="Browser push notifications for instant alerts"
          />
          {prefs.pushEnabled && (
            <div className="pb-3 flex items-start gap-2 bg-blue-500/10 border border-blue-500/20 rounded-lg p-3">
              <Smartphone className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-blue-400/80">
                Push notifications require browser permission. You&apos;ll be prompted to allow notifications when you save.
              </p>
            </div>
          )}
        </div>
      </section>

      {/* Alert Types */}
      <section className="bg-slate-900/50 border border-slate-800/50 rounded-xl p-6">
        <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
          <Zap className="w-5 h-5 text-yellow-400" />
          Alert Types
        </h2>
        <div className="space-y-1">
          <Toggle
            enabled={prefs.bestBetOfDay}
            onChange={(v) => updatePref('bestBetOfDay', v)}
            label="Best Bet of the Day"
            description="Our #1 pick each day — highest model score"
          />
          <Toggle
            enabled={prefs.highEdgePicks}
            onChange={(v) => updatePref('highEdgePicks', v)}
            label="High Edge Picks"
            description={`Picks with ${prefs.minEdge}%+ edge over the market`}
          />
          <Toggle
            enabled={prefs.parlayOfDay}
            onChange={(v) => updatePref('parlayOfDay', v)}
            label="Parlay of the Day"
            description="Our model's best 3-leg parlay each day"
          />
          <Toggle
            enabled={prefs.topPlayerProps}
            onChange={(v) => updatePref('topPlayerProps', v)}
            label="Top Player Props"
            description="High-confidence player prop picks"
          />
          <Toggle
            enabled={prefs.lineMovements}
            onChange={(v) => updatePref('lineMovements', v)}
            label="Significant Line Movements"
            description="Alert when lines move 1.5+ points on tracked games"
          />
        </div>
      </section>

      {/* Thresholds */}
      <section className="bg-slate-900/50 border border-slate-800/50 rounded-xl p-6">
        <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-green-400" />
          Alert Thresholds
        </h2>
        <div className="space-y-5">
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium">Minimum Edge</label>
              <span className="text-sm font-mono text-cyan-400">{prefs.minEdge}%</span>
            </div>
            <input
              type="range"
              min="1"
              max="15"
              step="0.5"
              value={prefs.minEdge}
              onChange={(e) => updatePref('minEdge', Number(e.target.value))}
              className="w-full accent-cyan-500"
            />
            <div className="flex justify-between text-xs text-slate-500 mt-1">
              <span>1% (more alerts)</span>
              <span>15% (fewer, higher quality)</span>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium">Minimum Probability</label>
              <span className="text-sm font-mono text-cyan-400">{prefs.minProbability}%</span>
            </div>
            <input
              type="range"
              min="50"
              max="80"
              step="1"
              value={prefs.minProbability}
              onChange={(e) => updatePref('minProbability', Number(e.target.value))}
              className="w-full accent-cyan-500"
            />
            <div className="flex justify-between text-xs text-slate-500 mt-1">
              <span>50% (all picks)</span>
              <span>80% (high confidence only)</span>
            </div>
          </div>
        </div>
      </section>

      {/* Sport & Bet Type Filters */}
      <section className="bg-slate-900/50 border border-slate-800/50 rounded-xl p-6">
        <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
          <Filter className="w-5 h-5 text-purple-400" />
          Sport & Bet Type Filters
        </h2>
        <div className="space-y-5">
          <div>
            <label className="text-sm font-medium block mb-2">Sports <span className="text-xs text-slate-500">(empty = all sports)</span></label>
            <ChipSelect
              options={ALL_SPORTS}
              selected={prefs.sports}
              onChange={(v) => updatePref('sports', v)}
            />
          </div>
          <div>
            <label className="text-sm font-medium block mb-2">Bet Types <span className="text-xs text-slate-500">(empty = all types)</span></label>
            <ChipSelect
              options={ALL_BET_TYPES}
              selected={prefs.betTypes}
              onChange={(v) => updatePref('betTypes', v)}
            />
          </div>
        </div>
      </section>

      {/* Frequency & Timing */}
      <section className="bg-slate-900/50 border border-slate-800/50 rounded-xl p-6">
        <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
          <Clock className="w-5 h-5 text-orange-400" />
          Frequency & Timing
        </h2>
        <div className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-3">
            {FREQUENCY_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => updatePref('frequency', opt.value as AlertPreferences['frequency'])}
                className={`p-3 rounded-lg border text-left transition-all ${
                  prefs.frequency === opt.value
                    ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400'
                    : 'bg-slate-800/30 border-slate-700/30 text-slate-400 hover:bg-slate-800/50'
                }`}
              >
                <p className="text-sm font-medium">{opt.label}</p>
                <p className="text-xs mt-0.5 opacity-70">{opt.desc}</p>
              </button>
            ))}
          </div>

          <div>
            <label className="text-sm font-medium block mb-2">Quiet Hours <span className="text-xs text-slate-500">(no notifications)</span></label>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <BellOff className="w-4 h-4 text-slate-500" />
                <input
                  type="time"
                  value={prefs.quietHoursStart}
                  onChange={(e) => updatePref('quietHoursStart', e.target.value)}
                  className="bg-slate-800/50 border border-slate-700/50 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50"
                />
              </div>
              <span className="text-slate-500 text-sm">to</span>
              <input
                type="time"
                value={prefs.quietHoursEnd}
                onChange={(e) => updatePref('quietHoursEnd', e.target.value)}
                className="bg-slate-800/50 border border-slate-700/50 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Save Button */}
      <div className="sticky bottom-4">
        <button
          onClick={handleSave}
          disabled={saving}
          className={`w-full py-4 rounded-xl font-semibold text-sm transition-all shadow-lg flex items-center justify-center gap-2 ${
            saved
              ? 'bg-green-500/20 border border-green-500/30 text-green-400'
              : 'bg-gradient-to-r from-blue-500 to-cyan-400 hover:from-blue-600 hover:to-cyan-500 text-white shadow-blue-500/25'
          }`}
        >
          {saving ? (
            <span className="animate-pulse">Saving...</span>
          ) : saved ? (
            <>
              <Check className="w-4 h-4" />
              Preferences Saved
            </>
          ) : (
            <>
              <Save className="w-4 h-4" />
              Save Alert Preferences
            </>
          )}
        </button>
      </div>
    </div>
  )
}
