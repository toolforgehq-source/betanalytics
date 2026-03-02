import type { Metadata } from "next";
import localFont from "next/font/local";
import Script from "next/script";
import "./globals.css";
import CredentialStripper from "@/components/CredentialStripper";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

const siteUrl = "https://betanalytics.ai";

export const metadata: Metadata = {
  title: {
    default: "BetAnalytics.ai - AI-Powered Sports Betting Intelligence",
    template: "%s | BetAnalytics.ai",
  },
  description:
    "AI-powered sports betting analytics using Elo ratings. Find edges where our model disagrees with the market. 800+ teams tracked across NBA, NFL, NHL, MLB. Start your 3-day free trial.",
  metadataBase: new URL(siteUrl),
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: siteUrl,
    siteName: "BetAnalytics.ai",
    title: "BetAnalytics.ai - AI-Powered Sports Betting Intelligence",
    description:
      "Elo-based edge detection across NBA, NFL, NHL, MLB & more. Quantified injury adjustments, full methodology transparency. 3-day free trial.",
    images: [
      {
        url: `${siteUrl}/og-image.png`,
        width: 1200,
        height: 630,
        alt: "BetAnalytics.ai - The Sports Betting AI That Shows Its Math",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "BetAnalytics.ai - AI-Powered Sports Betting Intelligence",
    description:
      "Elo-based edge detection across NBA, NFL, NHL, MLB & more. Quantified injury adjustments. 3-day free trial.",
    images: [`${siteUrl}/og-image.png`],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <Script
          src="https://www.googletagmanager.com/gtag/js?id=G-BJF6E7GSH0"
          strategy="afterInteractive"
        />
        <Script id="ga4-init" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', 'G-BJF6E7GSH0');
          `}
        </Script>
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "Organization",
              name: "BetAnalytics.ai",
              url: siteUrl,
              logo: `${siteUrl}/logo.png`,
              description:
                "AI-powered sports betting analytics platform using Elo ratings to find edges the market is missing.",
              contactPoint: {
                "@type": "ContactPoint",
                email: "contact@betanalytics.ai",
                contactType: "customer service",
              },
            }),
          }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "WebApplication",
              name: "BetAnalytics.ai",
              url: siteUrl,
              applicationCategory: "SportsApplication",
              operatingSystem: "Web",
              offers: {
                "@type": "Offer",
                price: "39.00",
                priceCurrency: "USD",
                description:
                  "Full access to AI-powered sports betting analytics with 3-day free trial",
              },
              featureList: [
                "Elo-based edge detection across all major sports",
                "Real-time injury-adjusted probabilities",
                "Player prop analysis",
                "Full methodology transparency",
                "800+ teams tracked",
                "Hourly data updates",
              ],
            }),
          }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                if (typeof window !== 'undefined') {
                  var url = new URL(window.location.href);
                  if (url.username || url.password) {
                    url.username = '';
                    url.password = '';
                    window.location.replace(url.toString());
                  }
                }
              })();
            `,
          }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <CredentialStripper />
        {children}
      </body>
    </html>
  );
}
