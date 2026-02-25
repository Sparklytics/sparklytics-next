/**
 * @sparklytics/next — Server-side tracking helpers
 *
 * Safe to import in:
 *   - Next.js Route Handlers  (app/api/route.ts)
 *   - Server Actions           ('use server' functions)
 *   - Next.js Middleware        (middleware.ts)
 *   - Any Node.js / Edge Runtime code
 *
 * No React, no hooks, no browser APIs.
 *
 * ---
 *
 * ## Recommended patterns
 *
 * ### `withAnalytics` — Route Handler HOC (least boilerplate)
 *
 * Wraps a Route Handler, auto-tracks a pageview, and injects a bound analytics
 * client — all in one line:
 *
 * ```ts
 * // app/api/checkout/route.ts
 * import { withAnalytics } from '@sparklytics/next/server'
 *
 * export const POST = withAnalytics(async (request, analytics) => {
 *   await analytics.trackEvent({ eventName: 'purchase', eventData: { amount: 49.99 } })
 *   return Response.json({ ok: true })
 * })
 * ```
 *
 * ### `trackServerMiddleware` — one-liner for `middleware.ts`
 *
 * ```ts
 * // middleware.ts
 * import { trackServerMiddleware } from '@sparklytics/next/server'
 * import { NextResponse } from 'next/server'
 *
 * export async function middleware(request: Request) {
 *   await trackServerMiddleware(request)   // pageview auto-tracked
 *   return NextResponse.next()
 * }
 * ```
 *
 * ### Zero-config `createServerClient()`
 *
 * Set two env vars, create a client once, import it anywhere — zero per-call
 * configuration needed.
 *
 * ```bash
 * # .env.local
 * SPARKLYTICS_HOST=https://analytics.example.com
 * SPARKLYTICS_WEBSITE_ID=site_abc123def456
 * ```
 *
 * ```ts
 * // lib/analytics.ts  ← create once
 * import { createServerClient } from '@sparklytics/next/server'
 * export const analytics = createServerClient()  // reads env vars automatically
 * ```
 *
 * Then in any Route Handler, Server Action, or Middleware:
 *
 * ```ts
 * import { analytics } from '@/lib/analytics'
 *
 * // Route Handler — one line, headers auto-extracted
 * export async function POST(request: Request) {
 *   await analytics.fromRequest(request).trackEvent({ eventName: 'purchase' })
 * }
 *
 * // Server Action — just the URL and event
 * await analytics.trackEvent({ url: '/checkout', eventName: 'purchase' })
 * ```
 *
 * ---
 *
 * ## One-off helpers (if you prefer no singleton)
 *
 * @example Route Handler
 * ```ts
 * // app/api/checkout/route.ts
 * import { trackServerEvent } from '@sparklytics/next/server'
 *
 * export async function POST(request: Request) {
 *   await trackServerEvent({
 *     host:      process.env.SPARKLYTICS_HOST!,
 *     websiteId: process.env.SPARKLYTICS_WEBSITE_ID!,
 *     url:       new URL(request.url).pathname,
 *     eventName: 'purchase',
 *     eventData: { amount: 49.99, currency: 'USD' },
 *     userAgent: request.headers.get('user-agent') ?? undefined,
 *     ip:        request.headers.get('x-forwarded-for')?.split(',')[0].trim(),
 *   })
 * }
 * ```
 *
 * @example Server Action
 * ```ts
 * 'use server'
 * import { trackServerEvent } from '@sparklytics/next/server'
 *
 * export async function completePurchase(cartValue: number) {
 *   await trackServerEvent({
 *     host:      process.env.SPARKLYTICS_HOST!,
 *     websiteId: process.env.SPARKLYTICS_WEBSITE_ID!,
 *     url:       '/checkout',
 *     eventName: 'purchase',
 *     eventData: { cart_value: cartValue },
 *   })
 * }
 * ```
 */

// ============================================================
// Shared base options
// ============================================================

/**
 * Common fields shared by `trackServerPageview` and `trackServerEvent`.
 */
export interface TrackServerBaseOptions {
  /**
   * Base URL of your Sparklytics server. Required for server-side calls
   * because the server has no implicit same-origin like the browser does.
   *
   * @example "https://analytics.example.com"
   */
  host: string

  /**
   * Website ID from your Sparklytics dashboard.
   * Looks like `site_abc123def456`.
   */
  websiteId: string

