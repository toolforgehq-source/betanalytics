import Link from 'next/link'
import Logo from '@/components/Logo'
import Footer from '@/components/Footer'

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-blue-950 to-slate-900 text-white flex flex-col">
      <header className="border-b border-slate-800/50 bg-slate-950/30 backdrop-blur-sm">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <Link href="/">
              <Logo />
            </Link>
            
            <div className="flex items-center gap-4">
              <Link href="/methodology" className="text-slate-300 hover:text-white transition-colors">
                Methodology
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
          </div>
        </div>
      </header>

      <main className="flex-1 py-12 px-4">
        <div className="container mx-auto max-w-4xl">
          <h1 className="text-4xl font-bold mb-8">Privacy Policy</h1>
          
          <div className="prose prose-invert max-w-none space-y-8">
            <p className="text-slate-300 text-lg">
              Last updated: January 2026
            </p>

            <section>
              <h2 className="text-2xl font-semibold mb-4">1. Information We Collect</h2>
              <p className="text-slate-300">
                We collect the following types of information:
              </p>
              <ul className="list-disc list-inside text-slate-300 mt-2 space-y-2">
                <li><strong className="text-white">Account Information:</strong> Email address, name (optional), and encrypted password</li>
                <li><strong className="text-white">Usage Data:</strong> Chat messages, questions asked, and interaction history</li>
                <li><strong className="text-white">Payment Information:</strong> Processed securely through Stripe; we do not store credit card numbers</li>
                <li><strong className="text-white">Technical Data:</strong> IP address, browser type, and device information</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4">2. How We Use Your Information</h2>
              <p className="text-slate-300">
                We use your information to:
              </p>
              <ul className="list-disc list-inside text-slate-300 mt-2 space-y-2">
                <li>Provide and improve our AI analysis service</li>
                <li>Process payments and manage subscriptions</li>
                <li>Communicate with you about your account</li>
                <li>Ensure compliance with our terms of service</li>
                <li>Analyze usage patterns to improve the Service</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4">3. Third-Party Services</h2>
              <p className="text-slate-300">
                We use the following third-party services:
              </p>
              <ul className="list-disc list-inside text-slate-300 mt-2 space-y-2">
                <li><strong className="text-white">Stripe:</strong> For payment processing. Stripe&apos;s privacy policy applies to payment data.</li>
                <li><strong className="text-white">Anthropic:</strong> For AI analysis. Your questions are processed by Claude AI to generate responses.</li>
                <li><strong className="text-white">Vercel:</strong> For hosting and infrastructure.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4">4. Data Storage and Security</h2>
              <p className="text-slate-300">
                We implement industry-standard security measures to protect your data. Passwords are encrypted using bcrypt. All data transmission is encrypted using HTTPS. However, no method of transmission over the Internet is 100% secure.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4">5. Data Retention</h2>
              <p className="text-slate-300">
                We retain your account information and chat history for as long as your account is active. You may request deletion of your data at any time by contacting support.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4">6. Your Rights</h2>
              <p className="text-slate-300">
                You have the right to:
              </p>
              <ul className="list-disc list-inside text-slate-300 mt-2 space-y-2">
                <li>Access your personal data</li>
                <li>Request correction of inaccurate data</li>
                <li>Request deletion of your data</li>
                <li>Export your data</li>
                <li>Opt out of marketing communications</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4">7. Cookies</h2>
              <p className="text-slate-300">
                We use essential cookies for authentication and session management. We do not use tracking cookies for advertising purposes.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4">8. Children&apos;s Privacy</h2>
              <p className="text-slate-300">
                Our Service is not intended for anyone under 21 years of age. We do not knowingly collect personal information from individuals under 21.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4">9. Changes to This Policy</h2>
              <p className="text-slate-300">
                We may update this Privacy Policy from time to time. We will notify you of any changes by posting the new policy on this page and updating the &quot;Last updated&quot; date.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4">10. Contact Us</h2>
              <p className="text-slate-300">
                For questions about this Privacy Policy, please contact us at contact@betanalytics.ai.
              </p>
            </section>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  )
}
