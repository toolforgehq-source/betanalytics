import { getAllBlogPosts } from '@/content/blog'

export async function GET() {
  const posts = getAllBlogPosts()
  const siteUrl = 'https://betanalytics.ai'

  const rssItems = posts
    .map(
      (post) => `
    <item>
      <title><![CDATA[${post.title}]]></title>
      <link>${siteUrl}/blog/${post.slug}</link>
      <guid isPermaLink="true">${siteUrl}/blog/${post.slug}</guid>
      <description><![CDATA[${post.description}]]></description>
      <pubDate>${new Date(post.publishedAt).toUTCString()}</pubDate>
      <author>contact@betanalytics.ai (${post.author})</author>
      ${post.tags.map((tag) => `<category>${tag}</category>`).join('\n      ')}
    </item>`
    )
    .join('')

  const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>BetAnalytics.ai Blog</title>
    <link>${siteUrl}/blog</link>
    <description>Data-driven sports betting articles covering Elo ratings, value betting, bankroll management, and analytics.</description>
    <language>en-us</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <atom:link href="${siteUrl}/blog/feed.xml" rel="self" type="application/rss+xml" />${rssItems}
  </channel>
</rss>`

  return new Response(rss, {
    headers: {
      'Content-Type': 'application/xml',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  })
}
