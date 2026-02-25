'use client'

import React, { createContext, useContext, useEffect, useRef } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

// ============================================================
// Typed event schema — augment this interface in your project
// to get autocomplete and type checking on track() calls.
//
// Example (global.d.ts or any .ts file):
//
//   declare module '@sparklytics/next' {
//     interface SparklyticsEvents {
//       signup_click:      { plan: 'free' | 'pro' | 'enterprise' }
//       checkout_started:  { cart_value: number; currency: string }
//       video_played:      { title: string; duration_s: number }
//     }
//   }
//
// After augmentation, track() will enforce the correct payload
// for known event names and still accept arbitrary strings for
// ad-hoc events.
// ============================================================

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface SparklyticsEvents {}

// ============================================================
// Types
// ============================================================

export interface SparklyticsProviderProps {
  /**
   * Website ID from your Sparklytics dashboard (e.g. `"site_abc123def456"`).
   *
   * Can be omitted when `NEXT_PUBLIC_SPARKLYTICS_WEBSITE_ID` is set in your
   * Next.js environment — the SDK will read it automatically.
   */
  websiteId?: string
  /**
   * Base URL of your self-hosted Sparklytics server.
   * SDK appends `/api/collect` automatically. Trailing slash is safe.
   *
   * Can be omitted when `NEXT_PUBLIC_SPARKLYTICS_HOST` is set in your
   * Next.js environment — the SDK will read it automatically.
   * Omit entirely for same-origin setups where your app and analytics
   * server share a domain.
   *
   * @example "https://analytics.example.com"
   */
  host?: string
  /** Optional. Respect DNT and GPC signals. Default: true. */
  respectDnt?: boolean
  /** Optional. Disable all tracking (e.g. for dev/staging). Default: false. */
  disabled?: boolean
  /**
   * Optional. Automatically track clicks on ALL <a> tags (including Next.js <Link>)
   * via event delegation — no code changes to existing links required.
   *
   * - `true`        — track all link clicks (internal + external)
   * - `'outbound'`  — track only links to a different origin (e.g. social, docs, affiliates)
   * - `false`       — disabled (default). Use <TrackedLink> for explicit per-link tracking.
   *
   * Fires a "link_click" event with `{ href, text?, external }` payload.
   * Hash-only (#anchor) and javascript: hrefs are always ignored.
   * For external links, `href` is the full URL; for internal links, pathname+search+hash.
   */
  trackLinks?: boolean | 'outbound'
  /**
   * Optional. Automatically track scroll depth milestones.
   *
   * - `true`        — fire at 25%, 50%, 75%, and 100% page scroll
   * - `number[]`    — fire at custom percentage thresholds (e.g. `[33, 66, 100]`)
   * - `false`       — disabled (default)
   *
   * Fires a `"scroll_depth"` event with `{ depth: N }` (N = integer threshold crossed).
   * Each threshold fires at most once per page. Resets automatically on navigation.
   */
  trackScrollDepth?: boolean | number[]
  /**
   * Optional. Automatically track HTML form submissions via event delegation.
   * Fires a `"form_submit"` event whenever any `<form>` on the page is submitted.
   *
   * Payload: `{ form_id?, form_name?, action? }` — all fields are optional and
   * derived from the form element's attributes.
   *
   * @default false
   */
  trackForms?: boolean
  children: React.ReactNode
}

export interface SparklyticsHook {
  /**
   * Track a custom event.
   *
   * When SparklyticsEvents is augmented, known event names are type-checked
   * and their payload shapes are enforced. Unknown event names still work
   * with an optional Record<string, unknown> payload.
   *
   * Limits (enforced server-side): eventName max 50 chars;
   * eventData max 4 KB JSON-serialized; 1 level of nesting recommended.
   */
  track<T extends keyof SparklyticsEvents>(
    eventName: T,
    eventData: SparklyticsEvents[T],
  ): void
  track(eventName: string, eventData?: Record<string, unknown>): void
  /**
   * Manually fire a pageview event.
   *
   * Useful for virtual pages, full-screen modals, multi-step wizards, or
   * any UI pattern where meaningful content changes without a URL change.
   *
   * @param url - Optional URL to record. Defaults to `window.location.pathname`.
   *
   * @example
   * ```ts
   * const { pageview } = useSparklytics()
   *
   * // Track a modal open as a distinct "page" visit
   * function openProductModal(id: string) {
   *   pageview(`/products/${id}`)
   * }
   * ```
   */
  pageview(url?: string): void
  /**
   * Identify the current visitor with a stable ID for cross-session stitching.
   *
   * Equivalent to the standalone `identify()` export — both write to the same
   * `localStorage` key. Prefer the standalone import when you don't already
   * have a `useSparklytics()` call in scope (e.g. in an auth callback).
   *
   * **Privacy note:** pass a hashed or tokenised ID — **never** a raw email
   * address or numeric user ID.
   *
   * @param visitorId - A stable, non-reversible identifier (max 64 chars).
   *
   * @example Via hook (inside a component)
   * ```ts
   * const { identify } = useSparklytics()
   * identify(hashedUserId)
   * ```
   * @example Via standalone import (outside a component — preferred)
   * ```ts
   * import { identify } from '@sparklytics/next'
   * identify(hashedUserId)
   * ```
   */
  identify(visitorId: string): void
  /**
   * Clear the identified visitor ID from `localStorage`.
   *
   * Equivalent to the standalone `reset()` export. Call this on logout.
   *
   * @example Via hook (inside a component)
   * ```ts
   * const { reset } = useSparklytics()
   * reset()
   * ```
   * @example Via standalone import (outside a component — preferred)
   * ```ts
   * import { reset } from '@sparklytics/next'
   * reset()
   * ```
   */
  reset(): void
}