  /**
   * URL path to record (e.g. `"/checkout"`, `request.nextUrl.pathname`).
   * Should not include query strings or hash fragments.
   */
  url: string

  /**
   * HTTP Referer / Referrer.
   * Pass `request.headers.get('referer') ?? undefined` from the incoming request.
   */
  referrer?: string

  /**
   * Accept-Language header value (e.g. `"en-US,en;q=0.9"`).
   * Used to populate the Languages breakdown in your dashboard.
   * Pass `request.headers.get('accept-language') ?? undefined`.
   */
  language?: string

  /**
   * User-Agent string from the incoming request.
   * Used server-side for browser / OS / device detection.
   * Pass `request.headers.get('user-agent') ?? undefined`.
   */
  userAgent?: string

  /**
   * Client IP address for geo-lookup (city + country breakdown).
   * The IP is used only for geo-lookup and is **never stored**.
   *
   * Pass `request.headers.get('x-forwarded-for')?.split(',')[0].trim()` or
   * the IP from your hosting platform's request context.
   */
  ip?: string

  /**
   * Optional visitor ID for cross-session stitching.
   *
   * When provided, sent as `visitor_id` in the collect payload so the backend
   * uses this stable identifier instead of computing one from IP + User-Agent.
   * Enables you to connect anonymous visits with logged-in user analytics.
   *
   * **Privacy note:** pass a hashed or tokenised identifier — never a raw email
   * address or numeric user ID. A good default is `sha256(userId).slice(0, 16)`.
   *
   * @example
   * ```ts
   * import { createHash } from 'crypto'
   *
   * const visitorId = createHash('sha256').update(userId).digest('hex').slice(0, 16)
   * await analytics.trackEvent({ url: '/dashboard', eventName: 'login', visitorId })
   * ```
   */
  visitorId?: string
}

// ============================================================
// Pageview options
// ============================================================

/** Options for `trackServerPageview`. */
export type TrackServerPageviewOptions = TrackServerBaseOptions

// ============================================================
// Custom event options
// ============================================================

/** Options for `trackServerEvent`. */
export interface TrackServerEventOptions extends TrackServerBaseOptions {
  /**
   * Name of the custom event. Max 50 characters.
   * Appears under **Events** in your Sparklytics dashboard.
   */
  eventName: string

  /**
   * Optional event payload. Max 4 KB JSON-serialized.
   * Values appear as breakdowns in the Events view.
   */
  eventData?: Record<string, unknown>
}

// ============================================================
// Public API
// ============================================================

/**
 * Track a pageview from server-side code.
 *
 * Sends an HTTP POST to `${host}/api/collect` with a single pageview event.
 * Errors are **not** silently swallowed on the server — the `Promise` will
 * reject if the network request fails or the server returns a non-2xx response.
 * Wrap in `try/catch` if you do not want analytics errors to propagate.
 *
 * @param options - See {@link TrackServerPageviewOptions}
 */
export async function trackServerPageview(
  options: TrackServerPageviewOptions,
): Promise<void> {
  await _send(options, { type: 'pageview' })
}

/**
 * Track a custom event from server-side code.
 *
 * Sends an HTTP POST to `${host}/api/collect` with a single custom event.
 * Errors are **not** silently swallowed on the server — the `Promise` will
 * reject if the network request fails or the server returns a non-2xx response.
 * Wrap in `try/catch` if you do not want analytics errors to propagate.
 *
 * @param options - See {@link TrackServerEventOptions}
 */
export async function trackServerEvent(
  options: TrackServerEventOptions,
): Promise<void> {
  await _send(options, {
    type: 'event',
    event_name: options.eventName,
    ...(options.eventData !== undefined ? { event_data: options.eventData } : {}),
  })
}

// ============================================================
// Server client (centralised config)
// ============================================================

/**
 * Configuration passed to {@link createServerClient}.
 * All fields are optional — unset fields fall back to environment variables.
 */
export interface ServerClientConfig {
  /**
   * Base URL of your Sparklytics server.
   * Falls back to `process.env.SPARKLYTICS_HOST` when omitted.
   *
   * @example "https://analytics.example.com"
   */
  host?: string

  /**
   * Website ID from your Sparklytics dashboard (e.g. `"site_abc123def456"`).
   * Falls back to `process.env.SPARKLYTICS_WEBSITE_ID` when omitted.
   */
  websiteId?: string

