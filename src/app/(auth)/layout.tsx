import { Logo } from '@/components/ui/Logo'

/**
 * Split-screen auth shell (inherited PMIS login design): red left panel with a
 * subtle cross pattern and the brand mark; white form panel on the right. On
 * mobile only the form panel shows, with a compact logo at the top.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-surface">
      {/* Left brand panel */}
      <div className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-primary p-10 text-white lg:flex">
        <svg
          aria-hidden
          className="pointer-events-none absolute inset-0 h-full w-full text-white/10"
          width="100%"
          height="100%"
        >
          <defs>
            <pattern id="crosses" width="48" height="48" patternUnits="userSpaceOnUse">
              <path d="M20 12h8v8h8v8h-8v8h-8v-8h-8v-8h8v-8z" fill="currentColor" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#crosses)" />
        </svg>

        <div className="relative">
          <Logo size={40} withWordmark inverted />
        </div>
        <div className="relative">
          <h1 className="text-3xl font-semibold leading-tight">
            Daily site reporting,
            <br />
            made simple.
          </h1>
          <p className="mt-3 max-w-sm text-white/80">
            Log in to submit and review daily reports across your projects.
          </p>
        </div>
        <div className="relative text-sm text-white/60">
          © {new Date().getFullYear()} Eversystems Management
        </div>
      </div>

      {/* Right form panel */}
      <div className="flex w-full flex-col items-center justify-center px-5 py-10 lg:w-1/2">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <Logo size={36} withWordmark />
          </div>
          {children}
        </div>
      </div>
    </div>
  )
}
