'use client'

import { useEffect } from 'react'

export default function CredentialStripper() {
  useEffect(() => {
    if (typeof window !== 'undefined') {
      // Inject a <base> tag to ensure all relative URLs resolve against the clean origin
      // This fixes NextAuth's internal fetch calls which use relative URLs
      const existingBase = document.querySelector('base')
      if (!existingBase) {
        const base = document.createElement('base')
        base.href = window.location.origin + '/'
        document.head.prepend(base)
      }
      
      // Also check if the URL contains credentials (user:pass@)
      // and redirect to the clean URL
      const url = new URL(window.location.href)
      if (url.username || url.password) {
        url.username = ''
        url.password = ''
        window.location.replace(url.toString())
      }
    }
  }, [])

  return null
}
