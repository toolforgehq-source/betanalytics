'use client'

import { useState } from 'react'
import { AlertTriangle, Shield } from 'lucide-react'
import Logo from './Logo'

interface TermsModalProps {
  onAccept: () => void
}

const TERMS_ITEMS = [
  { key: 'age', text: 'I am 21+ years old (or legal gambling age in my jurisdiction)' },
  { key: 'entertainment', text: 'I understand this is for ENTERTAINMENT and EDUCATIONAL PURPOSES ONLY - Betanalytics.ai does not guarantee wins or profits' },
  { key: 'risk', text: 'I acknowledge gambling involves risk - I may lose money and should only bet what I can afford to lose' },
  { key: 'suggestions', text: 'I understand these are suggestions, not guarantees - All picks are based on statistical models and may be incorrect' },
  { key: 'responsibility', text: 'I am responsible for my own betting decisions - Betanalytics.ai is not liable for any losses' },
  { key: 'legal', text: 'I will comply with all gambling laws in my jurisdiction - It is my responsibility to ensure online betting is legal where I live' },
  { key: 'pastPerformance', text: 'I understand past performance does not guarantee future results - Historical win rates do not predict future outcomes' },
  { key: 'liability', text: 'I will NOT hold Betanalytics.ai liable for any financial losses, legal issues, or negative outcomes from betting' },
  { key: 'problemGambling', text: 'I am not a problem gambler - I have reviewed responsible gambling resources and can stop anytime' },
  { key: 'fullTerms', text: 'I agree to the full Terms of Service and Privacy Policy' },
]

export default function TermsModal({ onAccept }: TermsModalProps) {
  const [checklist, setChecklist] = useState<Record<string, boolean>>(
    Object.fromEntries(TERMS_ITEMS.map(item => [item.key, false]))
  )

  const allChecked = Object.values(checklist).every(v => v)

  const handleSubmit = () => {
    if (allChecked) {
      onAccept()
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-blue-950 to-slate-900 text-white">
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <Logo size="lg" />
          </div>
        </div>

        <div className="bg-slate-900/50 backdrop-blur-sm border border-red-500/30 rounded-2xl p-8 mb-6">
          <div className="flex items-center gap-3 mb-6">
            <AlertTriangle className="w-8 h-8 text-red-400" />
            <h2 className="text-2xl font-bold text-red-400">Important Legal Disclaimer</h2>
          </div>
          
          <div className="space-y-4 text-slate-300 mb-8">
            <p className="text-lg font-semibold">
              Before using Betanalytics.ai, you MUST read and accept ALL of the following terms:
            </p>
            <p className="bg-red-950/30 border border-red-500/30 rounded-lg p-4 text-red-200">
              <strong>WARNING:</strong> Sports betting involves financial risk. This service provides entertainment and educational content only. We do not guarantee wins, profits, or accuracy. You may lose money.
            </p>
          </div>

          <div className="space-y-4 mb-8">
            {TERMS_ITEMS.map(({ key, text }) => (
              <label key={key} className="flex items-start gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={checklist[key]}
                  onChange={(e) => setChecklist(prev => ({ ...prev, [key]: e.target.checked }))}
                  className="w-5 h-5 mt-1 rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-2 focus:ring-blue-500 cursor-pointer accent-blue-500"
                />
                <span className="text-slate-300 group-hover:text-white transition-colors">
                  {text}
                </span>
              </label>
            ))}
          </div>

          <div className="bg-slate-950/50 border border-slate-700 rounded-xl p-6 mb-6">
            <h3 className="text-lg font-semibold text-slate-200 mb-3 flex items-center gap-2">
              <Shield className="w-5 h-5 text-blue-400" />
              Responsible Gambling Resources
            </h3>
            <div className="space-y-2 text-sm text-slate-400">
              <p>If you or someone you know has a gambling problem:</p>
              <ul className="list-disc list-inside space-y-1 ml-4">
                <li>National Council on Problem Gambling: 1-800-GAMBLER</li>
                <li>Gamblers Anonymous: www.gamblersanonymous.org</li>
                <li>Visit: www.ncpgambling.org for state-specific resources</li>
              </ul>
            </div>
          </div>

          <button
            onClick={handleSubmit}
            disabled={!allChecked}
            className={`w-full py-4 rounded-xl font-semibold text-lg transition-all ${
              allChecked
                ? 'bg-gradient-to-r from-blue-500 to-cyan-400 hover:from-blue-600 hover:to-cyan-500 text-white shadow-lg shadow-blue-500/30'
                : 'bg-slate-800 text-slate-500 cursor-not-allowed'
            }`}
          >
            {allChecked ? 'Accept Terms & Continue' : 'Please Accept All Terms Above'}
          </button>
        </div>

        <div className="text-center text-xs text-slate-500 border-t border-slate-800 pt-6">
          <p>Warning: Betanalytics.ai provides entertainment and educational content only.</p>
          <p>Gambling involves risk. Never bet more than you can afford to lose.</p>
          <p>Must be 21+. If you or someone you know has a gambling problem, call 1-800-GAMBLER.</p>
        </div>
      </div>
    </div>
  )
}