  /**
   * When `true` (the default), errors are logged via `console.warn` instead of
   * rejecting the returned `Promise`. Analytics should never break your app.
   *
   * Set to `false` if you want errors to propagate — useful for debugging
   * or when analytics reliability is critical.
   *
   * @default true
   */
  silent?: boolean
}

/**
 * A request-bound client returned by {@link ServerClient.fromRequest}.
 *
 * `url`, `userAgent`, `ip`, `referrer`, and `language` are automatically
 * extracted from the bound `Request` object. All per-call options can still
 * override the extracted values.
 */
export interface BoundServerClient {
  /**
   * Track a pageview. All fields are pre-populated from the bound request.
   * Pass options to override specific fields (e.g. a custom `url`).
   *
   * @param options - All fields optional; `url` defaults to `request.url` pathname.
   */
  trackPageview(
    options?: Partial<Omit<TrackServerPageviewOptions, 'host' | 'websiteId'>>,
  ): Promise<void>

  /**
   * Track a custom event. All request-derived fields are pre-populated.
   * Only `eventName` is required.
   *
   * @param options - `eventName` required; `url` defaults to `request.url` pathname.
   */
  trackEvent(
    options: Omit<TrackServerEventOptions, 'host' | 'websiteId' | 'url'> & { url?: string },
  ): Promise<void>
}

/**
 * A pre-configured analytics client returned by {@link createServerClient}.
 *
 * `host` and `websiteId` are baked in at creation time; no need to repeat
 * them on every call. Use {@link fromRequest} in Route Handlers to
 * additionally pre-populate `url`, `userAgent`, `ip`, and other
 * request-derived fields.
 */
export interface ServerClient {
  /**
   * Track a pageview from server-side code.
   *
   * Accepts every option from {@link TrackServerBaseOptions} **except**
   * `host` and `websiteId`, which are set on the client.
   */
  trackPageview(
    options: Omit<TrackServerPageviewOptions, 'host' | 'websiteId'>,
  ): Promise<void>

  /**
   * Track a custom event from server-side code.
   *
   * Accepts every option from {@link TrackServerEventOptions} **except**
   * `host` and `websiteId`, which are set on the client.
   */
  trackEvent(
    options: Omit<TrackServerEventOptions, 'host' | 'websiteId'>,
  ): Promise<void>

  /**
   * Bind a Next.js / Fetch API `Request` object and return a
   * {@link BoundServerClient} with `url`, `userAgent`, `ip`, `referrer`,
   * and `language` automatically extracted from the request headers.
   *
   * Eliminates all header-extraction boilerplate in Route Handlers:
   *
   * ```ts
   * // Before:
   * await analytics.trackEvent({
   *   url:       new URL(request.url).pathname,
   *   userAgent: request.headers.get('user-agent') ?? undefined,
   *   ip:        request.headers.get('x-forwarded-for')?.split(',')[0].trim(),
   *   eventName: 'purchase',
   * })
   *
   * // After:
   * await analytics.fromRequest(request).trackEvent({ eventName: 'purchase' })
   * ```
   */
  fromRequest(request: Request): BoundServerClient
}

/**
 * Create a pre-configured server analytics client.
 *
 * **Zero-config** — when called with no arguments, `host` and `websiteId` are
 * read from `SPARKLYTICS_HOST` and `SPARKLYTICS_WEBSITE_ID` environment
 * variables automatically.
 *
 * @example Zero-config (recommended)
 * ```ts
 * // lib/analytics.ts  ← set SPARKLYTICS_HOST + SPARKLYTICS_WEBSITE_ID in .env
 * import { createServerClient } from '@sparklytics/next/server'
 * export const analytics = createServerClient()
 * ```
 *
 * @example Explicit config
 * ```ts
 * export const analytics = createServerClient({
 *   host:      process.env.SPARKLYTICS_HOST!,
 *   websiteId: process.env.SPARKLYTICS_WEBSITE_ID!,
 * })
 * ```
 *
 * @example Strict mode — errors propagate instead of being silently warned
 * ```ts
 * export const analytics = createServerClient({ silent: false })
 * ```
 *
 * Then import anywhere:
 * ```ts
 * import { analytics } from '@/lib/analytics'
 *
 * // Route Handler — one line, zero boilerplate
 * export async function POST(request: Request) {
 *   await analytics.fromRequest(request).trackEvent({ eventName: 'purchase' })
 * }
 * ```
 *
 * @param config - Optional {@link ServerClientConfig}. All fields fall back to env vars.
 * @returns A {@link ServerClient} with `trackPageview`, `trackEvent`, and `fromRequest`.
 */
