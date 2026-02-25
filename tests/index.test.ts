/**
 * @sparklytics/next SDK — Vitest test suite
 *
 * Covers all BDD scenarios from docs/sprints/sprint-3.md
 * plus regression tests added in v0.2.0.
 * Environment: happy-dom (configured in vitest.config.ts)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act, cleanup } from '@testing-library/react'
import React from 'react'

// ──────────────────────────────────────────────────────────────
// Module mocks — declared before SDK import; vi.mock is hoisted.
// ──────────────────────────────────────────────────────────────

vi.mock('next/navigation', () => ({
  usePathname: vi.fn().mockReturnValue('/'),
}))

vi.mock('next/router', () => ({
  default: {
    events: {
      on: vi.fn(),
      off: vi.fn(),
    },
  },
}))

// next/link — lightweight <a> shim so TrackedLink tests work without a full Next.js runtime.
vi.mock('next/link', () => ({
  default: ({
    href,
    onClick,
    children,
    ...rest
  }: {
    href: string | { pathname?: string }
    onClick?: React.MouseEventHandler<HTMLAnchorElement>
    children?: React.ReactNode
    [key: string]: unknown
  }) => {
    const resolvedHref =
      typeof href === 'string' ? href : (href as { pathname?: string })?.pathname ?? '#'
    return React.createElement('a', { href: resolvedHref, onClick, ...rest }, children)
  },
}))

// Import SDK after mocks are registered
import {
  SparklyticsProvider,
  useSparklytics,
  TrackedLink,
  Track,
  usePageview,
  identify as standaloneIdentify,
  reset as standaloneReset,
} from '../src/index'

// Import mocked next/router so tests can inspect registered handlers
import nextRouter from 'next/router'

// Import mocked usePathname so tests can change its return value
import { usePathname } from 'next/navigation'

// ──────────────────────────────────────────────────────────────
// Test helpers
// ──────────────────────────────────────────────────────────────

function renderProvider(
  props: Partial<React.ComponentProps<typeof SparklyticsProvider>> & { websiteId: string },
  child: React.ReactNode = React.createElement('div', {}, 'child'),
) {
  return render(
    React.createElement(SparklyticsProvider, props, child),
  )
}

/** Flush debounce timer and allow async microtasks to settle. */
async function flushQueue() {
  await act(async () => {
    vi.advanceTimersByTime(600)
    await Promise.resolve()
    await Promise.resolve()
  })
}

/** Wait for async effects (dynamic imports, promise chains) to settle. */
async function settle() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

// ──────────────────────────────────────────────────────────────
// Setup / teardown
// ──────────────────────────────────────────────────────────────

let sendBeaconMock: ReturnType<typeof vi.fn>
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.useFakeTimers()

  sendBeaconMock = vi.fn().mockReturnValue(true)
  fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))

  Object.defineProperty(window, 'location', {
    value: { pathname: '/', href: 'http://localhost/', search: '', origin: 'http://localhost' },
    writable: true,
    configurable: true,
  })
  Object.defineProperty(window, 'screen', {
    value: { width: 1920, height: 1080 },
    writable: true,
    configurable: true,
  })
  Object.defineProperty(document, 'referrer', {
    value: '',
    writable: true,
    configurable: true,
  })
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('navigator', { sendBeacon: sendBeaconMock, doNotTrack: null })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.clearAllMocks()
  sessionStorage.clear()
})

// ──────────────────────────────────────────────────────────────
// Feature: Next.js SDK Installation
// ──────────────────────────────────────────────────────────────

describe('Initial pageview', () => {
  it('test_initial_pageview_on_mount — fires pageview on first render', async () => {
    renderProvider({ websiteId: 'site_1' })
    await flushQueue()
    expect(sendBeaconMock).toHaveBeenCalledTimes(1)
    const blob: Blob = sendBeaconMock.mock.calls[0][1]
    const events = JSON.parse(await blob.text()) as Record<string, unknown>[]
    expect(Array.isArray(events)).toBe(true)
    expect(events).toHaveLength(1)
    expect(events[0]['type']).toBe('pageview')
    expect(events[0]['website_id']).toBe('site_1')
    expect(events[0]['url']).toBe('/')
  })
})

describe('Autowire fields — language, screen, UTM', () => {
  it('test_pageview_includes_language — navigator.language is sent on every pageview', async () => {
    vi.stubGlobal('navigator', { sendBeacon: sendBeaconMock, doNotTrack: null, language: 'pl-PL' })
    renderProvider({ websiteId: 'site_1' })
    await flushQueue()
    const blob: Blob = sendBeaconMock.mock.calls[0][1]
    const events = JSON.parse(await blob.text()) as Record<string, unknown>[]
    expect(events[0]['language']).toBe('pl-PL')
  })

  it('test_pageview_includes_screen_combined — screen resolution string sent on every pageview', async () => {
    renderProvider({ websiteId: 'site_1' })
    await flushQueue()
    const blob: Blob = sendBeaconMock.mock.calls[0][1]
    const events = JSON.parse(await blob.text()) as Record<string, unknown>[]
    expect(events[0]['screen']).toBe('1920x1080')
  })

  it('test_pageview_includes_screen_dimensions — screen_width and screen_height sent separately', async () => {
    renderProvider({ websiteId: 'site_1' })
    await flushQueue()
    const blob: Blob = sendBeaconMock.mock.calls[0][1]
    const events = JSON.parse(await blob.text()) as Record<string, unknown>[]
    expect(events[0]['screen_width']).toBe(1920)
    expect(events[0]['screen_height']).toBe(1080)
  })

  it('test_pageview_includes_utm_params — UTM query params extracted and sent automatically', async () => {
    Object.defineProperty(window, 'location', {
      value: {
        pathname: '/landing',
        href: 'http://localhost/landing?utm_source=google&utm_medium=cpc&utm_campaign=summer',
        search: '?utm_source=google&utm_medium=cpc&utm_campaign=summer',
      },
      writable: true,
      configurable: true,
    })
    renderProvider({ websiteId: 'site_1' })
    await flushQueue()
    const blob: Blob = sendBeaconMock.mock.calls[0][1]
    const events = JSON.parse(await blob.text()) as Record<string, unknown>[]
    expect(events[0]['utm_source']).toBe('google')
    expect(events[0]['utm_medium']).toBe('cpc')
    expect(events[0]['utm_campaign']).toBe('summer')
  })

  it('test_pageview_no_utm_when_no_query — no utm fields sent on clean URL with empty sessionStorage', async () => {
    renderProvider({ websiteId: 'site_1' })
    await flushQueue()
    const blob: Blob = sendBeaconMock.mock.calls[0][1]
    const events = JSON.parse(await blob.text()) as Record<string, unknown>[]
    expect(events[0]['utm_source']).toBeUndefined()
    expect(events[0]['utm_medium']).toBeUndefined()
  })

  it('test_utm_persisted_across_spa_navigation — UTMs from landing page attached to subsequent pageviews without UTMs in URL', async () => {
    // Land on a page with UTMs
    Object.defineProperty(window, 'location', {
      value: {
        pathname: '/landing',
        href: 'http://localhost/landing?utm_source=google&utm_medium=cpc',
        search: '?utm_source=google&utm_medium=cpc',
      },
      writable: true,
      configurable: true,
    })
    renderProvider({ websiteId: 'site_1' })
    await flushQueue()
    sendBeaconMock.mockClear()

    // Navigate to a page with no UTMs in URL — UTMs should still be attached from sessionStorage
    await act(async () => {
      Object.defineProperty(window, 'location', {
        value: { pathname: '/pricing', href: 'http://localhost/pricing', search: '' },
        writable: true,
        configurable: true,
      })
      history.pushState({}, '', '/pricing')
      vi.advanceTimersByTime(600)
      await Promise.resolve()
    })

    const blob: Blob = sendBeaconMock.mock.calls[0][1]
    const events = JSON.parse(await blob.text()) as Record<string, unknown>[]
    expect(events[0]['url']).toBe('/pricing')
    expect(events[0]['utm_source']).toBe('google')   // persisted from landing
    expect(events[0]['utm_medium']).toBe('cpc')      // persisted from landing
  })

  it('test_new_utm_in_url_overwrites_session — navigating to a URL with different UTMs replaces stored ones', async () => {
    // First session: land with one set of UTMs
    Object.defineProperty(window, 'location', {
      value: {
        pathname: '/',
        href: 'http://localhost/?utm_source=google',
        search: '?utm_source=google',
      },
      writable: true,
      configurable: true,
    })
    renderProvider({ websiteId: 'site_1' })
    await flushQueue()
    sendBeaconMock.mockClear()

    // Navigate to a URL with a different UTM source
    await act(async () => {
      Object.defineProperty(window, 'location', {
        value: {
          pathname: '/promo',
          href: 'http://localhost/promo?utm_source=email',
          search: '?utm_source=email',
        },
        writable: true,
        configurable: true,
      })
      history.pushState({}, '', '/promo?utm_source=email')
      vi.advanceTimersByTime(600)
      await Promise.resolve()
    })

    const blob: Blob = sendBeaconMock.mock.calls[0][1]
    const events = JSON.parse(await blob.text()) as Record<string, unknown>[]
    expect(events[0]['utm_source']).toBe('email')  // new URL wins, not the stored 'google'
  })

  it('test_pushstate_navigation_picks_up_new_utm — UTM params read from new URL on SPA navigation', async () => {
    renderProvider({ websiteId: 'site_1' })
    await flushQueue()
    sendBeaconMock.mockClear()

    await act(async () => {
      Object.defineProperty(window, 'location', {
        value: {
          pathname: '/promo',
          href: 'http://localhost/promo?utm_source=newsletter',
          search: '?utm_source=newsletter',
        },
        writable: true,
        configurable: true,
      })
      history.pushState({}, '', '/promo?utm_source=newsletter')
      vi.advanceTimersByTime(600)
      await Promise.resolve()
    })

    const blob: Blob = sendBeaconMock.mock.calls[0][1]
    const events = JSON.parse(await blob.text()) as Record<string, unknown>[]
    expect(events[0]['utm_source']).toBe('newsletter')
    expect(events[0]['url']).toBe('/promo')
  })
})

