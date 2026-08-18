import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

// The app layout's <main> is a flex child. Without min-w-0 it will not shrink below its content's
// intrinsic width, so a wide table stretches the whole page and it scrolls sideways on mobile — the
// exact bug this guards against. It's a one-property fix a refactor could silently drop and nothing
// else would catch, so assert it directly from the source. (Server component with auth/redirect, so
// a source assertion is the practical check rather than a render.)
const layoutSrc = readFileSync(path.join(process.cwd(), 'src/app/(app)/layout.tsx'), 'utf8')

const mainClass = layoutSrc.match(/<main className="([^"]*)"/)?.[1] ?? ''
const innerClass = layoutSrc.match(/<div className="([^"]*)">\{children\}/)?.[1] ?? ''

describe('app layout — mobile overflow guard', () => {
  it('the flex <main> carries min-w-0 so wide content scrolls in its container, not the page', () => {
    expect(mainClass).toContain('min-w-0')
  })

  it('the inner content wrapper also carries min-w-0', () => {
    expect(innerClass).toContain('min-w-0')
  })

  it('keeps overflow-x-clip on main as a page-level safety net', () => {
    expect(mainClass).toContain('overflow-x-clip')
  })
})