export function createServerClient(config?: ServerClientConfig): ServerClient {
  const host = config?.host ?? process.env.SPARKLYTICS_HOST ?? ''
  const websiteId = config?.websiteId ?? process.env.SPARKLYTICS_WEBSITE_ID ?? ''
  const silent = config?.silent ?? true

  // Wrap a tracking call: either propagate the error or swallow it as a warning.
  const invoke = async (fn: () => Promise<void>): Promise<void> => {
    if (silent) {
      try {
        await fn()
      } catch (err) {
        console.warn('[Sparklytics] server tracking error (silent mode):', err)
      }
    } else {
      await fn()
    }
  }

  // Extract tracking context from a Fetch API Request object.
  const extractFromRequest = (
    request: Request,
  ): Partial<TrackServerBaseOptions> => {
    let url: string
    try {
      url = new URL(request.url).pathname
    } catch {
      url = request.url
    }
    return {
      url,
      userAgent: request.headers.get('user-agent') ?? undefined,
      ip: request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? undefined,
      referrer: request.headers.get('referer') ?? undefined,
      language: request.headers.get('accept-language') ?? undefined,
    }
  }

  return {
    trackPageview: (options) =>
      invoke(() => trackServerPageview({ host, websiteId, ...options })),

    trackEvent: (options) =>
      invoke(() => trackServerEvent({ host, websiteId, ...options })),

    fromRequest: (request: Request): BoundServerClient => {
      const requestDefaults = extractFromRequest(request)
      return {
        trackPageview: (options = {}) =>
          invoke(() =>
            trackServerPageview({ host, websiteId, ...requestDefaults, ...options }),
          ),

        trackEvent: (options) =>
          invoke(() =>
            trackServerEvent({ host, websiteId, ...requestDefaults, ...options }),
          ),
      }
    },
  }
}

// ============================================================
// withAnalytics — Route Handler HOC
// ============================================================

/**
 * Configuration for `withAnalytics`. Extends {@link ServerClientConfig} with
 * HOC-specific options.
 */
export interface WithAnalyticsConfig extends ServerClientConfig {
  /**
   * Whether to automatically track a pageview before calling the handler.
   *
   * Defaults to `true` for GET and HEAD requests, and `false` for all other
   * HTTP methods (POST, PUT, PATCH, DELETE, etc.), following HTTP semantics
   * where GET = page view and mutation verbs = API actions.
   *
   * Override explicitly when needed:
   * - `pageview: true`  — always track (e.g. a POST that renders a page response)
   * - `pageview: false` — never track (e.g. a GET that is a pure data API)
   */
  pageview?: boolean
}

/**
 * Higher-order function that wraps a Next.js Route Handler, injects a
 * pre-bound {@link BoundServerClient}, and automatically tracks a pageview
 * for GET and HEAD requests (following HTTP semantics — mutation verbs such as
 * POST/PUT/DELETE are API actions, not page views).
 *
 * Uses `createServerClient(config)` under the hood, so it reads
 * `SPARKLYTICS_HOST` and `SPARKLYTICS_WEBSITE_ID` from environment variables
 * when no config is supplied.
 *
 * @example GET handler — auto-tracks pageview, injects analytics client
 * ```ts
 * // app/products/route.ts
 * import { withAnalytics } from '@sparklytics/next/server'
 *
 * export const GET = withAnalytics(async (request, analytics) => {
 *   return Response.json({ products: [] })
 * })
 * ```
 *
 * @example POST handler — no auto-pageview; track custom event instead
 * ```ts
 * // app/api/checkout/route.ts
 * import { withAnalytics } from '@sparklytics/next/server'
 *
 * export const POST = withAnalytics(async (request, analytics) => {
 *   const { amount } = await request.json() as { amount: number }
 *   await analytics.trackEvent({ eventName: 'purchase', eventData: { amount } })
 *   return Response.json({ ok: true })
 * })
 * ```
 *
 * @example Dynamic route with params
 * ```ts
 * // app/api/orders/[id]/route.ts
 * import { withAnalytics } from '@sparklytics/next/server'
 *
 * export const GET = withAnalytics(async (request, analytics, context) => {
 *   const { id } = await (context as { params: Promise<{ id: string }> }).params
 *   await analytics.trackEvent({ eventName: 'order_viewed', eventData: { id } })
 *   return Response.json({ id })
 * })
 * ```
 *
 * @param handler - Your Route Handler function, receiving `(request, analytics, context?)`.
 * @param config  - Optional {@link WithAnalyticsConfig} for host, websiteId, silent mode, and pageview control.
 * @returns       A standard Next.js Route Handler `(request, context?) => Promise<Response>`.
 */
