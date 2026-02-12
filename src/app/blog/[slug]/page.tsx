import Link from 'next/link'
import Image from 'next/image'
import { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getAllBlogPosts, getBlogPost } from '@/content/blog'
import Footer from '@/components/Footer'
import MobileNav from '@/components/MobileNav'

interface Props {
  params: { slug: string }
}

export async function generateStaticParams() {
  return getAllBlogPosts().map((post) => ({ slug: post.slug }))
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const post = getBlogPost(params.slug)
  if (!post) return {}

  return {
    title: post.title,
    description: post.description,
    alternates: {
      canonical: `/blog/${post.slug}`,
    },
    openGraph: {
      title: post.title,
      description: post.description,
      url: `https://betanalytics.ai/blog/${post.slug}`,
      type: 'article',
      publishedTime: post.publishedAt,
      modifiedTime: post.updatedAt || post.publishedAt,
      authors: [post.author],
      tags: post.tags,
    },
    twitter: {
      card: 'summary_large_image',
      title: post.title,
      description: post.description,
    },
  }
}

function extractHeadings(content: string): { id: string; text: string; level: number }[] {
  const headings: { id: string; text: string; level: number }[] = []
  const lines = content.split('\n')
  for (const line of lines) {
    const match = line.match(/^(#{2,3})\s+(.+)$/)
    if (match) {
      const level = match[1].length
      const text = match[2]
      const id = text
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .trim()
      headings.push({ id, text, level })
    }
  }
  return headings
}

function renderContent(content: string): React.ReactNode[] {
  const lines = content.split('\n')
  const elements: React.ReactNode[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    if (line.startsWith('## ')) {
      const text = line.slice(3)
      const id = text
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .trim()
      elements.push(
        <h2 key={i} id={id} className="text-2xl font-bold mt-10 mb-4 scroll-mt-24">
          {text}
        </h2>
      )
      i++
      continue
    }

    if (line.startsWith('### ')) {
      const text = line.slice(4)
      const id = text
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .trim()
      elements.push(
        <h3 key={i} id={id} className="text-xl font-semibold mt-8 mb-3 scroll-mt-24">
          {text}
        </h3>
      )
      i++
      continue
    }

    if (line.startsWith('|') && lines[i + 1]?.match(/^\|[\s-|]+$/)) {
      const tableLines: string[] = []
      while (i < lines.length && lines[i].startsWith('|')) {
        tableLines.push(lines[i])
        i++
      }
      const headerCells = tableLines[0].split('|').filter(Boolean).map((c) => c.trim())
      const bodyRows = tableLines.slice(2)

      elements.push(
        <div key={`table-${i}`} className="overflow-x-auto my-6">
          <table className="w-full text-sm border border-slate-700/50 rounded-lg">
            <thead>
              <tr className="text-left text-slate-400 border-b border-slate-700">
                {headerCells.map((cell, ci) => (
                  <th key={ci} className="px-4 py-2">{cell}</th>
                ))}
              </tr>
            </thead>
            <tbody className="text-slate-300">
              {bodyRows.map((row, ri) => {
                const cells = row.split('|').filter(Boolean).map((c) => c.trim())
                return (
                  <tr key={ri} className="border-b border-slate-800/50">
                    {cells.map((cell, ci) => (
                      <td key={ci} className="px-4 py-2">{cell}</td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )
      continue
    }

    if (line.startsWith('- ') || line.startsWith('* ')) {
      const listItems: string[] = []
      while (i < lines.length && (lines[i].startsWith('- ') || lines[i].startsWith('* '))) {
        listItems.push(lines[i].slice(2))
        i++
      }
      elements.push(
        <ul key={`ul-${i}`} className="space-y-2 my-4 ml-4">
          {listItems.map((item, li) => (
            <li key={li} className="text-slate-300 flex items-start gap-2">
              <span className="text-cyan-400 mt-1.5 flex-shrink-0">&#8226;</span>
              <span dangerouslySetInnerHTML={{ __html: formatInline(item) }} />
            </li>
          ))}
        </ul>
      )
      continue
    }

    if (/^\d+\.\s/.test(line)) {
      const listItems: string[] = []
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        listItems.push(lines[i].replace(/^\d+\.\s/, ''))
        i++
      }
      elements.push(
        <ol key={`ol-${i}`} className="space-y-2 my-4 ml-4 list-decimal list-inside">
          {listItems.map((item, li) => (
            <li key={li} className="text-slate-300">
              <span dangerouslySetInnerHTML={{ __html: formatInline(item) }} />
            </li>
          ))}
        </ol>
      )
      continue
    }

    if (line.trim() === '') {
      i++
      continue
    }

    elements.push(
      <p
        key={i}
        className="text-slate-300 leading-relaxed my-4"
        dangerouslySetInnerHTML={{ __html: formatInline(line) }}
      />
    )
    i++
  }

  return elements
}

function formatInline(text: string): string {
  return text
    .replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      '<a href="$2" class="text-cyan-400 hover:text-cyan-300 underline">$1</a>'
    )
    .replace(/\*\*([^*]+)\*\*/g, '<strong class="text-white font-semibold">$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code class="px-1.5 py-0.5 bg-slate-800 rounded text-cyan-300 text-sm">$1</code>')
}

export default function BlogPostPage({ params }: Props) {
  const post = getBlogPost(params.slug)
  if (!post) notFound()

  const allPosts = getAllBlogPosts()
  const relatedPosts = allPosts
    .filter((p) => p.slug !== post.slug && p.tags.some((t) => post.tags.includes(t)))
    .slice(0, 3)

  const headings = extractHeadings(post.content)

  const articleSchema = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: post.title,
    description: post.description,
    datePublished: post.publishedAt,
    dateModified: post.updatedAt || post.publishedAt,
    author: {
      '@type': 'Organization',
      name: post.author,
      url: 'https://betanalytics.ai',
    },
    publisher: {
      '@type': 'Organization',
      name: 'BetAnalytics.ai',
      logo: {
        '@type': 'ImageObject',
        url: 'https://betanalytics.ai/logo.png',
      },
    },
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': `https://betanalytics.ai/blog/${post.slug}`,
    },
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-blue-950 to-slate-900 text-white flex flex-col">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleSchema) }}
      />

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
            <Link href="/blog" className="hover:text-white transition-colors">Blog</Link>
            <span className="mx-2">/</span>
            <span className="text-white">{post.title}</span>
          </nav>

          <div className="flex gap-12">
            <article className="flex-1 min-w-0">
              <div className="flex flex-wrap gap-2 mb-4">
                {post.tags.map((tag) => (
                  <span
                    key={tag}
                    className="px-2 py-0.5 bg-blue-500/10 border border-blue-500/20 rounded-full text-xs text-blue-300"
                  >
                    {tag.replace(/-/g, ' ')}
                  </span>
                ))}
              </div>

              <h1 className="text-3xl md:text-4xl font-bold mb-4">{post.title}</h1>

              <div className="flex flex-wrap items-center gap-4 text-sm text-slate-400 mb-8 pb-8 border-b border-slate-800/50">
                <span>{post.author}</span>
                <span>{new Date(post.publishedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</span>
                <span>{post.readingTime}</span>
              </div>

              <div className="prose-custom">
                {renderContent(post.content)}
              </div>

              <div className="mt-12 bg-gradient-to-br from-blue-900/20 to-cyan-900/20 backdrop-blur-sm border border-blue-500/30 rounded-2xl p-8 text-center">
                <h3 className="text-2xl font-bold mb-3">Find Today&apos;s Best Betting Edges</h3>
                <p className="text-slate-300 mb-6">
                  Our Elo model analyzes every game across NBA, NFL, NHL, MLB, college sports, and soccer. See where our probability disagrees with the market.
                </p>
                <Link
                  href="/signup"
                  className="inline-block px-8 py-4 bg-gradient-to-r from-blue-500 to-cyan-400 hover:from-blue-600 hover:to-cyan-500 rounded-xl font-semibold text-lg transition-all shadow-lg shadow-blue-500/30"
                >
                  Start Your 3-Day Free Trial
                </Link>
                <p className="text-sm text-slate-400 mt-3">No credit card required. $39/month after trial.</p>
              </div>

              {relatedPosts.length > 0 && (
                <div className="mt-12">
                  <h3 className="text-xl font-bold mb-6">Related Articles</h3>
                  <div className="grid md:grid-cols-3 gap-4">
                    {relatedPosts.map((related) => (
                      <Link
                        key={related.slug}
                        href={`/blog/${related.slug}`}
                        className="group bg-slate-900/30 border border-slate-800/50 rounded-xl p-4 hover:border-blue-500/30 transition-all"
                      >
                        <h4 className="font-semibold text-sm mb-2 group-hover:text-cyan-300 transition-colors line-clamp-2">
                          {related.title}
                        </h4>
                        <p className="text-xs text-slate-500">{related.readingTime}</p>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </article>

            <aside className="hidden lg:block w-64 flex-shrink-0">
              <div className="sticky top-8">
                {headings.length > 0 && (
                  <div className="bg-slate-900/30 border border-slate-800/50 rounded-xl p-4 mb-6">
                    <h4 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-3">
                      Table of Contents
                    </h4>
                    <nav className="space-y-2">
                      {headings.map((heading) => (
                        <a
                          key={heading.id}
                          href={`#${heading.id}`}
                          className={`block text-sm hover:text-cyan-300 transition-colors ${
                            heading.level === 3 ? 'pl-4 text-slate-500' : 'text-slate-400'
                          }`}
                        >
                          {heading.text}
                        </a>
                      ))}
                    </nav>
                  </div>
                )}

                <div className="bg-gradient-to-br from-blue-900/20 to-cyan-900/20 border border-blue-500/30 rounded-xl p-4">
                  <p className="text-sm font-semibold mb-2">Try BetAnalytics.ai</p>
                  <p className="text-xs text-slate-400 mb-3">
                    Elo-based edge detection across all major sports. 3-day free trial.
                  </p>
                  <Link
                    href="/signup"
                    className="block text-center px-4 py-2 bg-gradient-to-r from-blue-500 to-cyan-400 hover:from-blue-600 hover:to-cyan-500 rounded-lg text-sm font-semibold transition-all"
                  >
                    Start Free Trial
                  </Link>
                </div>
              </div>
            </aside>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  )
}