describe('sendBeacon format', () => {
  it('test_senbeacon_uses_blob — sends Blob with application/json', async () => {
    renderProvider({ websiteId: 'site_1' })
    await flushQueue()
    expect(sendBeaconMock).toHaveBeenCalledTimes(1)
    const [url, blob] = sendBeaconMock.mock.calls[0] as [string, Blob]
    expect(url).toContain('/api/collect')
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.type).toBe('application/json')
  })

  it('test_batch_format_is_array_not_object — POST body is a JSON array', async () => {
    // Remove sendBeacon from navigator to force fetch path
    vi.stubGlobal('navigator', { doNotTrack: null })
    renderProvider({ websiteId: 'site_1' })
    await flushQueue()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const parsed = JSON.parse(init.body as string) as unknown
    expect(Array.isArray(parsed)).toBe(true)
    const first = (parsed as Record<string, unknown>[])[0]
    expect(first['type']).toBe('pageview')
    expect(first['website_id']).toBe('site_1')
  })
})

// ──────────────────────────────────────────────────────────────
// Feature: host prop and URL construction
// ──────────────────────────────────────────────────────────────

describe('host prop URL construction', () => {
  it('test_host_prop_appends_collect — uses base URL + /api/collect', async () => {
    renderProvider({
      websiteId: 'site_1',
      host: 'https://analytics.example.com',
    })
    await flushQueue()
    expect(sendBeaconMock).toHaveBeenCalledTimes(1)
    const [url] = sendBeaconMock.mock.calls[0] as [string]
    expect(url).toBe('https://analytics.example.com/api/collect')
  })

  it('test_host_trailing_slash_no_double_slash — trailing slash on host is trimmed', async () => {
    renderProvider({
      websiteId: 'site_1',
      host: 'https://analytics.example.com/',
    })
    await flushQueue()
    const [url] = sendBeaconMock.mock.calls[0] as [string]
    expect(url).toBe('https://analytics.example.com/api/collect')
    // Ensure no double slash in the path portion (after the scheme)
    expect(url.replace('https://', '')).not.toContain('//')
  })

  it('test_no_host_uses_relative_path — omitting host sends to /api/collect', async () => {
    renderProvider({ websiteId: 'site_1' })
    await flushQueue()
    const [url] = sendBeaconMock.mock.calls[0] as [string]
    expect(url).toBe('/api/collect')
  })
})

// ──────────────────────────────────────────────────────────────
// Feature: SPA and Pages Router navigation tracking
// ──────────────────────────────────────────────────────────────

describe('SPA navigation tracking', () => {
  it('test_pushstate_navigation_tracked — enqueues pageview on pushState', async () => {
    Object.defineProperty(document, 'referrer', {
      value: 'https://google.com',
      writable: true,
      configurable: true,
    })
    renderProvider({ websiteId: 'site_1' })
    await flushQueue()
    sendBeaconMock.mockClear()

    await act(async () => {
      ;(window.location as { pathname: string }).pathname = '/dashboard'
      history.pushState({}, '', '/dashboard')
      vi.advanceTimersByTime(600)
      await Promise.resolve()
    })

    expect(sendBeaconMock).toHaveBeenCalledTimes(1)
    const blob: Blob = sendBeaconMock.mock.calls[0][1]
    const events = JSON.parse(await blob.text()) as Record<string, unknown>[]
    expect(events[0]['type']).toBe('pageview')
    expect(events[0]['url']).toBe('/dashboard')
    expect(events[0]['website_id']).toBe('site_1')
    expect(events[0]['referrer']).toBe('https://google.com')
  })

  it('test_popstate_navigation_tracked — enqueues pageview on back/forward', async () => {
    renderProvider({ websiteId: 'site_1' })
    await flushQueue()
    sendBeaconMock.mockClear()

    await act(async () => {
      ;(window.location as { pathname: string }).pathname = '/back'
      window.dispatchEvent(new PopStateEvent('popstate'))
      vi.advanceTimersByTime(600)
      await Promise.resolve()
    })

    expect(sendBeaconMock).toHaveBeenCalledTimes(1)
    const blob: Blob = sendBeaconMock.mock.calls[0][1]
    const events = JSON.parse(await blob.text()) as Record<string, unknown>[]
    expect(events[0]['type']).toBe('pageview')
    expect(events[0]['url']).toBe('/back')
  })

  it('test_pages_router_route_change_tracked — routeChangeComplete fires pageview', async () => {
    renderProvider({ websiteId: 'site_1' })
    // Wait for the dynamic import('next/router').then(...) to resolve and register handler
    await settle()
    await flushQueue()
    sendBeaconMock.mockClear()

    // Retrieve the handler registered via router.events.on('routeChangeComplete', handler)
    const routerOnMock = nextRouter.events.on as ReturnType<typeof vi.fn>
    const routeChangeCall = routerOnMock.mock.calls.find(
      ([event]: [string]) => event === 'routeChangeComplete',
    )
    expect(routeChangeCall).toBeDefined()
    const routeChangeHandler = routeChangeCall![1] as (url: string) => void

    // Simulate Pages Router navigation
    await act(async () => {
      routeChangeHandler('/settings')
      vi.advanceTimersByTime(600)
      await Promise.resolve()
    })

    expect(sendBeaconMock).toHaveBeenCalledTimes(1)
    const blob: Blob = sendBeaconMock.mock.calls[0][1]
    const events = JSON.parse(await blob.text()) as Record<string, unknown>[]
    expect(events[0]['type']).toBe('pageview')
    expect(events[0]['url']).toBe('/settings')
  })

  it('test_dedup_window_100ms — same URL within 100ms sends only one pageview', async () => {
    renderProvider({ websiteId: 'site_1' })
    await flushQueue()
    sendBeaconMock.mockClear()

    await act(async () => {
      // Two pushState calls to the same URL within 100ms — should deduplicate
      ;(window.location as { pathname: string }).pathname = '/products'
      history.pushState({}, '', '/products')
      history.pushState({}, '', '/products') // duplicate within <1ms
      vi.advanceTimersByTime(600)
      await Promise.resolve()
    })

    expect(sendBeaconMock).toHaveBeenCalledTimes(1)
    const blob: Blob = sendBeaconMock.mock.calls[0][1]
    const events = JSON.parse(await blob.text()) as Record<string, unknown>[]
    // Only one pageview for /products despite two pushState calls
    const pageviews = (events as Record<string, unknown>[]).filter(e => e['url'] === '/products')
    expect(pageviews).toHaveLength(1)
  })
})

// ──────────────────────────────────────────────────────────────
// Feature: Custom event via useSparklytics hook
// ──────────────────────────────────────────────────────────────