export function withAnalytics<TContext = unknown>(
  handler: (
    request: Request,
    analytics: BoundServerClient,
    context?: TContext,
  ) => Response | Promise<Response>,
  config?: WithAnalyticsConfig,
): (request: Request, context?: TContext) => Promise<Response> {
  const client = createServerClient(config)

  return async (request: Request, context?: TContext): Promise<Response> => {
    const bound = client.fromRequest(request)

    // Auto-track a pageview for GET/HEAD (page views) but not for mutation
    // verbs (POST, PUT, PATCH, DELETE) which are API actions, not page views.
    // Set `pageview: true/false` in config to override the default.
    const shouldTrackPageview =
      config?.pageview ?? (request.method === 'GET' || request.method === 'HEAD')

    if (shouldTrackPageview) {
      await bound.trackPageview()
    }

    return handler(request, bound, context)
  }
}

// ============================================================
// trackServerMiddleware — middleware.ts helper
// ============================================================

/**
 * Track a pageview from Next.js middleware with a single line.
 *
 * Reads `SPARKLYTICS_HOST` and `SPARKLYTICS_WEBSITE_ID` from environment
 * variables automatically (same as zero-config `createServerClient()`).
 * Errors are **silent by default** so a tracking failure never breaks routing.
 *
 * The `url`, `userAgent`, `ip`, and `language` are automatically extracted
 * from the request headers — no manual extraction needed.
 *
 * @example Basic middleware tracking
 * ```ts
 * // middleware.ts
 * import { trackServerMiddleware } from '@sparklytics/next/server'
 * import { NextResponse } from 'next/server'
 *
 * export async function middleware(request: Request) {
 *   await trackServerMiddleware(request)
 *   return NextResponse.next()
 * }
 *
 * export const config = { matcher: ['/((?!_next|api).*)'] }
 * ```
 *
 * @example With a custom URL override
 * ```ts
 * await trackServerMiddleware(request, { url: '/custom-virtual-path' })
 * ```
 *
 * @example Strict mode — let errors propagate
 * ```ts
 * await trackServerMiddleware(request, { silent: false })
 * ```
 *
 * @param request - The incoming `Request` (or `NextRequest`).
 * @param options - Optional overrides for any {@link TrackServerPageviewOptions} field
 *                  plus a `silent` flag (default `true`).
 */
export async function trackServerMiddleware(
  request: Request,
  options?: Partial<Omit<TrackServerPageviewOptions, 'host' | 'websiteId'>> & {
    /**
     * When `true` (the default), tracking errors are swallowed as `console.warn`.
     * Set to `false` to make errors propagate — useful when analytics reliability
     * is critical or for debugging.
     *
     * @default true
     */
    silent?: boolean
  },
): Promise<void> {
  const { silent, ...pageviewOptions } = options ?? {}
  const client = createServerClient({ silent: silent ?? true })
  await client.fromRequest(request).trackPageview(pageviewOptions)
}

// ============================================================
// Internal: shared POST logic
// ============================================================

interface EventFields {
  type: 'pageview' | 'event'
  event_name?: string
  event_data?: Record<string, unknown>
}

async function _send(
  base: TrackServerBaseOptions,
  fields: EventFields,
): Promise<void> {
  const endpoint = `${base.host.replace(/\/$/, '')}/api/collect`

  const event: Record<string, unknown> = {
    website_id: base.websiteId,
    url: base.url,
    ...(base.referrer ? { referrer: base.referrer } : {}),
    ...(base.language ? { language: base.language } : {}),
    ...(base.visitorId ? { visitor_id: base.visitorId } : {}),
    ...fields,
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(base.userAgent ? { 'User-Agent': base.userAgent } : {}),
    ...(base.ip ? { 'X-Forwarded-For': base.ip } : {}),
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify([event]),
  })

  if (!response.ok) {
    throw new Error(
      `[Sparklytics] server collect returned ${response.status} ${response.statusText}`,
    )
  }
}
