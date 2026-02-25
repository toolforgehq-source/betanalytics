'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Menu, X } from 'lucide-react'

export default function MobileNav() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  return (
    <>
      {/* Mobile Hamburger Button */}
      <button
        onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        className="md:hidden flex items-center justify-center w-10 h-10 bg-slate-800/50 hover:bg-slate-700/50 rounded-lg transition-colors"
        aria-label="Toggle menu"
      >
        {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
      </button>

      {/* Mobile Navigation Menu */}
      {mobileMenuOpen && (
        <div className="md:hidden absolute top-full left-0 right-0 bg-slate-950/95 backdrop-blur-sm border-b border-slate-800/50 px-4 py-4 space-y-2 z-50">
          <Link 
            href="/picks" 
            className="block w-full px-4 py-3 bg-slate-800/50 hover:bg-slate-700/50 rounded-lg transition-colors text-sm text-slate-300 hover:text-white"
            onClick={() => setMobileMenuOpen(false)}
          >
            Model Picks
          </Link>
          <Link 
            href="/performance" 
            className="block w-full px-4 py-3 bg-slate-800/50 hover:bg-slate-700/50 rounded-lg transition-colors text-sm text-slate-300 hover:text-white"
            onClick={() => setMobileMenuOpen(false)}
          >
            Performance
          </Link>
          <Link 
            href="/odds" 
            className="block w-full px-4 py-3 bg-slate-800/50 hover:bg-slate-700/50 rounded-lg transition-colors text-sm text-slate-300 hover:text-white"
            onClick={() => setMobileMenuOpen(false)}
          >
            Odds Board
          </Link>
          <Link 
            href="/methodology" 
            className="block w-full px-4 py-3 bg-slate-800/50 hover:bg-slate-700/50 rounded-lg transition-colors text-sm text-slate-300 hover:text-white"
            onClick={() => setMobileMenuOpen(false)}
          >
            Methodology
          </Link>
          <Link 
            href="/login" 
            className="block w-full px-4 py-3 bg-slate-800/50 hover:bg-slate-700/50 rounded-lg transition-colors text-sm text-slate-300 hover:text-white"
            onClick={() => setMobileMenuOpen(false)}
          >
            Sign In
          </Link>
          <Link 
            href="/signup" 
            className="block w-full px-4 py-3 bg-gradient-to-r from-blue-500 to-cyan-400 hover:from-blue-600 hover:to-cyan-500 rounded-lg transition-colors text-sm font-semibold text-white text-center"
            onClick={() => setMobileMenuOpen(false)}
          >
            Start Free Trial
          </Link>
        </div>
      )}
    </>
  )
}