// ============================================================
// Batch event shape (internal wire format)
// ============================================================

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'] as const
type UtmKey = typeof UTM_KEYS[number]

/** sessionStorage key used to persist UTM params across SPA navigations within a tab. */
const UTM_SESSION_KEY = '_spl_utm'

export interface BatchEvent {
  website_id: string
  type: 'pageview' | 'event'
  url: string
  referrer?: string
  /** Browser language from navigator.language (e.g. "en-US"). Populates Languages breakdown. */
  language?: string
  /** Screen resolution as "WxH" (e.g. "1920x1080"). Populates Screen Resolutions breakdown. */
  screen?: string
  /** Screen width in pixels — sent alongside `screen` for server-side dimension filtering. */
  screen_width?: number
  /** Screen height in pixels — sent alongside `screen` for server-side dimension filtering. */
  screen_height?: number
  /** UTM parameters — read from URL on landing, then persisted in sessionStorage for the visit. */
  utm_source?: string
  utm_medium?: string
  utm_campaign?: string
  utm_term?: string
  utm_content?: string
  event_name?: string
  event_data?: Record<string, unknown>
  /**
   * Optional stable visitor ID set via {@link SparklyticsHook.identify}.
   * When present, the backend uses this instead of computing from IP + User-Agent.
   */
  visitor_id?: string
}

/**
 * Resolve UTM parameters for the current pageview.
 *
 * Priority: URL query string > sessionStorage (persisted from earlier in the session).
 * When UTMs are present in the URL they are stored in sessionStorage so they remain
 * attached to all subsequent pageviews in the same tab — even after the user navigates
 * to pages that no longer carry UTM query params.
 *
 * sessionStorage is tab-scoped and auto-cleared when the tab is closed, so a new
 * session always starts fresh.
 */
function resolveUtmParams(): Partial<Pick<BatchEvent, UtmKey>> {
  if (typeof window === 'undefined') return {}

  const params = new URLSearchParams(window.location.search)
  const fromUrl: Partial<Pick<BatchEvent, UtmKey>> = {}
  for (const key of UTM_KEYS) {
    const val = params.get(key)
    if (val) fromUrl[key] = val
  }

  if (Object.keys(fromUrl).length > 0) {
    // Fresh UTMs in the URL — persist them for the rest of this session
    try { sessionStorage.setItem(UTM_SESSION_KEY, JSON.stringify(fromUrl)) } catch { /* quota / private mode */ }
    return fromUrl
  }

  // No UTMs in URL — restore from session (covers SPA navigations after the landing page)
  try {
    const stored = sessionStorage.getItem(UTM_SESSION_KEY)
    if (stored) return JSON.parse(stored) as Partial<Pick<BatchEvent, UtmKey>>
  } catch { /* sessionStorage unavailable or value corrupted */ }

  return {}
}

/**
 * Collect browser-side metadata that enriches every pageview event automatically.
 * Called at navigation time so screen and UTM values reflect the current page.
 * SSR-safe: returns {} when window is not available.
 */
function getPageviewExtras(): Partial<Pick<BatchEvent, 'language' | 'screen' | 'screen_width' | 'screen_height' | UtmKey>> {
  if (typeof window === 'undefined') return {}

  const extras: Partial<Pick<BatchEvent, 'language' | 'screen' | 'screen_width' | 'screen_height' | UtmKey>> = {}

  if (typeof navigator !== 'undefined' && navigator.language) {
    extras.language = navigator.language
  }

  if (window.screen && window.screen.width && window.screen.height) {
    extras.screen = `${window.screen.width}x${window.screen.height}`
    extras.screen_width = window.screen.width
    extras.screen_height = window.screen.height
  }

  return { ...extras, ...resolveUtmParams() }
}

