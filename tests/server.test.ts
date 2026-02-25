/**
 * @sparklytics/next — Server-side helpers test suite (src/server.ts)
 *
 * No React / DOM involved. Tests pure fetch-based tracking functions.
 * Runs under happy-dom (same vitest config) — the DOM globals are present
 * but unused; global fetch is available for mocking.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  trackServerPageview,
  trackServerEvent,
  createServerClient,
  withAnalytics,
  trackServerMiddleware,
  type WithAnalyticsConfig,
} from '../src/server'

// ──────────────────────────────────────────────────────────────
// Setup / teardown
// ──────────────────────────────────────────────────────────────

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

// ──────────────────────────────────────────────────────────────
// Feature: trackServerPageview
// ──────────────────────────────────────────────────────────────

describe('trackServerPageview', () => {
  it('test_trackServerPageview_basic — sends pageview to correct endpoint with required fields', async () => {
    await trackServerPageview({
      host: 'https://analytics.example.com',
      websiteId: 'site_abc123',
      url: '/checkout',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://analytics.example.com/api/collect')

    const body = JSON.parse(init.body as string) as unknown[]
    expect(Array.isArray(body)).toBe(true)
    expect(body).toHaveLength(1)
    const event = body[0] as Record<string, unknown>
    expect(event['type']).toBe('pageview')
    expect(event['website_id']).toBe('site_abc123')
    expect(event['url']).toBe('/checkout')
  })

  it('test_trackServerPageview_trailing_slash — host trailing slash is trimmed', async () => {
    await trackServerPageview({
      host: 'https://analytics.example.com/',
      websiteId: 'site_1',
      url: '/home',
    })

    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toBe('https://analytics.example.com/api/collect')
    expect(url.replace('https://', '')).not.toContain('//')
  })

  it('test_trackServerPageview_optional_fields — referrer and language are forwarded', async () => {
    await trackServerPageview({
      host: 'https://analytics.example.com',
      websiteId: 'site_1',
      url: '/landing',
      referrer: 'https://google.com',
      language: 'pl-PL',
    })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const event = (JSON.parse(init.body as string) as Record<string, unknown>[])[0]
    expect(event['referrer']).toBe('https://google.com')
    expect(event['language']).toBe('pl-PL')
  })

  it('test_trackServerPageview_user_agent_forwarded — userAgent is sent as User-Agent header', async () => {
    const ua = 'Mozilla/5.0 (compatible; MyBot/1.0)'
    await trackServerPageview({
      host: 'https://analytics.example.com',
      websiteId: 'site_1',
      url: '/page',
      userAgent: ua,
    })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    expect(headers['User-Agent']).toBe(ua)
  })

  it('test_trackServerPageview_ip_forwarded — ip is sent as X-Forwarded-For header', async () => {
    await trackServerPageview({
      host: 'https://analytics.example.com',
      websiteId: 'site_1',
      url: '/page',
      ip: '203.0.113.42',
    })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    expect(headers['X-Forwarded-For']).toBe('203.0.113.42')
  })

  it('test_trackServerPageview_http_error_throws — non-2xx response rejects the promise', async () => {
    fetchMock.mockResolvedValue(new Response('Bad Request', { status: 400 }))

    await expect(
      trackServerPageview({
        host: 'https://analytics.example.com',
        websiteId: 'site_1',
        url: '/page',
      }),
    ).rejects.toThrow('[Sparklytics] server collect returned 400')
  })
})

// ──────────────────────────────────────────────────────────────
// Feature: trackServerEvent
// ──────────────────────────────────────────────────────────────

describe('trackServerEvent', () => {
  it('test_trackServerEvent_basic — sends event with eventName and eventData', async () => {
    await trackServerEvent({
      host: 'https://analytics.example.com',
      websiteId: 'site_abc123',
      url: '/checkout',
      eventName: 'purchase',
      eventData: { cart_value: 49.99, currency: 'USD' },
    })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const event = (JSON.parse(init.body as string) as Record<string, unknown>[])[0]
    expect(event['type']).toBe('event')
    expect(event['event_name']).toBe('purchase')
    expect(event['event_data']).toEqual({ cart_value: 49.99, currency: 'USD' })
    expect(event['website_id']).toBe('site_abc123')
    expect(event['url']).toBe('/checkout')
  })

  it('test_trackServerEvent_no_event_data — omitting eventData sends event without event_data field', async () => {
    await trackServerEvent({
      host: 'https://analytics.example.com',
      websiteId: 'site_1',
      url: '/signup',
      eventName: 'signup_completed',
    })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const event = (JSON.parse(init.body as string) as Record<string, unknown>[])[0]
    expect(event['event_name']).toBe('signup_completed')
    expect(event['event_data']).toBeUndefined()
  })

  it('test_trackServerEvent_headers_forwarded — userAgent and ip sent as request headers', async () => {
    await trackServerEvent({
      host: 'https://analytics.example.com',
      websiteId: 'site_1',
      url: '/api/checkout',
      eventName: 'purchase',
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64)',
      ip: '198.51.100.7',
    })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    expect(headers['User-Agent']).toBe('Mozilla/5.0 (X11; Linux x86_64)')
    expect(headers['X-Forwarded-For']).toBe('198.51.100.7')
    expect(headers['Content-Type']).toBe('application/json')
  })

  it('test_trackServerEvent_http_error_throws — server error rejects with descriptive message', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 503, statusText: 'Service Unavailable' }))

    await expect(
      trackServerEvent({
        host: 'https://analytics.example.com',
        websiteId: 'site_1',
        url: '/page',
        eventName: 'test_event',
      }),
    ).rejects.toThrow('[Sparklytics] server collect returned 503')
  })

  it('test_trackServerEvent_network_error_throws — fetch rejection propagates to caller', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))

    await expect(
      trackServerEvent({
        host: 'https://analytics.example.com',
        websiteId: 'site_1',
        url: '/page',
        eventName: 'test_event',
      }),
    ).rejects.toThrow('ECONNREFUSED')
  })

  it('test_trackServerEvent_body_is_array — POST body is always a JSON array', async () => {
    await trackServerEvent({
      host: 'https://analytics.example.com',
      websiteId: 'site_1',
      url: '/page',
      eventName: 'click',
    })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const parsed = JSON.parse(init.body as string) as unknown
    expect(Array.isArray(parsed)).toBe(true)
    expect((parsed as unknown[]).length).toBe(1)
  })
})

// ──────────────────────────────────────────────────────────────
// Feature: createServerClient
// ──────────────────────────────────────────────────────────────

describe('createServerClient', () => {
  it('test_createServerClient_trackPageview — uses configured host and websiteId', async () => {
    const analytics = createServerClient({
      host: 'https://analytics.example.com',
      websiteId: 'site_configured',
    })

    await analytics.trackPageview({ url: '/home' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://analytics.example.com/api/collect')

    const event = (JSON.parse(init.body as string) as Record<string, unknown>[])[0]
    expect(event['website_id']).toBe('site_configured')
    expect(event['type']).toBe('pageview')
    expect(event['url']).toBe('/home')
  })

  it('test_createServerClient_trackEvent — uses configured host and websiteId', async () => {
    const analytics = createServerClient({
      host: 'https://analytics.example.com',
      websiteId: 'site_configured',
    })

    await analytics.trackEvent({
      url: '/checkout',
      eventName: 'purchase',
      eventData: { cart_value: 49.99, currency: 'USD' },
    })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const event = (JSON.parse(init.body as string) as Record<string, unknown>[])[0]
    expect(event['website_id']).toBe('site_configured')
    expect(event['type']).toBe('event')
    expect(event['event_name']).toBe('purchase')
    expect(event['event_data']).toEqual({ cart_value: 49.99, currency: 'USD' })
  })

  it('test_createServerClient_per_call_options — per-call fields (url, userAgent, ip) still accepted', async () => {
    const analytics = createServerClient({
      host: 'https://analytics.example.com',
      websiteId: 'site_1',
    })

    await analytics.trackEvent({
      url: '/api/checkout',
      eventName: 'purchase',
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)',
      ip: '10.0.0.1',
      referrer: 'https://google.com',
      language: 'en-GB',
    })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    expect(headers['User-Agent']).toBe('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)')
    expect(headers['X-Forwarded-For']).toBe('10.0.0.1')

    const event = (JSON.parse(init.body as string) as Record<string, unknown>[])[0]
    expect(event['referrer']).toBe('https://google.com')
    expect(event['language']).toBe('en-GB')
  })

  it('test_createServerClient_trailing_slash — host trailing slash is trimmed', async () => {
    const analytics = createServerClient({
      host: 'https://analytics.example.com/',
      websiteId: 'site_1',
    })

    await analytics.trackPageview({ url: '/home' })

    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toBe('https://analytics.example.com/api/collect')
  })

  it('test_createServerClient_independent_instances — two clients with different configs do not share state', async () => {
    const clientA = createServerClient({
      host: 'https://a.example.com',
      websiteId: 'site_aaa',
    })
    const clientB = createServerClient({
      host: 'https://b.example.com',
      websiteId: 'site_bbb',
    })

    await clientA.trackPageview({ url: '/page-a' })
    await clientB.trackPageview({ url: '/page-b' })

    expect(fetchMock).toHaveBeenCalledTimes(2)

    const [urlA, initA] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(urlA).toBe('https://a.example.com/api/collect')
    const eventA = (JSON.parse(initA.body as string) as Record<string, unknown>[])[0]
    expect(eventA['website_id']).toBe('site_aaa')

    const [urlB, initB] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(urlB).toBe('https://b.example.com/api/collect')
    const eventB = (JSON.parse(initB.body as string) as Record<string, unknown>[])[0]
    expect(eventB['website_id']).toBe('site_bbb')
  })

  it('test_createServerClient_silent_by_default — errors become warnings, promise resolves', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 500, statusText: 'Internal Server Error' }))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const analytics = createServerClient({
      host: 'https://analytics.example.com',
      websiteId: 'site_1',
    })

    // Default silent: true — should resolve (not reject) even on 500
    await expect(analytics.trackPageview({ url: '/page' })).resolves.toBeUndefined()
    await expect(analytics.trackEvent({ url: '/page', eventName: 'click' })).resolves.toBeUndefined()
    expect(warnSpy).toHaveBeenCalledTimes(2)

    warnSpy.mockRestore()
  })

  it('test_createServerClient_strict_mode — silent: false makes errors propagate', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 500, statusText: 'Internal Server Error' }))

    const analytics = createServerClient({
      host: 'https://analytics.example.com',
      websiteId: 'site_1',
      silent: false,
    })

    await expect(analytics.trackPageview({ url: '/page' })).rejects.toThrow(
      '[Sparklytics] server collect returned 500',
    )
    await expect(
      analytics.trackEvent({ url: '/page', eventName: 'click' }),
    ).rejects.toThrow('[Sparklytics] server collect returned 500')
  })

  it('test_createServerClient_env_fallback — reads host and websiteId from env when config omitted', async () => {
    vi.stubEnv('SPARKLYTICS_HOST', 'https://env.example.com')
    vi.stubEnv('SPARKLYTICS_WEBSITE_ID', 'site_from_env')

    const analytics = createServerClient()

    await analytics.trackPageview({ url: '/home' })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://env.example.com/api/collect')
    const event = (JSON.parse(init.body as string) as Record<string, unknown>[])[0]
    expect(event['website_id']).toBe('site_from_env')
  })

  it('test_createServerClient_env_fallback_partial — explicit config overrides env', async () => {
    vi.stubEnv('SPARKLYTICS_HOST', 'https://env.example.com')
    vi.stubEnv('SPARKLYTICS_WEBSITE_ID', 'site_from_env')

    // Explicit host overrides env; websiteId still falls back to env
    const analytics = createServerClient({ host: 'https://explicit.example.com' })
    await analytics.trackPageview({ url: '/page' })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://explicit.example.com/api/collect')
    const event = (JSON.parse(init.body as string) as Record<string, unknown>[])[0]
    expect(event['website_id']).toBe('site_from_env')
  })

  it('test_createServerClient_explicit_silent_true — explicitly passing silent: true still works', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 503, statusText: 'Service Unavailable' }))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const analytics = createServerClient({
      host: 'https://analytics.example.com',
      websiteId: 'site_1',
      silent: true,
    })

    await expect(analytics.trackPageview({ url: '/page' })).resolves.toBeUndefined()
    await expect(analytics.trackEvent({ url: '/page', eventName: 'click' })).resolves.toBeUndefined()
    expect(warnSpy).toHaveBeenCalledTimes(2)
    expect(warnSpy.mock.calls[0]?.[0]).toContain('[Sparklytics]')

    warnSpy.mockRestore()
  })

  it('test_createServerClient_fromRequest_extracts_headers — url, userAgent, ip, language auto-populated', async () => {
    // Note: 'referer' is a Fetch API forbidden header — browsers and happy-dom silently
    // drop it when set via `new Request()`. In real Next.js Route Handlers the header
    // arrives from the actual HTTP request and is extracted correctly. Referrer passing
    // is covered by the standalone trackServerPageview tests above.
    const analytics = createServerClient({
      host: 'https://analytics.example.com',
      websiteId: 'site_1',
    })

    const request = new Request('https://myapp.com/products/42', {
      headers: {
        'user-agent':      'Mozilla/5.0 (iPhone)',
        'x-forwarded-for': '1.2.3.4, 5.6.7.8',
        'accept-language': 'fr-FR',
      },
    })

    await analytics.fromRequest(request).trackPageview()

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://analytics.example.com/api/collect')

    const headers = init.headers as Record<string, string>
    expect(headers['User-Agent']).toBe('Mozilla/5.0 (iPhone)')
    expect(headers['X-Forwarded-For']).toBe('1.2.3.4')  // first IP only

    const event = (JSON.parse(init.body as string) as Record<string, unknown>[])[0]
    expect(event['url']).toBe('/products/42')
    expect(event['language']).toBe('fr-FR')
    expect(event['type']).toBe('pageview')
  })

  it('test_createServerClient_fromRequest_trackEvent — eventName required, url inferred', async () => {
    const analytics = createServerClient({
      host: 'https://analytics.example.com',
      websiteId: 'site_1',
    })

    const request = new Request('https://myapp.com/checkout', {
      method: 'POST',
    })

    await analytics.fromRequest(request).trackEvent({
      eventName: 'purchase',
      eventData: { cart_value: 99.99 },
    })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const event = (JSON.parse(init.body as string) as Record<string, unknown>[])[0]
    expect(event['url']).toBe('/checkout')
    expect(event['event_name']).toBe('purchase')
    expect(event['event_data']).toEqual({ cart_value: 99.99 })
  })

  it('test_createServerClient_fromRequest_override — per-call options override request-derived values', async () => {
    const analytics = createServerClient({
      host: 'https://analytics.example.com',
      websiteId: 'site_1',
    })

    const request = new Request('https://myapp.com/actual-path')

    await analytics.fromRequest(request).trackPageview({
      url: '/override-path',  // explicitly override the auto-extracted url
    })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const event = (JSON.parse(init.body as string) as Record<string, unknown>[])[0]
    expect(event['url']).toBe('/override-path')
  })

  it('test_createServerClient_fromRequest_silent_default — default silent mode applies to fromRequest too', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 500 }))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    // No silent option — default is true
    const analytics = createServerClient({
      host: 'https://analytics.example.com',
      websiteId: 'site_1',
    })

    const request = new Request('https://myapp.com/page')
    await expect(analytics.fromRequest(request).trackPageview()).resolves.toBeUndefined()
    expect(warnSpy).toHaveBeenCalledTimes(1)

    warnSpy.mockRestore()
  })

  it('test_createServerClient_fromRequest_strict — silent: false makes fromRequest errors propagate', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 500 }))

    const analytics = createServerClient({
      host: 'https://analytics.example.com',
      websiteId: 'site_1',
      silent: false,
    })

    const request = new Request('https://myapp.com/page')
    await expect(analytics.fromRequest(request).trackPageview()).rejects.toThrow(
      '[Sparklytics] server collect returned 500',
    )
  })
})

// ──────────────────────────────────────────────────────────────
// Feature: visitorId on one-off helpers
// ──────────────────────────────────────────────────────────────

describe('server-side visitorId', () => {
  it('test_trackServerPageview_visitorId — visitor_id is included in event payload', async () => {
    await trackServerPageview({
      host: 'https://analytics.example.com',
      websiteId: 'site_1',
      url: '/dashboard',
      visitorId: 'abc123def456',
    })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const event = (JSON.parse(init.body as string) as Record<string, unknown>[])[0]
    expect(event['visitor_id']).toBe('abc123def456')
  })

  it('test_trackServerEvent_visitorId — visitor_id is included in event payload', async () => {
    await trackServerEvent({
      host: 'https://analytics.example.com',
      websiteId: 'site_1',
      url: '/checkout',
      eventName: 'purchase',
      visitorId: 'deadbeef1234',
    })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const event = (JSON.parse(init.body as string) as Record<string, unknown>[])[0]
    expect(event['visitor_id']).toBe('deadbeef1234')
  })

  it('test_visitorId_omitted_when_not_set — visitor_id absent when visitorId not provided', async () => {
    await trackServerPageview({
      host: 'https://analytics.example.com',
      websiteId: 'site_1',
      url: '/home',
    })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const event = (JSON.parse(init.body as string) as Record<string, unknown>[])[0]
    expect(event['visitor_id']).toBeUndefined()
  })

  it('test_createServerClient_trackPageview_visitorId — visitorId forwarded via client method', async () => {
    const analytics = createServerClient({
      host: 'https://analytics.example.com',
      websiteId: 'site_1',
    })

    await analytics.trackPageview({ url: '/page', visitorId: 'visitor_from_client' })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const event = (JSON.parse(init.body as string) as Record<string, unknown>[])[0]
    expect(event['visitor_id']).toBe('visitor_from_client')
  })
})

// ──────────────────────────────────────────────────────────────
// Feature: withAnalytics HOC
// ──────────────────────────────────────────────────────────────

describe('withAnalytics', () => {
  it('test_withAnalytics_get_auto_tracks_pageview — GET request auto-fires pageview', async () => {
    const handler = withAnalytics(
      async (_request, _analytics) => Response.json({ ok: true }),
      { host: 'https://analytics.example.com', websiteId: 'site_1' },
    )

    // new Request() defaults to GET
    const request = new Request('https://myapp.com/products')
    await handler(request)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://analytics.example.com/api/collect')
    const event = (JSON.parse(init.body as string) as Record<string, unknown>[])[0]
    expect(event['type']).toBe('pageview')
    expect(event['url']).toBe('/products')
  })

  it('test_withAnalytics_post_no_auto_pageview — POST does not auto-track pageview', async () => {
    const handler = withAnalytics(
      async (_request, _analytics) => Response.json({ ok: true }),
      { host: 'https://analytics.example.com', websiteId: 'site_1' },
    )

    const request = new Request('https://myapp.com/api/checkout', { method: 'POST' })
    await handler(request)

    // No fetch call — POST does not auto-track a pageview
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('test_withAnalytics_post_explicit_pageview_true — pageview:true forces tracking on POST', async () => {
    const config: WithAnalyticsConfig = {
      host: 'https://analytics.example.com',
      websiteId: 'site_1',
      pageview: true,
    }
    const handler = withAnalytics(
      async (_request, _analytics) => Response.json({ ok: true }),
      config,
    )

    const request = new Request('https://myapp.com/api/checkout', { method: 'POST' })
    await handler(request)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const event = (JSON.parse(init.body as string) as Record<string, unknown>[])[0]
    expect(event['type']).toBe('pageview')
  })

  it('test_withAnalytics_get_explicit_pageview_false — pageview:false suppresses tracking on GET', async () => {
    const config: WithAnalyticsConfig = {
      host: 'https://analytics.example.com',
      websiteId: 'site_1',
      pageview: false,
    }
    const handler = withAnalytics(
      async (_request, _analytics) => Response.json({ ok: true }),
      config,
    )

    const request = new Request('https://myapp.com/products') // GET by default
    await handler(request)

    // pageview: false suppresses even though it's a GET
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('test_withAnalytics_injects_analytics — handler receives BoundServerClient', async () => {
    let capturedAnalytics: unknown = null

    const handler = withAnalytics(
      async (_request, analytics) => {
        capturedAnalytics = analytics
        return Response.json({ ok: true })
      },
      { host: 'https://analytics.example.com', websiteId: 'site_1' },
    )

    await handler(new Request('https://myapp.com/page'))

    expect(capturedAnalytics).not.toBeNull()
    expect(typeof (capturedAnalytics as { trackPageview: unknown }).trackPageview).toBe('function')
    expect(typeof (capturedAnalytics as { trackEvent: unknown }).trackEvent).toBe('function')
  })

  it('test_withAnalytics_handler_can_track_additional_events — analytics.trackEvent works inside handler', async () => {
    const handler = withAnalytics(
      async (_request, analytics) => {
        await analytics.trackEvent({ eventName: 'purchase', eventData: { amount: 99.99 } })
        return Response.json({ ok: true })
      },
      { host: 'https://analytics.example.com', websiteId: 'site_1' },
    )

    await handler(new Request('https://myapp.com/checkout'))

    // Two fetches: auto-pageview + explicit event
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [, init] = fetchMock.mock.calls[1] as [string, RequestInit]
    const event = (JSON.parse(init.body as string) as Record<string, unknown>[])[0]
    expect(event['event_name']).toBe('purchase')
    expect(event['event_data']).toEqual({ amount: 99.99 })
  })

  it('test_withAnalytics_returns_handler_response — Response from handler is returned unchanged', async () => {
    const handler = withAnalytics(
      async (_request, _analytics) => new Response('Hello', { status: 201 }),
      { host: 'https://analytics.example.com', websiteId: 'site_1' },
    )

    const response = await handler(new Request('https://myapp.com/'))
    expect(response.status).toBe(201)
    expect(await response.text()).toBe('Hello')
  })

  it('test_withAnalytics_passes_context — context arg forwarded to handler', async () => {
    let capturedContext: unknown = null
    const ctx = { params: { id: '42' } }

    const handler = withAnalytics<{ params: { id: string } }>(
      async (_request, _analytics, context) => {
        capturedContext = context
        return Response.json({ ok: true })
      },
      { host: 'https://analytics.example.com', websiteId: 'site_1' },
    )

    await handler(new Request('https://myapp.com/items/42'), ctx)
    expect(capturedContext).toEqual(ctx)
  })

  it('test_withAnalytics_env_fallback — reads host/websiteId from env when config omitted', async () => {
    vi.stubEnv('SPARKLYTICS_HOST', 'https://env-host.example.com')
    vi.stubEnv('SPARKLYTICS_WEBSITE_ID', 'site_env')

    const handler = withAnalytics(
      async (_request, _analytics) => Response.json({ ok: true }),
    )

    await handler(new Request('https://myapp.com/page'))

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://env-host.example.com/api/collect')
    const event = (JSON.parse(init.body as string) as Record<string, unknown>[])[0]
    expect(event['website_id']).toBe('site_env')
  })

  it('test_withAnalytics_silent_default — tracking errors do not break handler', async () => {
    // Make tracking fail
    fetchMock
      .mockResolvedValueOnce(new Response('', { status: 500 })) // auto-pageview fails
      .mockResolvedValueOnce(new Response('{}', { status: 200 })) // not reached in this test

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const handler = withAnalytics(
      async (_request, _analytics) => Response.json({ ok: true }),
      { host: 'https://analytics.example.com', websiteId: 'site_1' },
    )

    // Handler should still return normally even though tracking failed
    const response = await handler(new Request('https://myapp.com/page'))
    expect(response.status).toBe(200)
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy.mock.calls[0]?.[0]).toContain('[Sparklytics]')

    warnSpy.mockRestore()
  })
})

// ──────────────────────────────────────────────────────────────
// Feature: trackServerMiddleware
// ──────────────────────────────────────────────────────────────

describe('trackServerMiddleware', () => {
  it('test_trackServerMiddleware_sends_pageview — fires pageview with env host/websiteId', async () => {
    vi.stubEnv('SPARKLYTICS_HOST', 'https://analytics.example.com')
    vi.stubEnv('SPARKLYTICS_WEBSITE_ID', 'site_middleware')

    const request = new Request('https://myapp.com/about')
    await trackServerMiddleware(request)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://analytics.example.com/api/collect')
    const event = (JSON.parse(init.body as string) as Record<string, unknown>[])[0]
    expect(event['type']).toBe('pageview')
    expect(event['website_id']).toBe('site_middleware')
    expect(event['url']).toBe('/about')
  })

  it('test_trackServerMiddleware_extracts_headers — userAgent, ip, language auto-populated', async () => {
    vi.stubEnv('SPARKLYTICS_HOST', 'https://analytics.example.com')
    vi.stubEnv('SPARKLYTICS_WEBSITE_ID', 'site_1')

    const request = new Request('https://myapp.com/blog', {
      headers: {
        'user-agent':      'Mozilla/5.0 (Windows NT 10.0)',
        'x-forwarded-for': '203.0.113.5, 10.0.0.1',
        'accept-language': 'de-DE',
      },
    })

    await trackServerMiddleware(request)

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    expect(headers['User-Agent']).toBe('Mozilla/5.0 (Windows NT 10.0)')
    expect(headers['X-Forwarded-For']).toBe('203.0.113.5')

    const event = (JSON.parse(init.body as string) as Record<string, unknown>[])[0]
    expect(event['language']).toBe('de-DE')
  })

  it('test_trackServerMiddleware_silent_by_default — errors do not propagate', async () => {
    vi.stubEnv('SPARKLYTICS_HOST', 'https://analytics.example.com')
    vi.stubEnv('SPARKLYTICS_WEBSITE_ID', 'site_1')
    fetchMock.mockResolvedValue(new Response('', { status: 500 }))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const request = new Request('https://myapp.com/')
    await expect(trackServerMiddleware(request)).resolves.toBeUndefined()
    expect(warnSpy).toHaveBeenCalledTimes(1)

    warnSpy.mockRestore()
  })

  it('test_trackServerMiddleware_strict_mode — silent: false propagates errors', async () => {
    vi.stubEnv('SPARKLYTICS_HOST', 'https://analytics.example.com')
    vi.stubEnv('SPARKLYTICS_WEBSITE_ID', 'site_1')
    fetchMock.mockResolvedValue(new Response('', { status: 503, statusText: 'Service Unavailable' }))

    const request = new Request('https://myapp.com/')
    await expect(trackServerMiddleware(request, { silent: false })).rejects.toThrow(
      '[Sparklytics] server collect returned 503',
    )
  })

  it('test_trackServerMiddleware_url_override — custom url option overrides auto-extracted path', async () => {
    vi.stubEnv('SPARKLYTICS_HOST', 'https://analytics.example.com')
    vi.stubEnv('SPARKLYTICS_WEBSITE_ID', 'site_1')

    const request = new Request('https://myapp.com/actual-path')
    await trackServerMiddleware(request, { url: '/virtual-page' })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const event = (JSON.parse(init.body as string) as Record<string, unknown>[])[0]
    expect(event['url']).toBe('/virtual-page')
  })
})
