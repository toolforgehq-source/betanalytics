import Link from 'next/link'
import Logo from '@/components/Logo'
import MobileNav from '@/components/MobileNav'
import Footer from '@/components/Footer'
import ChatInterface from '@/components/ChatInterface'

export const dynamic = 'force-dynamic'
export const metadata = {
  title: 'Free Elo Model Assistant | BetAnalytics',
  description: 'Explore BetAnalytics official Elo-rated picks without a login, trial or subscription.',
}

export default function ChatPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-blue-950 to-slate-900 text-white flex flex-col">
      <header className="border-b border-slate-800/50 bg-slate-950/30 sticky top-0 z-20">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/"><Logo /></Link>
          <nav className="hidden md:flex items-center gap-6 text-sm">
            <Link href="/picks" className="text-cyan-300 hover:text-white">Model Picks</Link>
            <Link href="/performance" className="text-slate-300 hover:text-white">Performance</Link>
            <Link href="/odds" className="text-slate-300 hover:text-white">Odds Board</Link>
          </nav>
          <MobileNav />
        </div>
      </header>
      <main className="flex-1 container max-w-4xl mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold mb-2">Free Elo Model Assistant</h1>
        <p className="text-slate-300 mb-5">
          Ask for the currently qualifying Elo picks. No account, payment or trial is required.
          The free assistant reports published model calculations, not guaranteed winners.
        </p>
        <ChatInterface isSubscribed={true} questionsRemaining={-1} trialDaysRemaining={0} />
      </main>
      <Footer />
    </div>
  )
}
