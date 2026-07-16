'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      // Always report success — do not reveal whether the account exists.
      setSent(true)
    } finally {
      setLoading(false)
    }
  }

  if (sent) {
    return (
      <div>
        <h1 className="text-2xl font-semibold text-fg">Check your email</h1>
        <p className="mt-2 text-sm text-fg-muted">
          If an account exists for <span className="font-medium text-fg">{email}</span>, we&apos;ve
          sent a link to reset your password. The link expires in 1 hour.
        </p>
        <Link
          href="/login"
          className="mt-6 inline-block text-sm font-medium text-primary hover:underline"
        >
          ← Back to sign in
        </Link>
      </div>
    )
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-fg">Forgot password</h1>
      <p className="mt-1 text-sm text-fg-muted">
        Enter your email and we&apos;ll send you a link to reset it.
      </p>

      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        <Input
          label="Email"
          type="email"
          autoComplete="email"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoFocus
        />
        <Button type="submit" fullWidth size="lg" loading={loading}>
          Send reset link
        </Button>
      </form>

      <Link
        href="/login"
        className="mt-6 inline-block text-sm font-medium text-primary hover:underline"
      >
        ← Back to sign in
      </Link>
    </div>
  )
}
