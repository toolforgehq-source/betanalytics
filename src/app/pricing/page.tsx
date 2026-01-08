import { auth } from "@/auth"
import Link from 'next/link'
import { CheckCircle } from 'lucide-react'
import Logo from '@/components/Logo'
import Footer from '@/components/Footer'
import PricingClient from './PricingClient'

// Force dynamic rendering to prevent caching issues with auth
export const dynamic = "force-dynamic"

export default async function PricingPage() {
  const session = await auth()
  const isLoggedIn = !!session?.user

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-blue-950 to-slate-900 text-white flex flex-col">
      <header className="border-b border-slate-800/50 bg-slate-950/30 backdrop-blur-sm">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <Link href={isLoggedIn ? "/chat" : "/"}>
              <Logo />
            </Link>
            
            <div className="flex items-center gap-4">
              {isLoggedIn ? (
                <>
                  <Link href="/chat" className="text-slate-300 hover:text-white transition-colors">
                    Back to Chat
                  </Link>
                  <Link 
                    href="/account" 
                    className="px-4 py-2 bg-gradient-to-r from-blue-500 to-cyan-400 hover:from-blue-600 hover:to-cyan-500 rounded-xl font-semibold transition-all shadow-lg shadow-blue-500/30"
                  >
                    My Account
                  </Link>
                </>
              ) : (
                <>
                  <Link href="/login" className="text-slate-300 hover:text-white transition-colors">
                    Sign In
                  </Link>
                  <Link 
                    href="/signup" 
                    className="px-4 py-2 bg-gradient-to-r from-blue-500 to-cyan-400 hover:from-blue-600 hover:to-cyan-500 rounded-xl font-semibold transition-all shadow-lg shadow-blue-500/30"
                  >
                    Start Free Trial
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 py-16 px-4">
        <div className="container mx-auto max-w-4xl">
          <div className="text-center mb-12">
            <h1 className="text-4xl font-bold mb-4">Simple, Transparent Pricing</h1>
            <p className="text-xl text-slate-300">
              One plan. Everything included. Cancel anytime.
            </p>
          </div>

          <div className="bg-gradient-to-br from-blue-900/20 to-cyan-900/20 backdrop-blur-sm border border-blue-500/30 rounded-2xl p-8 max-w-lg mx-auto">
            <div className="text-center mb-8">
              <h2 className="text-2xl font-bold mb-2">Betanalytics.ai Premium</h2>
              <div className="text-5xl font-bold mb-2">
                $69<span className="text-xl text-slate-400">/month</span>
              </div>
              <p className="text-slate-400">Billed monthly. Cancel anytime.</p>
            </div>

            <div className="space-y-4 mb-8">
              <Feature text="Unlimited AI questions" />
              <Feature text="All sports covered (NFL, NBA, MLB, NHL, Soccer, etc.)" />
              <Feature text="All platforms (DraftKings, FanDuel, PrizePicks, Underdog)" />
              <Feature text="Multi-model consensus analysis" />
              <Feature text="Educational insights with every pick" />
              <Feature text="Hedge calculator" />
              <Feature text="Player prop analysis" />
              <Feature text="Parlay builder assistance" />
              <Feature text="Arbitrage opportunity finder" />
              <Feature text="Bet tracking dashboard (coming soon)" />
              <Feature text="Real-time alerts (coming soon)" />
            </div>

            <PricingClient isLoggedIn={isLoggedIn} />
          </div>

          <div className="mt-12 text-center">
            <h3 className="text-xl font-semibold mb-4">Frequently Asked Questions</h3>
            <div className="space-y-6 text-left max-w-2xl mx-auto">
              <FAQ 
                question="What sports do you cover?"
                answer="We cover all major sports including NFL, NBA, MLB, NHL, college sports, soccer, tennis, golf, MMA, and more."
              />
              <FAQ 
                question="What betting platforms do you support?"
                answer="We provide analysis for all major platforms including DraftKings, FanDuel, PrizePicks, Underdog, BetMGM, Caesars, and more."
              />
              <FAQ 
                question="How does the free trial work?"
                answer="You get 3 free questions to try the service. No credit card required. After that, you'll need to subscribe to continue."
              />
              <FAQ 
                question="Can I cancel anytime?"
                answer="Yes! You can cancel your subscription at any time. You'll continue to have access until the end of your billing period."
              />
              <FAQ 
                question="Do you guarantee wins?"
                answer="No. We provide statistical analysis and educational content only. Sports betting involves risk and we never guarantee wins or profits."
              />
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  )
}

function Feature({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-3">
      <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0" />
      <span className="text-slate-300">{text}</span>
    </div>
  )
}

function FAQ({ question, answer }: { question: string; answer: string }) {
  return (
    <div className="bg-slate-900/30 backdrop-blur-sm border border-slate-800/50 rounded-xl p-6">
      <h4 className="font-semibold mb-2">{question}</h4>
      <p className="text-slate-400 text-sm">{answer}</p>
    </div>
  )
}