// ============================================================
// Privacy signal check (DNT + GPC)
// ============================================================

function isPrivacyBlocked(respectDnt: boolean): boolean {
  if (!respectDnt) return false
  if (typeof navigator === 'undefined') return false
  if (navigator.doNotTrack === '1') return true
  if ((navigator as unknown as { globalPrivacyControl?: boolean }).globalPrivacyControl === true) return true
  return false
}

// ============================================================
// Visitor identification (identify / reset)
// ============================================================

/** localStorage key for the identify() visitor ID override. */
const IDENTIFY_KEY = 'sparklytics_visitor_id'

/**
 * Read the currently identified visitor ID from localStorage.
 * Returns undefined when localStorage is unavailable or no ID is set.
 */
function getIdentifiedVisitor(): string | undefined {
  try {
    return localStorage.getItem(IDENTIFY_KEY) ?? undefined
  } catch {
    return undefined
  }
}

/** Internal: write visitor ID to localStorage. Fail-silent. */
function _setVisitorId(id: string): void {
  try {
    localStorage.setItem(IDENTIFY_KEY, id)
  } catch {
    // Storage unavailable (private browsing, quota exceeded) — fail silently
  }
}

/** Internal: remove visitor ID from localStorage. Fail-silent. */
function _clearVisitorId(): void {
  try {
    localStorage.removeItem(IDENTIFY_KEY)
  } catch {
    // Storage unavailable — fail silently
  }
}

// ============================================================
// Standalone visitor identification exports
//
// These work WITHOUT a React Provider — import and call them
// directly in auth callbacks, Pages Router _app.tsx, or any
// non-component code.
// ============================================================

/**
 * Identify the current visitor with a stable ID for cross-session stitching.
 *
 * Stores the ID in `localStorage` and attaches it as `visitor_id` to all
 * subsequent tracking calls (from `<SparklyticsProvider>`, `usePageview()`,
 * or any other SDK call on this device). Works without React context —
 * call it directly after login, no Provider or hook needed.
 *
 * **Privacy note:** pass a hashed or tokenised ID — **never** a raw email
 * address or numeric user ID.
 *
 * @param visitorId - A stable, non-reversible identifier (max 64 chars).
 *
 * @example After login (no hook required)
 * ```ts
 * import { identify } from '@sparklytics/next'
 *
 * async function onLoginSuccess(userId: string) {
 *   const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(userId))
 *   const hex = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('')
 *   identify(hex.slice(0, 16))
 * }
 * ```
 */
export function identify(visitorId: string): void {
  _setVisitorId(visitorId)
}

/**
 * Clear the identified visitor ID from `localStorage`.
 *
 * Call this on logout so subsequent visits are no longer stitched to the
 * logged-in user's profile. Works without React context — no Provider or
 * hook needed.
 *
 * @example On logout (no hook required)
 * ```ts
 * import { reset } from '@sparklytics/next'
 *
 * function onLogout() {
 *   reset()
 * }
 * ```
 */
export function reset(): void {
  _clearVisitorId()
}

// ============================================================
// Context — default is a no-op (safe for SSR / Server Components)
// ============================================================

const SparklyticsContext = createContext<SparklyticsHook>({
  track: () => {},
  pageview: () => {},
  identify: () => {},
  reset: () => {},
})

// ============================================================
// Provider
// ============================================================

