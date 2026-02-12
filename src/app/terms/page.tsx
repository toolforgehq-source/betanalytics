import Link from 'next/link'
import Logo from '@/components/Logo'
import Footer from '@/components/Footer'
import MobileNav from '@/components/MobileNav'

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-blue-950 to-slate-900 text-white flex flex-col">
            <header className="border-b border-slate-800/50 bg-slate-950/30 backdrop-blur-sm relative">
              <div className="container mx-auto px-4 py-4">
                <div className="flex items-center justify-between">
                  <Link href="/">
                    <Logo />
                  </Link>
            
                  {/* Desktop Navigation */}
                  <div className="hidden md:flex items-center gap-4">
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

                  {/* Mobile Navigation */}
                  <MobileNav />
                </div>
              </div>
            </header>

      <main className="flex-1 py-12 px-4">
        <div className="container mx-auto max-w-4xl">
          <h1 className="text-4xl font-bold mb-8">Terms of Service</h1>
          
          <div className="prose prose-invert max-w-none space-y-8">
            <p className="text-slate-300 text-lg">
              Last updated: January 2026
            </p>

            <section>
              <h2 className="text-2xl font-semibold mb-4">1. Acceptance of Terms</h2>
              <p className="text-slate-300">
                By accessing and using Betanalytics.ai (&quot;the Service&quot;), you agree to be bound by these Terms of Service. If you do not agree to these terms, please do not use the Service.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4">2. Service Description</h2>
              <p className="text-slate-300">
                Betanalytics.ai is an AI-powered sports betting analysis platform that provides statistical analysis, educational content, and betting insights. The Service is intended for entertainment and educational purposes only.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4">3. Age Requirement</h2>
              <p className="text-slate-300">
                You must be at least 21 years old (or the legal gambling age in your jurisdiction, whichever is higher) to use this Service. By using the Service, you represent and warrant that you meet this age requirement.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4">4. No Guarantee of Results</h2>
              <p className="text-slate-300">
                <strong className="text-white">IMPORTANT:</strong> Betanalytics.ai does not guarantee any wins, profits, or specific outcomes. All analysis and recommendations are based on statistical models and may be incorrect. Past performance does not guarantee future results. Sports betting involves significant financial risk, and you may lose money.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4">5. User Responsibilities</h2>
              <p className="text-slate-300">
                You are solely responsible for your betting decisions. You agree to:
              </p>
              <ul className="list-disc list-inside text-slate-300 mt-2 space-y-2">
                <li>Only bet what you can afford to lose</li>
                <li>Comply with all gambling laws in your jurisdiction</li>
                <li>Verify that online betting is legal where you live</li>
                <li>Not rely solely on our analysis for betting decisions</li>
                <li>Practice responsible gambling</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4">6. Limitation of Liability</h2>
              <p className="text-slate-300">
                To the maximum extent permitted by law, Betanalytics.ai and its owners, operators, employees, and affiliates shall not be liable for any direct, indirect, incidental, special, consequential, or punitive damages, including but not limited to financial losses, arising from your use of the Service.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4">7. Subscription and Billing</h2>
              <p className="text-slate-300">
                The Service is offered on a subscription basis at $39 per month. Subscriptions automatically renew unless canceled. You may cancel at any time through your account settings or by contacting support.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4">8. Intellectual Property</h2>
              <p className="text-slate-300">
                All content, analysis, and materials provided through the Service are the intellectual property of Betanalytics.ai. You may not reproduce, distribute, or create derivative works without our express written permission.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4">9. Termination</h2>
              <p className="text-slate-300">
                We reserve the right to terminate or suspend your account at any time for violation of these terms or for any other reason at our sole discretion.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4">10. Changes to Terms</h2>
              <p className="text-slate-300">
                We may update these Terms of Service from time to time. Continued use of the Service after changes constitutes acceptance of the new terms.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4">11. Contact</h2>
              <p className="text-slate-300">
                For questions about these Terms of Service, please contact us at contact@betanalytics.ai.
              </p>
            </section>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  )
}
