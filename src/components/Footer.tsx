'use client'

import Link from 'next/link'

export default function Footer() {
  return (
    <footer className="border-t border-slate-800/50 bg-slate-950/30 backdrop-blur-sm py-4">
      <div className="container mx-auto px-4 text-center text-xs text-slate-500">
        <p>Warning: Betanalytics.ai provides entertainment and educational content only.</p>
        <p>Gambling involves risk. Never bet more than you can afford to lose.</p>
        <p>Must be 21+. If you or someone you know has a gambling problem, call 1-800-GAMBLER.</p>
        <div className="mt-3 flex justify-center gap-4 flex-wrap">
          <Link href="/picks" className="hover:text-slate-300 transition-colors">Model Picks</Link>
          <Link href="/methodology" className="hover:text-slate-300 transition-colors">Methodology</Link>
          <Link href="/pricing" className="hover:text-slate-300 transition-colors">Pricing</Link>
          <Link href="/blog" className="hover:text-slate-300 transition-colors">Blog</Link>
          <Link href="/terms" className="hover:text-slate-300 transition-colors">Terms of Service</Link>
          <Link href="/privacy" className="hover:text-slate-300 transition-colors">Privacy Policy</Link>
          <a href="mailto:contact@betanalytics.ai" className="hover:text-slate-300 transition-colors">contact@betanalytics.ai</a>
        </div>
      </div>
    </footer>
  )
}