export function SparklyticsProvider({
  websiteId: websiteIdProp,
  host: hostProp,
  respectDnt = true,
  disabled = false,
  trackLinks = false,
  trackScrollDepth = false,
  trackForms = false,
  children,
}: SparklyticsProviderProps) {
  // Resolve from env vars if not provided as props.
  // process.env.NEXT_PUBLIC_* is inlined by the Next.js bundler at build time.
  const websiteId =
    websiteIdProp ??
    (typeof process !== 'undefined'
      ? process.env.NEXT_PUBLIC_SPARKLYTICS_WEBSITE_ID ?? ''
      : '')
  const host =
    hostProp ??
    (typeof process !== 'undefined'
      ? process.env.NEXT_PUBLIC_SPARKLYTICS_HOST ?? ''
      : '')

  // Validate websiteId at runtime and fail gracefully
  if (!websiteId) {
    if (typeof console !== 'undefined') {
      console.error(
        '[Sparklytics] websiteId is required. ' +
          'Pass it as a prop or set NEXT_PUBLIC_SPARKLYTICS_WEBSITE_ID. ' +
          'No events will be sent.',
      )
    }
  }

  // Trim trailing slash so "https://example.com/" and "https://example.com" both work
  const collectUrl = host
    ? `${host.replace(/\/$/, '')}/api/collect`
    : '/api/collect'

  const queueRef = useRef<BatchEvent[]>([])
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const blockedRef = useRef<boolean>(false)
  // Keep collectUrl accessible inside stable refs without stale closures
  const collectUrlRef = useRef(collectUrl)
  collectUrlRef.current = collectUrl
  // Dedup tracker: prevents double-pageview when both history.pushState monkey-patch
  // and next/router routeChangeComplete fire for the same Pages Router navigation.
  // A 100ms window is narrow enough to catch near-simultaneous fires and wide enough
  // not to suppress genuine rapid navigations to different URLs.
  const lastPageviewRef = useRef<{ url: string; ts: number } | null>(null)

  // Determine tracking eligibility (SSR-safe)
  useEffect(() => {
    blockedRef.current =
      !websiteId || disabled || isPrivacyBlocked(respectDnt)
  }, [websiteId, disabled, respectDnt])

  // Flush the queue to the server
  const flush = useRef(async () => {
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current)
      flushTimerRef.current = null
    }
    if (blockedRef.current || queueRef.current.length === 0) return

    const batch = queueRef.current.splice(0)

    const send = async () => {
      const body = JSON.stringify(batch)

      // Prefer sendBeacon for fire-and-forget delivery (survives tab close).
      // Fall back to fetch if sendBeacon is unavailable OR returns false
      // (browser rejected the request — e.g. queue full, tab already unloading).
      if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
        const queued = navigator.sendBeacon(
          collectUrlRef.current,
          new Blob([body], { type: 'application/json' }),
        )
        if (queued) return // Beacon accepted — we're done
        // Beacon rejected — fall through to fetch
      }

      const response = await fetch(collectUrlRef.current, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      })

      // Treat HTTP errors (4xx, 5xx) the same as network errors so the
      // retry logic below catches transient server failures (e.g. 429, 503).
      if (!response.ok) {
        throw new Error(`[Sparklytics] collect endpoint returned ${response.status}`)
      }
    }

    try {
      await send()
    } catch {
      // Retry once after 2 seconds, then drop — events are fire-and-forget.
      // The queue was already spliced above so failed events are not re-queued;
      // subsequent track() calls continue to work normally.
      setTimeout(async () => {
        try {
          await send()
        } catch {
          // Drop silently — never throw on the host page
        }
      }, 2000)
    }
  })

  // Enqueue an event and schedule a flush
  const enqueue = (event: BatchEvent) => {
    if (blockedRef.current) return

    // Dedup: skip pageview if same URL was enqueued within the last 100ms.
    // Prevents double-pageview when history.pushState monkey-patch and
    // next/router routeChangeComplete both fire for the same Pages Router navigation.
    if (event.type === 'pageview') {
      const now = Date.now()
      if (
        lastPageviewRef.current?.url === event.url &&
        now - lastPageviewRef.current.ts < 100
      ) {
        return
      }
      lastPageviewRef.current = { url: event.url, ts: now }
    }

    // Enrich with the identified visitor ID, if one has been set via identify().
    const visitorId =
      typeof window !== 'undefined' ? getIdentifiedVisitor() : undefined
    const enriched: BatchEvent = visitorId
      ? { ...event, visitor_id: visitorId }
      : event

    queueRef.current.push(enriched)

    // Flush immediately if batch reaches 10 events
    if (queueRef.current.length >= 10) {
      void flush.current()
      return
    }

    // Otherwise debounce: flush 500ms after first event in batch
    if (!flushTimerRef.current) {
      flushTimerRef.current = setTimeout(() => {
        void flush.current()
      }, 500)
    }
  }

  // Track pageview on mount; wire beforeunload and SPA navigation
  useEffect(() => {
    blockedRef.current =
      !websiteId || disabled || isPrivacyBlocked(respectDnt)

    if (blockedRef.current) return

    // Initial pageview
    enqueue({
      website_id: websiteId,
      type: 'pageview',
      url: window.location.pathname,
      referrer: document.referrer || undefined,
      ...getPageviewExtras(),
    })

    // Flush on tab close (best-effort via sendBeacon)
    const handleUnload = () => { void flush.current() }
    window.addEventListener('beforeunload', handleUnload)

    // SPA navigation detection via History.pushState monkey-patch.
    // Catches all SPA navigations including App Router and Pages Router transitions.
    const originalPushState = history.pushState.bind(history)
    history.pushState = (...args: Parameters<typeof history.pushState>) => {
      originalPushState(...args)
      enqueue({
        website_id: websiteId,
        type: 'pageview',
        url: window.location.pathname,
        referrer: document.referrer || undefined,
        ...getPageviewExtras(),
      })
    }

    // Also handle popstate (back/forward)
    const handlePopState = () => {
      enqueue({
        website_id: websiteId,
        type: 'pageview',
        url: window.location.pathname,
        referrer: document.referrer || undefined,
        ...getPageviewExtras(),
      })
    }
    window.addEventListener('popstate', handlePopState)

    // Pages Router: listen to routeChangeComplete for router.replace() / shallow routing.
    // Dynamic import avoids breaking App Router builds where next/router is not in use.
    let cleanupPagesRouter: (() => void) | null = null
    import('next/router')
      .then(mod => {
        const router = mod.default
        const handleRouteChange = (url: string) => {
          enqueue({
            website_id: websiteId,
            type: 'pageview',
            url,
            referrer: document.referrer || undefined,
            ...getPageviewExtras(),
          })
        }
        router.events?.on('routeChangeComplete', handleRouteChange)
        cleanupPagesRouter = () => {
          router.events?.off('routeChangeComplete', handleRouteChange)
        }
      })
      .catch(() => {
        // next/router not available (App Router project) — pushState monkey-patch handles it
      })

    // Link click delegation — tracks ALL <a href> clicks when trackLinks is enabled.
    // Uses capture phase so we fire before React's synthetic onClick handlers
    // (and before Next.js can preventDefault for client-side navigation).
    // The tracking is fire-and-forget; we never interfere with navigation.
    let cleanupLinkTracking: (() => void) | null = null
    if (trackLinks) {
      const handleLinkClick = (e: MouseEvent) => {
        if (blockedRef.current) return

        // Walk up from the click target to find the nearest <a href>
        const anchor = (e.target as HTMLElement | null)?.closest<HTMLAnchorElement>('a[href]')
        if (!anchor) return

        const rawHref = anchor.getAttribute('href') ?? ''
        // Skip hash-only anchors (e.g. "#", "#section") and javascript: pseudo-links
        if (!rawHref || rawHref.startsWith('#') || rawHref.startsWith('javascript:')) return

        let href = rawHref
        let external = false
        try {
          const url = new URL(rawHref, window.location.href)
          external = url.origin !== window.location.origin
          // Normalise: full URL for external, pathname+search+hash for internal
          href = external ? url.href : url.pathname + url.search + url.hash
        } catch {
          // Malformed href (e.g. mailto:, tel:) — use raw value, treat as external
          external = true
        }

        // 'outbound' mode: skip internal links
        if (trackLinks === 'outbound' && !external) return

        // Capture visible link text (trimmed, collapsed whitespace, max 100 chars)
        const text = anchor.textContent?.trim().replace(/\s+/g, ' ').slice(0, 100) || undefined

        enqueue({
          website_id: websiteId,
          type: 'event',
          url: window.location.pathname,
          event_name: 'link_click',
          event_data: {
            href,
            ...(text ? { text } : {}),
            ...(external ? { external: true } : {}),
          },
        })
      }

      document.addEventListener('click', handleLinkClick, { capture: true })
      cleanupLinkTracking = () =>
        document.removeEventListener('click', handleLinkClick, { capture: true })
    }

    // Scroll depth tracking — fires "scroll_depth" event at configurable percentage thresholds.
    // Each threshold fires at most once per page URL; resets automatically on navigation.
    let cleanupScrollTracking: (() => void) | null = null
    if (trackScrollDepth !== false) {
      const thresholds: number[] =
        Array.isArray(trackScrollDepth) ? trackScrollDepth : [25, 50, 75, 100]

      // Mutable state for the current page's fired set and its URL.
      // Checked and reset lazily at scroll time for zero overhead on navigation.
      let scrollFired = new Set<number>()
      let lastScrollUrl = window.location.pathname

      const handleScroll = () => {
        if (blockedRef.current) return

        // Reset fired set when the URL has changed (SPA navigation happened since last scroll).
        const currentUrl = window.location.pathname
        if (currentUrl !== lastScrollUrl) {
          scrollFired = new Set<number>()
          lastScrollUrl = currentUrl
        }

        const scrollTop = window.scrollY ?? document.documentElement.scrollTop
        const docHeight =
          document.documentElement.scrollHeight - window.innerHeight
        if (docHeight <= 0) return

        const pct = Math.round((scrollTop / docHeight) * 100)

        for (const threshold of thresholds) {
          if (pct >= threshold && !scrollFired.has(threshold)) {
            scrollFired.add(threshold)
            enqueue({
              website_id: websiteId,
              type: 'event',
              url: currentUrl,
              event_name: 'scroll_depth',
              event_data: { depth: threshold },
            })
          }
        }
      }

      window.addEventListener('scroll', handleScroll, { passive: true })
      cleanupScrollTracking = () => window.removeEventListener('scroll', handleScroll)
    }

    // Form submission tracking — fires "form_submit" event on every <form> submit.
    // Uses capture phase so we fire before the form's own submit handler.
    let cleanupFormTracking: (() => void) | null = null
    if (trackForms) {
      const handleSubmit = (e: Event) => {
        if (blockedRef.current) return
        const form = e.target as HTMLFormElement | null
        if (!form || form.tagName !== 'FORM') return

        const data: Record<string, unknown> = {}
        if (form.id) data['form_id'] = form.id
        if (form.name) data['form_name'] = form.name
        // Include action only if it's a real URL (not a javascript: pseudo-href)
        if (form.action && !form.action.startsWith('javascript:')) {
          data['action'] = form.action
        }

        enqueue({
          website_id: websiteId,
          type: 'event',
          url: window.location.pathname,
          event_name: 'form_submit',
          event_data: data,
        })
      }

      document.addEventListener('submit', handleSubmit, { capture: true })
      cleanupFormTracking = () =>
        document.removeEventListener('submit', handleSubmit, { capture: true })
    }

    return () => {
      window.removeEventListener('beforeunload', handleUnload)
      window.removeEventListener('popstate', handlePopState)
      history.pushState = originalPushState
      cleanupPagesRouter?.()
      cleanupLinkTracking?.()
      cleanupScrollTracking?.()
      cleanupFormTracking?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [websiteId, disabled, respectDnt, trackLinks, trackScrollDepth, trackForms])

  // Custom event tracker exposed via hook.
  // The implementation signature accepts the union of both overloads.
  const track = (eventName: string, eventData?: Record<string, unknown>) => {
    enqueue({
      website_id: websiteId,
      type: 'event',
      url: typeof window !== 'undefined' ? window.location.pathname : '/',
      referrer: typeof document !== 'undefined' ? document.referrer || undefined : undefined,
      event_name: eventName,
      event_data: eventData,
    })
  }

  // Manual pageview — lets consumers fire a pageview outside of automatic navigation detection.
  // Useful for full-screen modals, multi-step wizards, or virtual pages.
  const pageview = (url?: string) => {
    enqueue({
      website_id: websiteId,
      type: 'pageview',
      url: url ?? (typeof window !== 'undefined' ? window.location.pathname : '/'),
      referrer: typeof document !== 'undefined' ? document.referrer || undefined : undefined,
      ...getPageviewExtras(),
    })
  }

  // Hook context versions — delegate to the module-level standalone functions
  // so that useSparklytics().identify() and the imported identify() share
  // exactly the same localStorage implementation.
  const identifyCtx = (visitorId: string): void => _setVisitorId(visitorId)
  const resetCtx = (): void => _clearVisitorId()

  return React.createElement(
    SparklyticsContext.Provider,
    { value: { track, pageview, identify: identifyCtx, reset: resetCtx } },
    React.createElement(AppRouterTracker, {
      // enqueue() reads blockedRef.current internally, so no need to pass disabled here.
      onNavigate: (url: string) => {
        enqueue({
          website_id: websiteId,
          type: 'pageview',
          url,
          referrer: typeof document !== 'undefined' ? document.referrer || undefined : undefined,
          ...getPageviewExtras(),
        })
      },
    }),
    children,
  )
}

// ============================================================
// AppRouterTracker — internal child component
//
// Uses usePathname() from next/navigation to detect App Router
// navigations, including router.replace() calls that bypass
// history.pushState (which the parent's monkey-patch misses).
//
// The initial pageview is handled by SparklyticsProvider's main
// useEffect; AppRouterTracker only fires on subsequent path changes.
//
// Duplicate pageviews (pushState + usePathname firing for the same
// navigation) are caught by the 100ms URL-based dedup in enqueue().
// ============================================================

interface AppRouterTrackerProps {
  onNavigate: (url: string) => void
}

function AppRouterTracker({ onNavigate }: AppRouterTrackerProps) {
  const rawPathname = usePathname()
  // usePathname() returns null outside a Next.js context (rare edge case).
  // Fall back to '/' so prevPathRef always gets a defined initial value.
  const pathname = rawPathname ?? '/'

  const prevPathRef = useRef<string | null>(null)

  // Keep onNavigate stable via ref to avoid stale closure without
  // adding it to the effect's dependency array.
  const onNavigateRef = useRef(onNavigate)
  onNavigateRef.current = onNavigate

  useEffect(() => {
    if (prevPathRef.current === null) {
      // First mount — record initial path, don't fire (parent handles initial pageview).
      prevPathRef.current = pathname
      return
    }
    if (prevPathRef.current !== pathname) {
      onNavigateRef.current(pathname)
      prevPathRef.current = pathname
    }
  }, [pathname])

  return null
}

// ============================================================
// useSparklytics hook
// Safe to call in Client Components.
// Returns no-op context default when called outside a Provider.
// ============================================================

export function useSparklytics(): SparklyticsHook {
  return useContext(SparklyticsContext)
}

// ============================================================
// TrackedLink — Next.js <Link> wrapper with automatic click tracking
//
// Drop-in replacement for next/link's <Link>. Fires a Sparklytics
// event on every click with the href automatically captured so you
// never have to wire onClick manually.
//
// Usage:
//   <TrackedLink href="/pricing">View pricing</TrackedLink>
//
//   // Custom event name + extra data:
//   <TrackedLink href="/blog/post" eventName="blog_cta" eventData={{ position: 'hero' }}>
//     Read post
//   </TrackedLink>
// ============================================================

export interface TrackedLinkProps extends React.ComponentPropsWithoutRef<typeof Link> {
  /**
   * Sparklytics event name fired on click.
   * @default "link_click"
   */
  eventName?: string
  /**
   * Extra event payload merged with the auto-captured `href`.
   * Useful for tracking position, variant, or other context.
   */
  eventData?: Record<string, unknown>
}

// ============================================================
// Track — declarative event tracker (JSX wrapper)
// ============================================================

/** DOM events that `<Track>` can listen to. */
export type TrackTrigger = 'click' | 'focus' | 'blur' | 'mouseenter' | 'mouseleave' | 'submit'

export interface TrackProps {
  /**
   * Sparklytics event name fired when the trigger fires.
   * Max 50 chars.
   */
  event: string
  /**
   * Optional event payload. Max 4 KB JSON-serialized.
   */
  data?: Record<string, unknown>
  /**
   * DOM event that triggers analytics tracking.
   *
   * - `'click'`      — button clicks, link clicks (default)
   * - `'focus'`      — input focus (form field reached)
   * - `'blur'`       — input blur (user left the field)
   * - `'mouseenter'` — cursor entered the element (hover start)
   * - `'mouseleave'` — cursor left the element (hover end)
   * - `'submit'`     — form submission
   *
   * @default 'click'
   */
  trigger?: TrackTrigger
  /**
   * Must be a single React element. The chosen event handler is injected
   * without replacing any existing handler on the child.
   */
  children: React.ReactElement
}

/** Map from `TrackTrigger` to the React synthetic event handler prop name. */
const TRIGGER_HANDLER: Record<TrackTrigger, string> = {
  click:      'onClick',
  focus:      'onFocus',
  blur:       'onBlur',
  mouseenter: 'onMouseEnter',
  mouseleave: 'onMouseLeave',
  submit:     'onSubmit',
}

/**
 * Declarative wrapper that fires a Sparklytics event when any DOM interaction
 * occurs on its child element — no `useSparklytics()` call required.
 *
 * Works with any element type. Existing event handlers on the child are
 * preserved and called after tracking.
 *
 * @example Click tracking (default)
 * ```tsx
 * <Track event="cta_clicked" data={{ plan: 'pro' }}>
 *   <button>Start free trial</button>
 * </Track>
 * ```
 *
 * @example Hover tracking
 * ```tsx
 * <Track event="pricing_hovered" trigger="mouseenter">
 *   <div className="pricing-card">...</div>
 * </Track>
 * ```
 *
 * @example Form focus tracking
 * ```tsx
 * <Track event="email_field_focused" trigger="focus">
 *   <input type="email" placeholder="you@example.com" />
 * </Track>
 * ```
 */
export function Track({ event: eventName, data, trigger = 'click', children }: TrackProps) {
  const { track } = useSparklytics()
  const child = React.Children.only(children)
  const handlerKey = TRIGGER_HANDLER[trigger]
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
  const existing = (child.props as any)[handlerKey]

  return React.cloneElement(child, {
    [handlerKey]: (e: React.SyntheticEvent) => {
      track(eventName, data)
      if (typeof existing === 'function') existing(e)
    },
  } as Record<string, unknown>)
}

// ============================================================
// usePageview — standalone Pages Router hook
// ============================================================

export interface UsePageviewOptions {
  /**
   * Website ID from your Sparklytics dashboard.
   * Falls back to `NEXT_PUBLIC_SPARKLYTICS_WEBSITE_ID` when omitted.
   */
  websiteId?: string
  /**
   * Base URL of your Sparklytics server.
   * Falls back to `NEXT_PUBLIC_SPARKLYTICS_HOST` when omitted.
   * Omit for same-origin setups.
   */
  host?: string
  /**
   * Disable all tracking (e.g. for dev/staging).
   * @default false
   */
  disabled?: boolean
  /**
   * Respect DNT and GPC privacy signals.
   * @default true
   */
  respectDnt?: boolean
}

/**
 * Standalone hook for automatic pageview tracking in **Pages Router** apps.
 *
 * Call once in `pages/_app.tsx` — it wires up:
 * - **Initial pageview** on mount
 * - **Route changes** via `next/router` `routeChangeComplete`
 * - **Back/forward navigation** via `popstate`
 *
 * Reads `NEXT_PUBLIC_SPARKLYTICS_WEBSITE_ID` and `NEXT_PUBLIC_SPARKLYTICS_HOST`
 * from env vars automatically when no options are passed.
 *
 * For **App Router**, use `<SparklyticsProvider>` instead — it handles routing
 * automatically via `usePathname()`.
 *
 * @example Zero-config (recommended for most apps)
 * ```tsx
 * // pages/_app.tsx
 * import type { AppProps } from 'next/app'
 * import { usePageview } from '@sparklytics/next'
 *
 * export default function App({ Component, pageProps }: AppProps) {
 *   usePageview()
 *   return <Component {...pageProps} />
 * }
 * ```
 *
 * @example With explicit options
 * ```tsx
 * usePageview({
 *   websiteId: 'site_abc123',
 *   host: 'https://analytics.example.com',
 *   respectDnt: true,
 * })
 * ```
 */
export function usePageview(options?: UsePageviewOptions): void {
  useEffect(() => {
    const websiteId =
      options?.websiteId ??
      (typeof process !== 'undefined'
        ? process.env.NEXT_PUBLIC_SPARKLYTICS_WEBSITE_ID ?? ''
        : '')
    const host =
      options?.host ??
      (typeof process !== 'undefined'
        ? process.env.NEXT_PUBLIC_SPARKLYTICS_HOST ?? ''
        : '')

    if (!websiteId || options?.disabled) return
    if (options?.respectDnt !== false && isPrivacyBlocked(true)) return

    const collectUrl = host
      ? `${host.replace(/\/$/, '')}/api/collect`
      : '/api/collect'

    const sendPageview = (url: string): void => {
      if (typeof navigator === 'undefined') return

      const event: BatchEvent = {
        website_id: websiteId,
        type: 'pageview',
        url,
        ...getPageviewExtras(),
      }

      // Attach identified visitor ID if set
      const visitorId = getIdentifiedVisitor()
      if (visitorId) event.visitor_id = visitorId

      const body = JSON.stringify([event])
      try {
        if (navigator.sendBeacon) {
          navigator.sendBeacon(
            collectUrl,
            new Blob([body], { type: 'application/json' }),
          )
        } else {
          void fetch(collectUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
            keepalive: true,
          }).catch(() => {
            // Fire-and-forget — never throw on the host page
          })
        }
      } catch {
        // Never throw
      }
    }

    // Initial pageview
    sendPageview(window.location.pathname)

    // Pages Router route changes
    let pagesRouterCleanup: (() => void) | null = null
    import('next/router')
      .then((mod) => {
        const router = mod.default
        const handle = (url: string) => sendPageview(url)
        router.events?.on('routeChangeComplete', handle)
        pagesRouterCleanup = () => router.events?.off('routeChangeComplete', handle)
      })
      .catch(() => {
        // App Router — next/router not in use; ignore
      })

    // Back/forward navigation
    const handlePopState = () => sendPageview(window.location.pathname)
    window.addEventListener('popstate', handlePopState)

    return () => {
      window.removeEventListener('popstate', handlePopState)
      pagesRouterCleanup?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}

// ============================================================
// TrackedLink — Next.js <Link> wrapper
// ============================================================

/**
 * Next.js-aware `<Link>` wrapper that fires a Sparklytics event on every click.
 *
 * The `href` prop is automatically captured as `{ href: '...' }` in event data.
 * Any `eventData` you provide is merged alongside it.
 * Existing `onClick` handlers are preserved and called after tracking.
 *
 * For UrlObject hrefs (e.g. `{ pathname: '/products', query: { id: 42 } }`)
 * the `href` in event data is derived from `pathname`.
 */
export function TrackedLink({
  eventName = 'link_click',
  eventData,
  onClick,
  ...linkProps
}: TrackedLinkProps) {
  const { track } = useSparklytics()

  const handleClick: React.MouseEventHandler<HTMLAnchorElement> = (e) => {
    // Resolve href to a string for the event payload.
    // next/link accepts string | UrlObject; for objects use pathname.
    const href =
      typeof linkProps.href === 'string'
        ? linkProps.href
        : (linkProps.href as { pathname?: string })?.pathname ?? ''

    track(eventName, { href, ...eventData })

    if (typeof onClick === 'function') onClick(e)
  }

  return React.createElement(Link, { ...linkProps, onClick: handleClick })
}
