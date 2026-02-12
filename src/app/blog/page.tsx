import Link from 'next/link'
import Image from 'next/image'
import { Metadata } from 'next'
import { getAllBlogPosts, getAllTags } from '@/content/blog'
import Footer from '@/components/Footer'
import MobileNav from '@/components/MobileNav'

export const metadata: Metadata = {
  title: 'Sports Betting Blog | Elo Ratings, Strategy & Analytics',
  description:
    'Data-driven sports betting articles covering Elo ratings, value betting, bankroll management, injury analysis, and betting strategy across NBA, NFL, NHL, MLB.',
  alternates: {
    canonical: '/blog',
  },
  openGraph: {
    title: 'Sports Betting Blog | BetAnalytics.ai',
    description:
      'Data-driven sports betting articles. Learn Elo ratings, value betting strategy, bankroll management, and injury analysis.',
    url: 'https://betanalytics.ai/blog',
    type: 'website',
  },
}

export default function BlogPage() {
  const posts = getAllBlogPosts()
  const tags = getAllTags()

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-blue-950 to-slate-900 text-white flex flex-col">
      <header className="border-b border-slate-800/50 bg-slate-950/30 backdrop-blur-sm relative">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <Link href="/" className="flex items-center gap-3">
              <Image
                src="/logo.png"
                alt="BetAnalytics.ai Logo"
                width={48}
                height={48}
              />
              <div>
                <span className="text-xl font-bold bg-gradient-to-r from-blue-400 to-cyan-300 bg-clip-text text-transparent">
                  BetAnalytics.ai
                </span>
                <p className="text-xs text-slate-400">Elo-Powered Sports Betting Intelligence</p>
              </div>
            </Link>

            <div className="hidden md:flex items-center gap-4">
              <Link href="/methodology" className="text-slate-300 hover:text-white transition-colors">
                Methodology
              </Link>
              <Link href="/blog" className="text-white font-medium transition-colors">
                Blog
              </Link>
              <Link href="/login" className="text-slate-300 hover:text-white transition-colors">
                Sign In
              </Link>
              <Link
                href="/signup"
                className="px-4 py-2 bg-gradient-to-r from-blue-500 to-cyan-400 hover:from-blue-600 hover:to-cyan-500 rounded-xl font-semibold transition-all shadow-lg shadow-blue-500/30"
              >
                Start Free Trial
              </Link>
            </div>

            <MobileNav />
          </div>
        </div>
      </header>

      <main className="flex-1 py-12 px-4">
        <div className="container mx-auto max-w-5xl">
          <nav className="mb-8 text-sm text-slate-400">
            <Link href="/" className="hover:text-white transition-colors">Home</Link>
            <span className="mx-2">/</span>
            <span className="text-white">Blog</span>
          </nav>

          <h1 className="text-4xl font-bold mb-4">
            Sports Betting{' '}
            <span className="bg-gradient-to-r from-blue-400 to-cyan-300 bg-clip-text text-transparent">
              Blog
            </span>
          </h1>
          <p className="text-xl text-slate-300 mb-8">
            Data-driven articles on Elo ratings, value betting, bankroll management, and sports analytics.
          </p>

          <div className="flex flex-wrap gap-2 mb-12">
            {tags.map((tag) => (
              <span
                key={tag}
                className="px-3 py-1 bg-slate-800/50 border border-slate-700/50 rounded-full text-sm text-slate-300"
              >
                {tag.replace(/-/g, ' ')}
              </span>
            ))}
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            {posts.map((post) => (
              <Link
                key={post.slug}
                href={`/blog/${post.slug}`}
                className="group bg-slate-900/30 backdrop-blur-sm border border-slate-800/50 rounded-2xl p-6 hover:border-blue-500/30 transition-all"
              >
                <div className="flex flex-wrap gap-2 mb-3">
                  {post.tags.map((tag) => (
                    <span
                      key={tag}
                      className="px-2 py-0.5 bg-blue-500/10 border border-blue-500/20 rounded-full text-xs text-blue-300"
                    >
                      {tag.replace(/-/g, ' ')}
                    </span>
                  ))}
                </div>
                <h2 className="text-xl font-semibold mb-2 group-hover:text-cyan-300 transition-colors">
                  {post.title}
                </h2>
                <p className="text-slate-400 text-sm mb-4 line-clamp-2">
                  {post.description}
                </p>
                <div className="flex items-center gap-4 text-xs text-slate-500">
                  <span>{post.author}</span>
                  <span>{post.readingTime}</span>
                  <span>{new Date(post.publishedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</span>
                </div>
              </Link>
            ))}
          </div>

          <div className="mt-16 text-center bg-gradient-to-br from-blue-900/20 to-cyan-900/20 backdrop-blur-sm border border-blue-500/30 rounded-2xl p-8">
            <h2 className="text-2xl font-bold mb-3">Ready to Find Edges The Market Is Missing?</h2>
            <p className="text-slate-300 mb-6">
              Our Elo rating system tracks 692 teams with real-time injury adjustments across every major sport.
            </p>
            <Link
              href="/signup"
              className="inline-block px-8 py-4 bg-gradient-to-r from-blue-500 to-cyan-400 hover:from-blue-600 hover:to-cyan-500 rounded-xl font-semibold text-lg transition-all shadow-lg shadow-blue-500/30"
            >
              Start Your 3-Day Free Trial
            </Link>
            <p className="text-sm text-slate-400 mt-3">No credit card required. $39/month after trial.</p>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  )
}
