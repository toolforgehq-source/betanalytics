import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

// Paid signup is retired; direct visitors to the free public model instead.
export default function PricingPage() {
  redirect('/picks')
}