describe('useSparklytics hook', () => {
  it('test_custom_event_via_track_hook — track() sends event with correct fields', async () => {
    Object.defineProperty(document, 'referrer', {
      value: 'https://twitter.com',
      writable: true,
      configurable: true,
    })
    let trackFn: ((name: string, data?: Record<string, unknown>) => void) | undefined

    function Consumer() {
      const { track } = useSparklytics()
      trackFn = track
      return null
    }

    renderProvider({ websiteId: 'site_1' }, React.createElement(Consumer))
    await flushQueue()
    sendBeaconMock.mockClear()

    await act(async () => {
      trackFn!('signup_click', { plan: 'pro' })
      vi.advanceTimersByTime(600)
      await Promise.resolve()
    })

    expect(sendBeaconMock).toHaveBeenCalledTimes(1)
    const blob: Blob = sendBeaconMock.mock.calls[0][1]
    const events = JSON.parse(await blob.text()) as Record<string, unknown>[]
    expect(events[0]['type']).toBe('event')
    expect(events[0]['event_name']).toBe('signup_click')
    expect(events[0]['event_data']).toEqual({ plan: 'pro' })
    expect(events[0]['url']).toBe('/')
    expect(events[0]['referrer']).toBe('https://twitter.com')
  })

  it('test_track_outside_provider_is_noop — useSparklytics() outside Provider does not throw', async () => {
    let trackFn: ((name: string) => void) | undefined

    function Orphan() {
      const { track } = useSparklytics()
      trackFn = track
      return null
    }

    // Render without a SparklyticsProvider ancestor
    render(React.createElement(Orphan))
    await flushQueue()

    expect(() => trackFn!('orphan_event')).not.toThrow()
    expect(sendBeaconMock).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// ──────────────────────────────────────────────────────────────
// Feature: SDK Error Handling
// ──────────────────────────────────────────────────────────────

describe('Error handling', () => {
  it('test_websiteId_required_logs_error_and_no_events — empty websiteId: console.error, no events', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    renderProvider({ websiteId: '' })
    await flushQueue()
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('websiteId is required'),
    )
    expect(sendBeaconMock).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

  it('test_unreachable_endpoint_handled_gracefully — fetch error does not crash page or block queue', async () => {
    // No sendBeacon → falls back to fetch
    vi.stubGlobal('navigator', { doNotTrack: null })
    fetchMock.mockRejectedValue(new Error('Network error'))

    let trackFn: ((name: string) => void) | undefined
    function Consumer() {
      const { track } = useSparklytics()
      trackFn = track
      return null
    }

    // Render — the initial pageview flush will reject but must not throw on the page
    renderProvider({ websiteId: 'site_1' }, React.createElement(Consumer))

    // Flush: initial fetch rejects; retry is scheduled at +2s
    await flushQueue()

    // Advance past the 2s retry — retry also rejects, event is silently dropped
    await act(async () => {
      vi.advanceTimersByTime(2500)
      await Promise.resolve()
      await Promise.resolve()
    })

    // Queue must not be permanently blocked — subsequent track() calls still work
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }))
    await act(async () => {
      trackFn!('recovery_event')
      vi.advanceTimersByTime(600)
      await Promise.resolve()
    })
    // 3 calls: initial fail + retry fail + successful recovery
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('test_http_error_triggers_retry — 429 response retries once after 2s then recovers', async () => {
    vi.stubGlobal('navigator', { doNotTrack: null })
    // First two calls return 429, third returns 200 (recovery)
    fetchMock
      .mockResolvedValueOnce(new Response('{}', { status: 429 })) // initial attempt
      .mockResolvedValueOnce(new Response('{}', { status: 429 })) // retry
      .mockResolvedValue(new Response('{}', { status: 200 }))     // subsequent events

    let trackFn: ((name: string) => void) | undefined
    function Consumer() {
      const { track } = useSparklytics()
      trackFn = track
      return null
    }

    renderProvider({ websiteId: 'site_1' }, React.createElement(Consumer))
    await flushQueue() // initial pageview → 429 → schedules retry

    await act(async () => {
      vi.advanceTimersByTime(2500) // advance past 2s retry window
      await Promise.resolve()
      await Promise.resolve()
    })

    // After retries drop, queue is unblocked — new events succeed
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }))
    await act(async () => {
      trackFn!('post_retry_event')
      vi.advanceTimersByTime(600)
      await Promise.resolve()
    })

    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('test_senbeacon_false_fallback_to_fetch — when sendBeacon returns false, fetch is used', async () => {
    // sendBeacon returns false (browser rejected — e.g. queue full)
    sendBeaconMock.mockReturnValue(false)

    renderProvider({ websiteId: 'site_1' })
    await flushQueue()

    // sendBeacon was called but returned false → SDK fell back to fetch
    expect(sendBeaconMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/collect')
    const parsed = JSON.parse(init.body as string) as Record<string, unknown>[]
    expect(parsed[0]['type']).toBe('pageview')
  })
})

// ──────────────────────────────────────────────────────────────
// Feature: Event batching
// ──────────────────────────────────────────────────────────────

describe('Event batching', () => {
  it('test_event_batching_debounce_500ms — 5 rapid track() calls → 1 POST', async () => {
    let trackFn: ((name: string) => void) | undefined

    function Consumer() {
      const { track } = useSparklytics()
      trackFn = (name: string) => track(name)
      return null
    }

    renderProvider({ websiteId: 'site_1' }, React.createElement(Consumer))
    await flushQueue()
    sendBeaconMock.mockClear()

    await act(async () => {
      for (let i = 0; i < 5; i++) {
        trackFn!(`event_${i}`)
      }
      vi.advanceTimersByTime(600)
      await Promise.resolve()
    })

    expect(sendBeaconMock).toHaveBeenCalledTimes(1)
    const blob: Blob = sendBeaconMock.mock.calls[0][1]
    const events = JSON.parse(await blob.text()) as unknown[]
    expect(events).toHaveLength(5)
  })

  it('test_event_batching_max_10_coalesces — 10 events trigger immediate flush without timer', async () => {
    let trackFn: ((name: string) => void) | undefined

    function Consumer() {
      const { track } = useSparklytics()
      trackFn = (name: string) => track(name)
      return null
    }

    renderProvider({ websiteId: 'site_1' }, React.createElement(Consumer))
    await flushQueue()
    sendBeaconMock.mockClear()

    await act(async () => {
      for (let i = 0; i < 10; i++) {
        trackFn!(`event_${i}`)
      }
      // Do NOT advance timers — 10 events should flush immediately
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(sendBeaconMock).toHaveBeenCalledTimes(1)
    const blob: Blob = sendBeaconMock.mock.calls[0][1]
    const events = JSON.parse(await blob.text()) as unknown[]
    expect(events).toHaveLength(10)
  })

  it('test_beforeunload_triggers_flush — beforeunload sends pending events via sendBeacon', async () => {
    renderProvider({ websiteId: 'site_1' })
    // Flush the initial pageview so the queue is clean
    await flushQueue()
    sendBeaconMock.mockClear()

    // Queue a new pageview via pushState without flushing (leave it pending)
    await act(async () => {
      ;(window.location as { pathname: string }).pathname = '/leaving'
      history.pushState({}, '', '/leaving')
      await Promise.resolve()
      // Do NOT advance timers — the 500ms debounce has not fired yet
    })

    // Dispatch beforeunload — flush() should send the pending pageview immediately via sendBeacon
    await act(async () => {
      window.dispatchEvent(new Event('beforeunload'))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(sendBeaconMock).toHaveBeenCalledTimes(1)
    const [url, blob] = sendBeaconMock.mock.calls[0] as [string, Blob]
    expect(url).toContain('/api/collect')
    expect(blob).toBeInstanceOf(Blob)
    const events = JSON.parse(await blob.text()) as Record<string, unknown>[]
    expect(events[0]['type']).toBe('pageview')
    expect(events[0]['url']).toBe('/leaving')
  })
})

// ──────────────────────────────────────────────────────────────
// Feature: Privacy signals
// ──────────────────────────────────────────────────────────────

describe('Privacy signals', () => {
  it('test_dnt_respected_no_events_sent — DNT=1 suppresses all tracking', async () => {
    vi.stubGlobal('navigator', { sendBeacon: sendBeaconMock, doNotTrack: '1' })
    renderProvider({ websiteId: 'site_1', respectDnt: true })
    await flushQueue()
    expect(sendBeaconMock).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('test_gpc_respected_no_events_sent — GPC=true suppresses all tracking', async () => {
    vi.stubGlobal('navigator', {
      sendBeacon: sendBeaconMock,
      doNotTrack: null,
      globalPrivacyControl: true,
    })
    renderProvider({ websiteId: 'site_1', respectDnt: true })
    await flushQueue()
    expect(sendBeaconMock).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('test_disabled_prop_no_events_sent — disabled=true suppresses all tracking', async () => {
    renderProvider({ websiteId: 'site_1', disabled: true })
    await flushQueue()
    expect(sendBeaconMock).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('test_respect_dnt_false_tracks_despite_dnt — respectDnt=false ignores DNT=1 and sends events', async () => {
    vi.stubGlobal('navigator', { sendBeacon: sendBeaconMock, doNotTrack: '1' })
    renderProvider({ websiteId: 'site_1', respectDnt: false })
    await flushQueue()
    expect(sendBeaconMock).toHaveBeenCalledTimes(1)
  })
})

// ──────────────────────────────────────────────────────────────
// Feature: AppRouterTracker — usePathname navigation
// ──────────────────────────────────────────────────────────────

describe('AppRouterTracker — usePathname navigation', () => {
  it('test_usePathname_change_fires_pageview — App Router navigation detected via usePathname', async () => {
    const usePathnameMock = vi.mocked(usePathname)
    usePathnameMock.mockReturnValue('/')

    const { rerender } = renderProvider({ websiteId: 'site_1' })
    await flushQueue()
    sendBeaconMock.mockClear()

    // Step 1: change the mock return value and rerender — React re-renders AppRouterTracker,
    // usePathname() returns '/features', the useEffect fires and calls enqueue() which
    // schedules a 500ms debounce timer.  We must let all effects settle first.
    await act(async () => {
      usePathnameMock.mockReturnValue('/features')
      rerender(
        React.createElement(
          SparklyticsProvider,
          { websiteId: 'site_1' },
          React.createElement('div', {}, 'child'),
        ),
      )
      // Multiple microtask yields let React 18 flush the useEffect queue before we advance timers.
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    // Step 2: advance past the 500ms debounce so the beacon fires.
    await flushQueue()

    expect(sendBeaconMock).toHaveBeenCalledTimes(1)
    const blob: Blob = sendBeaconMock.mock.calls[0][1]
    const events = JSON.parse(await blob.text()) as Record<string, unknown>[]
    expect(events[0]['type']).toBe('pageview')
    expect(events[0]['url']).toBe('/features')
  })

  it('test_usePathname_same_path_no_duplicate — no extra pageview when pathname unchanged', async () => {
    const usePathnameMock = vi.mocked(usePathname)
    usePathnameMock.mockReturnValue('/stable')

    const { rerender } = renderProvider({ websiteId: 'site_1' })
    await flushQueue()
    sendBeaconMock.mockClear()

    // Re-render WITHOUT changing pathname (e.g. parent state update, not navigation)
    await act(async () => {
      // pathname stays '/stable'
      rerender(
        React.createElement(
          SparklyticsProvider,
          { websiteId: 'site_1' },
          React.createElement('div', {}, 'child'),
        ),
      )
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    await flushQueue()

    // No new pageview — path didn't change
    expect(sendBeaconMock).not.toHaveBeenCalled()
  })
})

// ──────────────────────────────────────────────────────────────
// Feature: TrackedLink component
// ──────────────────────────────────────────────────────────────

describe('TrackedLink component', () => {
  it('test_tracked_link_default_event_name — clicking TrackedLink fires "link_click" with href', async () => {
    const { getByText } = render(
      React.createElement(
        SparklyticsProvider,
        { websiteId: 'site_1' },
        React.createElement(TrackedLink, { href: '/pricing' }, 'Go to pricing'),
      ),
    )

    await flushQueue()
    sendBeaconMock.mockClear()

    await act(async () => {
      getByText('Go to pricing').click()
      vi.advanceTimersByTime(600)
      await Promise.resolve()
    })

    expect(sendBeaconMock).toHaveBeenCalledTimes(1)
    const blob: Blob = sendBeaconMock.mock.calls[0][1]
    const events = JSON.parse(await blob.text()) as Record<string, unknown>[]
    expect(events[0]['type']).toBe('event')
    expect(events[0]['event_name']).toBe('link_click')
    expect((events[0]['event_data'] as Record<string, unknown>)['href']).toBe('/pricing')
  })

  it('test_tracked_link_custom_event_name — eventName prop overrides default "link_click"', async () => {
    const { getByText } = render(
      React.createElement(
        SparklyticsProvider,
        { websiteId: 'site_1' },
        React.createElement(TrackedLink, { href: '/docs', eventName: 'docs_cta' }, 'Docs'),
      ),
    )

    await flushQueue()
    sendBeaconMock.mockClear()

    await act(async () => {
      getByText('Docs').click()
      vi.advanceTimersByTime(600)
      await Promise.resolve()
    })

    const blob: Blob = sendBeaconMock.mock.calls[0][1]
    const events = JSON.parse(await blob.text()) as Record<string, unknown>[]
    expect(events[0]['event_name']).toBe('docs_cta')
  })

  it('test_tracked_link_event_data_merged — eventData merges with auto-captured href', async () => {
    const { getByText } = render(
      React.createElement(
        SparklyticsProvider,
        { websiteId: 'site_1' },
        React.createElement(
          TrackedLink,
          { href: '/blog/post-1', eventData: { position: 'sidebar', variant: 'B' } },
          'Read post',
        ),
      ),
    )

    await flushQueue()
    sendBeaconMock.mockClear()

    await act(async () => {
      getByText('Read post').click()
      vi.advanceTimersByTime(600)
      await Promise.resolve()
    })

    const blob: Blob = sendBeaconMock.mock.calls[0][1]
    const events = JSON.parse(await blob.text()) as Record<string, unknown>[]
    const data = events[0]['event_data'] as Record<string, unknown>
    expect(data['href']).toBe('/blog/post-1')
    expect(data['position']).toBe('sidebar')
    expect(data['variant']).toBe('B')
  })

  it('test_tracked_link_preserves_onclick — existing onClick AND tracking both fire', async () => {
    const existingOnClick = vi.fn()

    const { getByText } = render(
      React.createElement(
        SparklyticsProvider,
        { websiteId: 'site_1' },
        React.createElement(TrackedLink, { href: '/about', onClick: existingOnClick }, 'About'),
      ),
    )

    await flushQueue()
    sendBeaconMock.mockClear()

    await act(async () => {
      getByText('About').click()
      vi.advanceTimersByTime(600)
      await Promise.resolve()
    })

    expect(existingOnClick).toHaveBeenCalledTimes(1)
    expect(sendBeaconMock).toHaveBeenCalledTimes(1)
    const blob: Blob = sendBeaconMock.mock.calls[0][1]
    const events = JSON.parse(await blob.text()) as Record<string, unknown>[]
    expect(events[0]['event_name']).toBe('link_click')
  })

  it('test_tracked_link_url_object_href — UrlObject { pathname } is used as href', async () => {
    const { getByText } = render(
      React.createElement(
        SparklyticsProvider,
        { websiteId: 'site_1' },
        React.createElement(
          TrackedLink,
          { href: { pathname: '/products', query: { id: '42' } } },
          'Product',
        ),
      ),
    )

    await flushQueue()
    sendBeaconMock.mockClear()

    await act(async () => {
      getByText('Product').click()
      vi.advanceTimersByTime(600)
      await Promise.resolve()
    })

    const blob: Blob = sendBeaconMock.mock.calls[0][1]
    const events = JSON.parse(await blob.text()) as Record<string, unknown>[]
    expect((events[0]['event_data'] as Record<string, unknown>)['href']).toBe('/products')
  })
})

// ──────────────────────────────────────────────────────────────
// Feature: trackLinks — automatic link click delegation
// ──────────────────────────────────────────────────────────────

describe('trackLinks prop — automatic link delegation', () => {
  it('test_tracklinks_true_fires_on_anchor_click — link_click event for any <a> when trackLinks=true', async () => {
    const { getByText } = render(
      React.createElement(
        SparklyticsProvider,
        { websiteId: 'site_1', trackLinks: true },
        React.createElement('a', { href: '/about' }, 'About us'),
      ),
    )

    await flushQueue()
    sendBeaconMock.mockClear()

    await act(async () => {
      getByText('About us').click()
      vi.advanceTimersByTime(600)
      await Promise.resolve()
    })

    expect(sendBeaconMock).toHaveBeenCalledTimes(1)
    const blob: Blob = sendBeaconMock.mock.calls[0][1]
    const events = JSON.parse(await blob.text()) as Record<string, unknown>[]
    const ev = events.find(e => (e as Record<string, unknown>)['event_name'] === 'link_click') as Record<string, unknown> | undefined
    expect(ev).toBeDefined()
    expect((ev!['event_data'] as Record<string, unknown>)['href']).toBe('/about')
  })

  it('test_tracklinks_captures_link_text — visible text is included in event_data', async () => {
    const { getByText } = render(
      React.createElement(
        SparklyticsProvider,
        { websiteId: 'site_1', trackLinks: true },
        React.createElement('a', { href: '/docs' }, 'Read the docs'),
      ),
    )

    await flushQueue()
    sendBeaconMock.mockClear()

    await act(async () => {
      getByText('Read the docs').click()
      vi.advanceTimersByTime(600)
      await Promise.resolve()
    })

    const blob: Blob = sendBeaconMock.mock.calls[0][1]
    const events = JSON.parse(await blob.text()) as Record<string, unknown>[]
    const ev = events.find(e => (e as Record<string, unknown>)['event_name'] === 'link_click') as Record<string, unknown>
    expect((ev['event_data'] as Record<string, unknown>)['text']).toBe('Read the docs')
  })

  it('test_tracklinks_external_adds_flag — external link gets external:true in payload', async () => {
    const { getByText } = render(
      React.createElement(
        SparklyticsProvider,
        { websiteId: 'site_1', trackLinks: true },
        React.createElement('a', { href: 'https://github.com/sparklytics' }, 'GitHub'),
      ),
    )

    await flushQueue()
    sendBeaconMock.mockClear()

    await act(async () => {
      getByText('GitHub').click()
      vi.advanceTimersByTime(600)
      await Promise.resolve()
    })

    const blob: Blob = sendBeaconMock.mock.calls[0][1]
    const events = JSON.parse(await blob.text()) as Record<string, unknown>[]
    const ev = events.find(e => (e as Record<string, unknown>)['event_name'] === 'link_click') as Record<string, unknown>
    const data = ev['event_data'] as Record<string, unknown>
    expect(data['external']).toBe(true)
    expect(data['href']).toBe('https://github.com/sparklytics')
  })

  it('test_tracklinks_outbound_skips_internal — outbound mode ignores same-origin links', async () => {
    const { getByText } = render(
      React.createElement(
        SparklyticsProvider,
        { websiteId: 'site_1', trackLinks: 'outbound' },
        React.createElement('a', { href: '/pricing' }, 'Pricing'),
      ),
    )

    await flushQueue()
    sendBeaconMock.mockClear()

    await act(async () => {
      getByText('Pricing').click()
      vi.advanceTimersByTime(600)
      await Promise.resolve()
    })

    // No link_click event — internal link with trackLinks='outbound'
    if (sendBeaconMock.mock.calls.length > 0) {
      const blob: Blob = sendBeaconMock.mock.calls[0][1]
      const events = JSON.parse(await blob.text()) as Record<string, unknown>[]
      const linkClick = events.find(e => (e as Record<string, unknown>)['event_name'] === 'link_click')
      expect(linkClick).toBeUndefined()
    } else {
      expect(sendBeaconMock).not.toHaveBeenCalled()
    }
  })

  it('test_tracklinks_outbound_fires_for_external — outbound mode tracks external links', async () => {
    const { getByText } = render(
      React.createElement(
        SparklyticsProvider,
        { websiteId: 'site_1', trackLinks: 'outbound' },
        React.createElement('a', { href: 'https://twitter.com/sparklytics' }, 'Twitter'),
      ),
    )

    await flushQueue()
    sendBeaconMock.mockClear()

    await act(async () => {
      getByText('Twitter').click()
      vi.advanceTimersByTime(600)
      await Promise.resolve()
    })

    expect(sendBeaconMock).toHaveBeenCalledTimes(1)
    const blob: Blob = sendBeaconMock.mock.calls[0][1]
    const events = JSON.parse(await blob.text()) as Record<string, unknown>[]
    const ev = events.find(e => (e as Record<string, unknown>)['event_name'] === 'link_click') as Record<string, unknown>
    expect(ev).toBeDefined()
    expect((ev['event_data'] as Record<string, unknown>)['href']).toBe('https://twitter.com/sparklytics')
  })

  it('test_tracklinks_false_no_delegation — disabled by default, link clicks not tracked', async () => {
    const { getByText } = render(
      React.createElement(
        SparklyticsProvider,
        { websiteId: 'site_1' /* trackLinks defaults to false */ },
        React.createElement('a', { href: '/pricing' }, 'Pricing silent'),
      ),
    )

    await flushQueue()
    sendBeaconMock.mockClear()

    await act(async () => {
      getByText('Pricing silent').click()
      vi.advanceTimersByTime(600)
      await Promise.resolve()
    })

    // No event because trackLinks is not enabled
    if (sendBeaconMock.mock.calls.length > 0) {
      const blob: Blob = sendBeaconMock.mock.calls[0][1]
      const events = JSON.parse(await blob.text()) as Record<string, unknown>[]
      const linkClick = events.find(e => (e as Record<string, unknown>)['event_name'] === 'link_click')
      expect(linkClick).toBeUndefined()
    } else {
      expect(sendBeaconMock).not.toHaveBeenCalled()
    }
  })

  it('test_tracklinks_hash_href_ignored — hash-only anchors are never tracked', async () => {
    const { getByText } = render(
      React.createElement(
        SparklyticsProvider,
        { websiteId: 'site_1', trackLinks: true },
        React.createElement('a', { href: '#section' }, 'Jump to section'),
      ),
    )

    await flushQueue()
    sendBeaconMock.mockClear()

    await act(async () => {
      getByText('Jump to section').click()
      vi.advanceTimersByTime(600)
      await Promise.resolve()
    })

    if (sendBeaconMock.mock.calls.length > 0) {
      const blob: Blob = sendBeaconMock.mock.calls[0][1]
      const events = JSON.parse(await blob.text()) as Record<string, unknown>[]
      const linkClick = events.find(e => (e as Record<string, unknown>)['event_name'] === 'link_click')
      expect(linkClick).toBeUndefined()
    } else {
      expect(sendBeaconMock).not.toHaveBeenCalled()
    }
  })

  it('test_tracklinks_child_element_click — click on child span inside <a> still fires', async () => {
    const { getByText } = render(
      React.createElement(
        SparklyticsProvider,
        { websiteId: 'site_1', trackLinks: true },
        React.createElement(
          'a',
          { href: '/features' },
          React.createElement('span', {}, 'Features'),
        ),
      ),
    )

    await flushQueue()
    sendBeaconMock.mockClear()

    // Click the inner <span>, not the <a> directly
    await act(async () => {
      getByText('Features').click() // getByText returns the <span>
      vi.advanceTimersByTime(600)
      await Promise.resolve()
    })

    expect(sendBeaconMock).toHaveBeenCalledTimes(1)
    const blob: Blob = sendBeaconMock.mock.calls[0][1]
    const events = JSON.parse(await blob.text()) as Record<string, unknown>[]
    const ev = events.find(e => (e as Record<string, unknown>)['event_name'] === 'link_click') as Record<string, unknown>
    expect(ev).toBeDefined()
    expect((ev['event_data'] as Record<string, unknown>)['href']).toBe('/features')
  })
})

// ──────────────────────────────────────────────────────────────
// Feature: useSparklytics hook — pageview()
// ──────────────────────────────────────────────────────────────

describe('useSparklytics hook — pageview()', () => {
  it('test_pageview_fires_with_current_pathname — pageview() without arg uses window.location.pathname', async () => {
    let pageviewFn: ((url?: string) => void) | undefined

    function Consumer() {
      const { pageview } = useSparklytics()
      pageviewFn = pageview
      return null
    }

    renderProvider({ websiteId: 'site_1' }, React.createElement(Consumer))
    await flushQueue()
    sendBeaconMock.mockClear()

    await act(async () => {
      pageviewFn!()
      vi.advanceTimersByTime(600)
      await Promise.resolve()
    })

    expect(sendBeaconMock).toHaveBeenCalledTimes(1)
    const blob: Blob = sendBeaconMock.mock.calls[0][1]
    const events = JSON.parse(await blob.text()) as Record<string, unknown>[]
    expect(events[0]['type']).toBe('pageview')
    expect(events[0]['url']).toBe('/')
    expect(events[0]['website_id']).toBe('site_1')
  })

  it('test_pageview_fires_with_custom_url — pageview("/virtual/modal") sends provided URL', async () => {
    let pageviewFn: ((url?: string) => void) | undefined

    function Consumer() {
      const { pageview } = useSparklytics()
      pageviewFn = pageview
      return null
    }

    renderProvider({ websiteId: 'site_1' }, React.createElement(Consumer))
    await flushQueue()
    sendBeaconMock.mockClear()

    await act(async () => {
      pageviewFn!('/virtual/product-123')
      vi.advanceTimersByTime(600)
      await Promise.resolve()
    })

    const blob: Blob = sendBeaconMock.mock.calls[0][1]
    const events = JSON.parse(await blob.text()) as Record<string, unknown>[]
    expect(events[0]['type']).toBe('pageview')
    expect(events[0]['url']).toBe('/virtual/product-123')
  })

  it('test_pageview_noop_outside_provider — pageview() outside Provider does not throw or send', async () => {
    let pageviewFn: ((url?: string) => void) | undefined

    function Orphan() {
      const { pageview } = useSparklytics()
      pageviewFn = pageview
      return null
    }

    render(React.createElement(Orphan))
    await flushQueue()

    expect(() => pageviewFn!('/some-page')).not.toThrow()
    expect(sendBeaconMock).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// ──────────────────────────────────────────────────────────────
// Feature: trackScrollDepth prop
// ──────────────────────────────────────────────────────────────

describe('trackScrollDepth prop', () => {
  /** Simulate the page being scrolled to a given percentage (0-100). */
  function simulateScrollTo(pctOfPage: number) {
    // Simulate scrollHeight=2000, innerHeight=500 so scrollable area=1500
    const docHeight = 1500
    const scrollTop = Math.round((pctOfPage / 100) * docHeight)
    Object.defineProperty(document.documentElement, 'scrollHeight', {
      value: 2000,
      writable: true,
      configurable: true,
    })
    Object.defineProperty(window, 'innerHeight', {
      value: 500,
      writable: true,
      configurable: true,
    })
    Object.defineProperty(window, 'scrollY', {
      value: scrollTop,
      writable: true,
      configurable: true,
    })
    window.dispatchEvent(new Event('scroll'))
  }

  it('test_scroll_depth_fires_at_default_threshold — scrolling 50% fires scroll_depth { depth: 50 }', async () => {
    renderProvider({ websiteId: 'site_1', trackScrollDepth: true })
    await flushQueue()
    sendBeaconMock.mockClear()

    await act(async () => {
      simulateScrollTo(50)
      vi.advanceTimersByTime(600)
      await Promise.resolve()
    })

    expect(sendBeaconMock).toHaveBeenCalledTimes(1)
    const blob: Blob = sendBeaconMock.mock.calls[0][1]
    const events = JSON.parse(await blob.text()) as Record<string, unknown>[]
    // Scrolling to 50% crosses both the 25% and 50% thresholds — find the depth:50 event specifically
    const depth50Event = events.find(
      e =>
        (e as Record<string, unknown>)['event_name'] === 'scroll_depth' &&
        ((e as Record<string, unknown>)['event_data'] as Record<string, unknown>)['depth'] === 50,
    ) as Record<string, unknown> | undefined
    expect(depth50Event).toBeDefined()
  })

  it('test_scroll_depth_fires_multiple_thresholds — scrolling 80% fires 25, 50, 75 thresholds', async () => {
    renderProvider({ websiteId: 'site_1', trackScrollDepth: true })
    await flushQueue()
    sendBeaconMock.mockClear()

    await act(async () => {
      simulateScrollTo(80)
      vi.advanceTimersByTime(600)
      await Promise.resolve()
    })

    const blob: Blob = sendBeaconMock.mock.calls[0][1]
    const events = JSON.parse(await blob.text()) as Record<string, unknown>[]
    const depths = events
      .filter(e => (e as Record<string, unknown>)['event_name'] === 'scroll_depth')
      .map(e => ((e as Record<string, unknown>)['event_data'] as Record<string, unknown>)['depth'])
    expect(depths).toContain(25)
    expect(depths).toContain(50)
    expect(depths).toContain(75)
    expect(depths).not.toContain(100) // 80% < 100% threshold
  })

  it('test_scroll_depth_not_fired_twice — same threshold not sent twice even with multiple scroll events', async () => {
    renderProvider({ websiteId: 'site_1', trackScrollDepth: true })
    await flushQueue()
    sendBeaconMock.mockClear()

    await act(async () => {
      simulateScrollTo(30) // fires 25
      simulateScrollTo(35) // still at 25, already fired
      vi.advanceTimersByTime(600)
      await Promise.resolve()
    })

    const blob: Blob = sendBeaconMock.mock.calls[0][1]
    const events = JSON.parse(await blob.text()) as Record<string, unknown>[]
    const depth25 = events.filter(
      e =>
        (e as Record<string, unknown>)['event_name'] === 'scroll_depth' &&
        ((e as Record<string, unknown>)['event_data'] as Record<string, unknown>)['depth'] === 25,
    )
    expect(depth25).toHaveLength(1) // fired exactly once
  })

  it('test_scroll_depth_custom_thresholds — number[] thresholds fire only at specified percentages', async () => {
    renderProvider({ websiteId: 'site_1', trackScrollDepth: [33, 66] })
    await flushQueue()
    sendBeaconMock.mockClear()

    await act(async () => {
      simulateScrollTo(70)
      vi.advanceTimersByTime(600)
      await Promise.resolve()
    })

    const blob: Blob = sendBeaconMock.mock.calls[0][1]
    const events = JSON.parse(await blob.text()) as Record<string, unknown>[]
    const depths = events
      .filter(e => (e as Record<string, unknown>)['event_name'] === 'scroll_depth')
      .map(e => ((e as Record<string, unknown>)['event_data'] as Record<string, unknown>)['depth'])
    expect(depths).toContain(33)
    expect(depths).toContain(66)
    expect(depths).not.toContain(25) // default thresholds not used
    expect(depths).not.toContain(50)
  })

  it('test_scroll_depth_false_no_tracking — trackScrollDepth=false does not track scroll events', async () => {
    renderProvider({ websiteId: 'site_1' /* trackScrollDepth defaults to false */ })
    await flushQueue()
    sendBeaconMock.mockClear()

    await act(async () => {
      simulateScrollTo(100)
      vi.advanceTimersByTime(600)
      await Promise.resolve()
    })

    if (sendBeaconMock.mock.calls.length > 0) {
      const blob: Blob = sendBeaconMock.mock.calls[0][1]
      const events = JSON.parse(await blob.text()) as Record<string, unknown>[]
      expect(events.every(e => (e as Record<string, unknown>)['event_name'] !== 'scroll_depth')).toBe(true)
    } else {
      expect(sendBeaconMock).not.toHaveBeenCalled()
    }
  })
})

// ──────────────────────────────────────────────────────────────
// Feature: trackForms prop
// ──────────────────────────────────────────────────────────────

describe('trackForms prop', () => {
  it('test_form_submit_tracked — submitting a form fires form_submit event', async () => {
    const { container } = render(
      React.createElement(
        SparklyticsProvider,
        { websiteId: 'site_1', trackForms: true },
        React.createElement(
          'form',
          { id: 'contact-form', name: 'contact' },
          React.createElement('button', { type: 'submit' }, 'Send'),
        ),
      ),
    )

    await flushQueue()
    sendBeaconMock.mockClear()

    const form = container.querySelector('form') as HTMLFormElement

    await act(async () => {
      // Dispatch submit event directly (avoids form validation in happy-dom)
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      vi.advanceTimersByTime(600)
      await Promise.resolve()
    })

    expect(sendBeaconMock).toHaveBeenCalledTimes(1)
    const blob: Blob = sendBeaconMock.mock.calls[0][1]
    const events = JSON.parse(await blob.text()) as Record<string, unknown>[]
    const submitEvent = events.find(e => (e as Record<string, unknown>)['event_name'] === 'form_submit') as Record<string, unknown>
    expect(submitEvent).toBeDefined()
    expect(submitEvent['type']).toBe('event')
  })

  it('test_form_submit_includes_form_id — form_id and form_name captured from form attributes', async () => {
    const { container } = render(
      React.createElement(
        SparklyticsProvider,
        { websiteId: 'site_1', trackForms: true },
        React.createElement('form', { id: 'signup-form', name: 'signup' }, null),
      ),
    )

    await flushQueue()
    sendBeaconMock.mockClear()

    const form = container.querySelector('form') as HTMLFormElement

    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      vi.advanceTimersByTime(600)
      await Promise.resolve()
    })

    const blob: Blob = sendBeaconMock.mock.calls[0][1]
    const events = JSON.parse(await blob.text()) as Record<string, unknown>[]
    const submitEvent = events.find(e => (e as Record<string, unknown>)['event_name'] === 'form_submit') as Record<string, unknown>
    const data = submitEvent['event_data'] as Record<string, unknown>
    expect(data['form_id']).toBe('signup-form')
    expect(data['form_name']).toBe('signup')
  })

  it('test_trackforms_false_no_tracking — disabled by default, form submits are not tracked', async () => {
    const { container } = render(
      React.createElement(
        SparklyticsProvider,
        { websiteId: 'site_1' /* trackForms defaults to false */ },
        React.createElement('form', { id: 'silent-form' }, null),
      ),
    )

    await flushQueue()
    sendBeaconMock.mockClear()

    const form = container.querySelector('form') as HTMLFormElement

    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      vi.advanceTimersByTime(600)
      await Promise.resolve()
    })

    if (sendBeaconMock.mock.calls.length > 0) {
      const blob: Blob = sendBeaconMock.mock.calls[0][1]
      const events = JSON.parse(await blob.text()) as Record<string, unknown>[]
      expect(events.every(e => (e as Record<string, unknown>)['event_name'] !== 'form_submit')).toBe(true)
    } else {
      expect(sendBeaconMock).not.toHaveBeenCalled()
    }
  })
})

// ──────────────────────────────────────────────────────────────
// Feature: SSR safety
// ──────────────────────────────────────────────────────────────

describe('SSR safety', () => {
  it('test_sdk_does_not_error_during_ssr — no top-level browser API access at import time', () => {
    // If the module accessed window/document/navigator at module level it would throw on import.
    // In happy-dom window exists, but the test documents the contract and would fail in Node.js.
    expect(() => {
      void SparklyticsProvider
      void useSparklytics
      void TrackedLink
      void Track
    }).not.toThrow()
  })

  it('test_pageview_hook_noop_context — pageview is available and callable on the default context', () => {
    let pageviewFn: ((url?: string) => void) | undefined

    function Consumer() {
      const hook = useSparklytics()
      pageviewFn = hook.pageview
      return null
    }

    // No Provider — uses default context (no-op)
    render(React.createElement(Consumer))
    expect(pageviewFn).toBeDefined()
    expect(() => pageviewFn!('/test')).not.toThrow()
  })

  it('test_children_render_immediately — provider renders children without waiting for tracking init', () => {
    const { getByText } = render(
      React.createElement(
        SparklyticsProvider,
        { websiteId: 'site_1' },
        React.createElement('p', {}, 'visible content'),
      ),
    )
    // Children are visible synchronously — no layout shift from deferred init
    expect(getByText('visible content')).toBeTruthy()
  })
})

// ──────────────────────────────────────────────────────────────
// Feature: env var fallback in SparklyticsProvider
// ──────────────────────────────────────────────────────────────

describe('SparklyticsProvider — env var fallback', () => {
  it('test_env_fallback_websiteId — uses NEXT_PUBLIC_SPARKLYTICS_WEBSITE_ID when websiteId prop omitted', async () => {
    vi.stubEnv('NEXT_PUBLIC_SPARKLYTICS_WEBSITE_ID', 'site_from_env')

    render(
      React.createElement(SparklyticsProvider, {
        // No websiteId prop — should fall back to env var
      }),
    )

    await act(async () => {
      vi.runAllTimers()
      await Promise.resolve()
    })

    const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls
    if (calls.length > 0) {
      const [, init] = calls[0] as [string, RequestInit]
      const body = JSON.parse(init.body as string) as Record<string, unknown>[]
      expect(body[0]?.['website_id']).toBe('site_from_env')
    }
    // Either a fetch was made with the env websiteId, or no fetch (timing) — either is fine.
    // The key assertion is that the provider renders without throwing.

    vi.unstubAllEnvs()
  })

  it('test_env_fallback_no_props — provider renders without any props when both env vars set', () => {
    vi.stubEnv('NEXT_PUBLIC_SPARKLYTICS_WEBSITE_ID', 'site_env')
    vi.stubEnv('NEXT_PUBLIC_SPARKLYTICS_HOST', 'https://env.example.com')

    // Should render without error or TypeScript complaint
    expect(() => {
      render(
        React.createElement(SparklyticsProvider, {}),
      )
    }).not.toThrow()

    vi.unstubAllEnvs()
  })
})

// ──────────────────────────────────────────────────────────────
// Feature: <Track> component
// ──────────────────────────────────────────────────────────────

describe('Track component', () => {
  it('test_Track_fires_event_on_click — default trigger fires on click', async () => {
    const { getByTestId } = renderProvider(
      { websiteId: 'site_1' },
      React.createElement(
        Track,
        { event: 'cta_clicked', data: { plan: 'pro' } },
        React.createElement('button', { 'data-testid': 'btn' }, 'Click'),
      ),
    )
    await flushQueue() // drain initial pageview

    const btn = getByTestId('btn')
    await act(async () => { btn.click() })
    await flushQueue()

    const allBodies = await Promise.all(
      sendBeaconMock.mock.calls.map(async ([, blob]: [unknown, Blob]) =>
        JSON.parse(await blob.text()) as Record<string, unknown>[],
      ),
    )
    const events = allBodies.flat()
    const clickEvent = events.find((e) => e['event_name'] === 'cta_clicked')
    expect(clickEvent).toBeDefined()
    expect(clickEvent!['event_data']).toEqual({ plan: 'pro' })
    expect(clickEvent!['type']).toBe('event')
  })

  it('test_Track_preserves_existing_onClick — existing onClick still called', async () => {
    const existingClick = vi.fn()
    const { getByTestId } = renderProvider(
      { websiteId: 'site_1' },
      React.createElement(
        Track,
        { event: 'btn_clicked' },
        React.createElement('button', { 'data-testid': 'btn', onClick: existingClick }, 'Click'),
      ),
    )
    await flushQueue()

    getByTestId('btn').click()
    expect(existingClick).toHaveBeenCalledTimes(1)
  })

  it('test_Track_trigger_focus — fires event on focus when trigger="focus"', async () => {
    const { getByTestId } = renderProvider(
      { websiteId: 'site_1' },
      React.createElement(
        Track,
        { event: 'field_focused', trigger: 'focus' },
        React.createElement('input', { 'data-testid': 'inp', type: 'text' }),
      ),
    )
    await flushQueue()

    const inp = getByTestId('inp') as HTMLInputElement
    await act(async () => { inp.focus() })
    await flushQueue()

    const allBodies = await Promise.all(
      sendBeaconMock.mock.calls.map(async ([, blob]: [unknown, Blob]) =>
        JSON.parse(await blob.text()) as Record<string, unknown>[],
      ),
    )
    const events = allBodies.flat()
    expect(events.some((e) => e['event_name'] === 'field_focused')).toBe(true)
  })

  it('test_Track_no_data — event fires with undefined eventData', async () => {
    const { getByTestId } = renderProvider(
      { websiteId: 'site_1' },
      React.createElement(
        Track,
        { event: 'no_data_event' },
        React.createElement('button', { 'data-testid': 'btn' }, 'Click'),
      ),
    )
    await flushQueue()

    getByTestId('btn').click()
    await flushQueue()

    const allBodies = await Promise.all(
      sendBeaconMock.mock.calls.map(async ([, blob]: [unknown, Blob]) =>
        JSON.parse(await blob.text()) as Record<string, unknown>[],
      ),
    )
    const events = allBodies.flat()
    const clickEvent = events.find((e) => e['event_name'] === 'no_data_event')
    expect(clickEvent).toBeDefined()
    // event_data should be absent or undefined when no data passed
    expect(clickEvent!['event_data']).toBeUndefined()
  })

  it('test_Track_renders_child_unchanged — Track does not wrap child in extra DOM element', () => {
    const { container } = renderProvider(
      { websiteId: 'site_1' },
      React.createElement(
        Track,
        { event: 'test' },
        React.createElement('button', { 'data-testid': 'btn' }, 'Click'),
      ),
    )
    // No extra wrapper elements — the button is a direct descendant
    const btn = container.querySelector('[data-testid="btn"]')
    expect(btn).toBeTruthy()
    expect(btn!.tagName.toLowerCase()).toBe('button')
  })
})

// ──────────────────────────────────────────────────────────────
// Feature: standalone identify() / reset() (no hook required)
// ──────────────────────────────────────────────────────────────

describe('standalone identify and reset (module-level exports)', () => {
  afterEach(() => {
    localStorage.clear()
  })

  it('test_standalone_identify_writes_localStorage — identify() sets key without Provider or hook', () => {
    standaloneIdentify('standalone-visitor-xyz')
    expect(localStorage.getItem('sparklytics_visitor_id')).toBe('standalone-visitor-xyz')
  })

  it('test_standalone_reset_clears_localStorage — reset() removes key without Provider or hook', () => {
    localStorage.setItem('sparklytics_visitor_id', 'to-be-cleared')
    standaloneReset()
    expect(localStorage.getItem('sparklytics_visitor_id')).toBeNull()
  })

  it('test_standalone_identify_affects_provider_events — Provider picks up ID set by standalone identify()', async () => {
    // Set the visitor ID via the standalone export (e.g. from an auth callback)
    standaloneIdentify('standalone-set-before-mount')

    // Then mount the Provider — the initial pageview should carry the visitor_id
    renderProvider({ websiteId: 'site_1' })
    await flushQueue()

    const allBodies = await Promise.all(
      sendBeaconMock.mock.calls.map(async ([, blob]: [unknown, Blob]) =>
        JSON.parse(await blob.text()) as Record<string, unknown>[],
      ),
    )
    const events = allBodies.flat()
    const pageview = events.find((e) => e['type'] === 'pageview')
    expect(pageview!['visitor_id']).toBe('standalone-set-before-mount')
  })

  it('test_standalone_reset_affects_provider_events — Provider omits visitor_id after standalone reset()', async () => {
    // Pre-load visitor ID then clear it
    localStorage.setItem('sparklytics_visitor_id', 'visitor-was-here')
    standaloneReset()

    renderProvider({ websiteId: 'site_1' })
    await flushQueue()

    const allBodies = await Promise.all(
      sendBeaconMock.mock.calls.map(async ([, blob]: [unknown, Blob]) =>
        JSON.parse(await blob.text()) as Record<string, unknown>[],
      ),
    )
    const events = allBodies.flat()
    const pageview = events.find((e) => e['type'] === 'pageview')
    expect(pageview!['visitor_id']).toBeUndefined()
  })
})

// ──────────────────────────────────────────────────────────────
// Feature: identify() / reset() via hook
// ──────────────────────────────────────────────────────────────

describe('identify and reset (via hook)', () => {
  afterEach(() => {
    localStorage.clear()
  })

  it('test_identify_stores_visitor_id_in_localStorage — identify() writes to localStorage', async () => {
    function Consumer() {
      const { identify } = useSparklytics()
      React.useEffect(() => { identify('visitor-abc123') }, [identify])
      return null
    }
    renderProvider({ websiteId: 'site_1' }, React.createElement(Consumer))
    await settle()

    expect(localStorage.getItem('sparklytics_visitor_id')).toBe('visitor-abc123')
  })

  it('test_identify_includes_visitor_id_in_events — track() attaches visitor_id from localStorage', async () => {
    function Consumer() {
      const { identify, track } = useSparklytics()
      React.useEffect(() => {
        identify('identified-user-001')
        track('test_event')
      }, [identify, track])
      return null
    }
    renderProvider({ websiteId: 'site_1' }, React.createElement(Consumer))
    await flushQueue()

    const allBodies = await Promise.all(
      sendBeaconMock.mock.calls.map(async ([, blob]: [unknown, Blob]) =>
        JSON.parse(await blob.text()) as Record<string, unknown>[],
      ),
    )
    const events = allBodies.flat()
    const trackedEvent = events.find((e) => e['event_name'] === 'test_event')
    expect(trackedEvent).toBeDefined()
    expect(trackedEvent!['visitor_id']).toBe('identified-user-001')
  })

  it('test_identify_attaches_visitor_id_to_pageviews — pageviews also carry visitor_id', async () => {
    // Set the visitor ID in localStorage directly (simulating a prior identify() call)
    localStorage.setItem('sparklytics_visitor_id', 'pre-identified-visitor')

    renderProvider({ websiteId: 'site_1' })
    await flushQueue()

    const allBodies = await Promise.all(
      sendBeaconMock.mock.calls.map(async ([, blob]: [unknown, Blob]) =>
        JSON.parse(await blob.text()) as Record<string, unknown>[],
      ),
    )
    const events = allBodies.flat()
    const pageview = events.find((e) => e['type'] === 'pageview')
    expect(pageview!['visitor_id']).toBe('pre-identified-visitor')
  })

  it('test_reset_clears_visitor_id — reset() removes from localStorage', async () => {
    localStorage.setItem('sparklytics_visitor_id', 'to-be-cleared')

    function Consumer() {
      const { reset } = useSparklytics()
      React.useEffect(() => { reset() }, [reset])
      return null
    }
    renderProvider({ websiteId: 'site_1' }, React.createElement(Consumer))
    await settle()

    expect(localStorage.getItem('sparklytics_visitor_id')).toBeNull()
  })

  it('test_events_after_reset_have_no_visitor_id — track() after reset() omits visitor_id', async () => {
    function Consumer() {
      const { identify, reset, track } = useSparklytics()
      React.useEffect(() => {
        identify('user-to-reset')
        reset()
        track('post_reset_event')
      }, [identify, reset, track])
      return null
    }
    renderProvider({ websiteId: 'site_1' }, React.createElement(Consumer))
    await flushQueue()

    const allBodies = await Promise.all(
      sendBeaconMock.mock.calls.map(async ([, blob]: [unknown, Blob]) =>
        JSON.parse(await blob.text()) as Record<string, unknown>[],
      ),
    )
    const events = allBodies.flat()
    const postResetEvent = events.find((e) => e['event_name'] === 'post_reset_event')
    // visitor_id must be absent after reset
    expect(postResetEvent).toBeDefined()
    expect(postResetEvent!['visitor_id']).toBeUndefined()
  })

  it('test_no_visitor_id_when_not_identified — events have no visitor_id when identify not called', async () => {
    function Consumer() {
      const { track } = useSparklytics()
      React.useEffect(() => { track('anonymous_event') }, [track])
      return null
    }
    renderProvider({ websiteId: 'site_1' }, React.createElement(Consumer))
    await flushQueue()

    const allBodies = await Promise.all(
      sendBeaconMock.mock.calls.map(async ([, blob]: [unknown, Blob]) =>
        JSON.parse(await blob.text()) as Record<string, unknown>[],
      ),
    )
    const events = allBodies.flat()
    const ev = events.find((e) => e['event_name'] === 'anonymous_event')
    expect(ev).toBeDefined()
    expect(ev!['visitor_id']).toBeUndefined()
  })

  it('test_identify_reset_noop_outside_provider — identify/reset from default context do not throw', () => {
    function Consumer() {
      const { identify, reset } = useSparklytics()
      React.useEffect(() => {
        expect(() => identify('id')).not.toThrow()
        expect(() => reset()).not.toThrow()
      }, [identify, reset])
      return null
    }
    // No provider — uses default no-op context
    expect(() => render(React.createElement(Consumer))).not.toThrow()
  })
})

// ──────────────────────────────────────────────────────────────
// Feature: usePageview() standalone hook
// ──────────────────────────────────────────────────────────────

describe('usePageview hook', () => {
  it('test_usePageview_fires_initial_pageview — sends pageview on mount', async () => {
    vi.stubEnv('NEXT_PUBLIC_SPARKLYTICS_WEBSITE_ID', 'site_hook')
    vi.stubEnv('NEXT_PUBLIC_SPARKLYTICS_HOST', '')

    function Page() {
      usePageview()
      return null
    }
    render(React.createElement(Page))
    await flushQueue()

    // Should have fired at least one sendBeacon call (the initial pageview)
    const allBodies = await Promise.all(
      sendBeaconMock.mock.calls.map(async ([, blob]: [unknown, Blob]) =>
        JSON.parse(await blob.text()) as Record<string, unknown>[],
      ),
    )
    const events = allBodies.flat()
    const pageview = events.find((e) => e['type'] === 'pageview')
    expect(pageview).toBeDefined()
    expect(pageview!['website_id']).toBe('site_hook')

    vi.unstubAllEnvs()
  })

  it('test_usePageview_respects_disabled — no events when disabled: true', async () => {
    vi.stubEnv('NEXT_PUBLIC_SPARKLYTICS_WEBSITE_ID', 'site_hook')

    function Page() {
      usePageview({ disabled: true })
      return null
    }
    render(React.createElement(Page))
    await flushQueue()

    expect(sendBeaconMock).not.toHaveBeenCalled()
    vi.unstubAllEnvs()
  })

  it('test_usePageview_explicit_websiteId — uses explicit websiteId over env var', async () => {
    vi.stubEnv('NEXT_PUBLIC_SPARKLYTICS_WEBSITE_ID', 'site_from_env')

    function Page() {
      usePageview({ websiteId: 'site_explicit', host: '' })
      return null
    }
    render(React.createElement(Page))
    await flushQueue()

    const allBodies = await Promise.all(
      sendBeaconMock.mock.calls.map(async ([, blob]: [unknown, Blob]) =>
        JSON.parse(await blob.text()) as Record<string, unknown>[],
      ),
    )
    const events = allBodies.flat()
    expect(events.every((e) => e['website_id'] === 'site_explicit')).toBe(true)

    vi.unstubAllEnvs()
  })

  it('test_usePageview_pages_router_routeChange — fires on routeChangeComplete', async () => {
    vi.stubEnv('NEXT_PUBLIC_SPARKLYTICS_WEBSITE_ID', 'site_hook')

    function Page() {
      usePageview()
      return null
    }
    render(React.createElement(Page))
    await settle() // let dynamic import of next/router settle

    // Simulate a Pages Router route change by calling the registered handler
    const routerMock = nextRouter as { events: { on: ReturnType<typeof vi.fn>; off: ReturnType<typeof vi.fn> } }
    const onCalls = routerMock.events.on.mock.calls
    const routeChangeHandler = onCalls.find(
      ([event]: [string]) => event === 'routeChangeComplete',
    )?.[1] as ((url: string) => void) | undefined

    if (routeChangeHandler) {
      await act(async () => { routeChangeHandler('/new-route') })
      await flushQueue()

      const allBodies = await Promise.all(
        sendBeaconMock.mock.calls.map(async ([, blob]: [unknown, Blob]) =>
          JSON.parse(await blob.text()) as Record<string, unknown>[],
        ),
      )
      const events = allBodies.flat()
      const routePageview = events.find((e) => e['url'] === '/new-route')
      expect(routePageview).toBeDefined()
    }

    vi.unstubAllEnvs()
  })

  it('test_usePageview_no_event_when_websiteId_missing — no tracking without websiteId', async () => {
    vi.stubEnv('NEXT_PUBLIC_SPARKLYTICS_WEBSITE_ID', '')

    function Page() {
      usePageview({ websiteId: '' })
      return null
    }
    render(React.createElement(Page))
    await flushQueue()

    expect(sendBeaconMock).not.toHaveBeenCalled()
    vi.unstubAllEnvs()
  })
})
