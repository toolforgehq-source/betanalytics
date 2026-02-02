import type { Metadata } from "next";
import localFont from "next/font/local";
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

export const metadata: Metadata = {
  title: "Betanalytics.ai - AI-Powered Sports Betting Intelligence",
  description: "Get AI-powered sports betting analysis and insights",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              // Immediately redirect to clean URL if credentials are present
              // This must run before Next.js tries to use history.replaceState
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
