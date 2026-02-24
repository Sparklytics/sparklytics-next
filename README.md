# @sparklytics/next

Official Next.js SDK for [Sparklytics](https://sparklytics.dev) — open-source, self-hosted, privacy-first analytics.

[![npm](https://img.shields.io/npm/v/@sparklytics/next)](https://www.npmjs.com/package/@sparklytics/next)
[![Bundle size](https://img.shields.io/bundlephobia/minzip/@sparklytics/next)](https://bundlephobia.com/package/@sparklytics/next)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://github.com/Sparklytics/sparklytics/blob/main/LICENSE)

- **Automatic pageview tracking** — App Router and Pages Router, zero config
- **Typed custom events** — TypeScript autocomplete on your own event names and payloads
- **< 5 KB gzipped** — no runtime dependencies beyond React
- **No cookies** — privacy-respecting by default, DNT and GPC supported
- **Batched delivery** — events are queued and sent in one request, not one-per-event
- **Server-side tracking** — Route Handlers, Server Actions, and Middleware via `@sparklytics/next/server`

---

## Requirements

- Next.js 13+ (App Router or Pages Router)
- React 18+
- Node.js 18+ (for server-side helpers)

---

## Installation

```bash
npm install @sparklytics/next
# or
pnpm add @sparklytics/next
# or
yarn add @sparklytics/next
```

---

## Quick start

### Option A — env vars (recommended, zero-config)

Set your env vars once and the provider needs no props:

```bash
# .env.local
NEXT_PUBLIC_SPARKLYTICS_HOST=https://analytics.example.com
NEXT_PUBLIC_SPARKLYTICS_WEBSITE_ID=site_abc123def456
```

```tsx
// app/layout.tsx
import { SparklyticsProvider } from '@sparklytics/next'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body>
        <SparklyticsProvider>{children}</SparklyticsProvider>
      </body>
    </html>
  )
}
```

### Option B — explicit props

```tsx
// app/layout.tsx
import { SparklyticsProvider } from '@sparklytics/next'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body>
        <SparklyticsProvider
          host="https://analytics.example.com"
          websiteId="YOUR_WEBSITE_ID"
        >
          {children}
        </SparklyticsProvider>
      </body>
    </html>
  )
}
```

### Pages Router — `pages/_app.tsx`

```tsx
import type { AppProps } from 'next/app'
import { SparklyticsProvider } from '@sparklytics/next'

// With env vars set (NEXT_PUBLIC_SPARKLYTICS_HOST + NEXT_PUBLIC_SPARKLYTICS_WEBSITE_ID):
export default function App({ Component, pageProps }: AppProps) {
  return (
    <SparklyticsProvider>
      <Component {...pageProps} />
    </SparklyticsProvider>
  )
}
```

That's it. Pageviews are tracked automatically on every route change — including `<Link>` clicks, browser back/forward, `router.push()`, and `router.replace()`.

The SDK automatically collects on every pageview — no extra config needed:

| Field | Source | Powers |
|-------|--------|--------|
| URL | `window.location.pathname` | Pages breakdown |
| Referrer | `document.referrer` | Referrers breakdown |
| Language | `navigator.language` | Languages breakdown |
| Screen | `screen.width × screen.height` | Screen resolutions breakdown |
| UTM params | URL query string → **sessionStorage** | Campaign attribution |
| Browser / OS / Device | User-Agent (server-side) | Technology breakdown |
| Country / City | IP address (server-side, not stored) | Geography breakdown |

> **UTM persistence:** UTM parameters are stored in `sessionStorage` when the user first lands, and automatically attached to all subsequent pageviews in the same tab — even after they navigate away from the landing URL. A new tab always starts a fresh session.

> **Navigation detection:** The SDK uses two complementary mechanisms so nothing slips through. A `history.pushState` monkey-patch catches all SPA navigations (App Router `<Link>`, Pages Router `router.push()`). `usePathname()` from `next/navigation` runs alongside it and catches `router.replace()` calls, which bypass `pushState`. Duplicate pageviews from both mechanisms firing on the same navigation are suppressed by a 100 ms URL-based dedup window.

> **Where do I find my `websiteId`?**
> Dashboard → select your website → **Settings** → the ID is shown at the top.
> It looks like `site_abc123def456`.

---

## Tracking custom events

### `useSparklytics()` hook

Use `useSparklytics()` in any Client Component to access `track()` and `pageview()`:

```tsx
'use client'

import { useSparklytics } from '@sparklytics/next'

export function SignupButton() {
  const { track } = useSparklytics()

  return (
    <button onClick={() => track('signup_click', { plan: 'pro' })}>
      Get started
    </button>
  )
}
```

`track(eventName, eventData?)` accepts:

| Parameter | Type | Description |
|-----------|------|-------------|
| `eventName` | `string` | Name of the event. Max 50 characters. |
| `eventData` | `Record<string, unknown>` | Optional payload. Max 4 KB JSON-serialized. |

The event appears in your dashboard under **Events** with a breakdown of each property value.

### Manual pageview — `pageview(url?)`

Fire a pageview manually for virtual pages, full-screen modals, or multi-step wizards where the URL doesn't change:

```tsx
'use client'

import { useSparklytics } from '@sparklytics/next'

export function ProductModal({ id }: { id: string }) {
  const { pageview } = useSparklytics()

  // Track the modal open as a distinct "page" visit
  useEffect(() => {
    pageview(`/products/${id}`)
  }, [id, pageview])

  return <dialog>...</dialog>
}
```

`pageview(url?)` — `url` defaults to `window.location.pathname` when omitted.

### `<SparklyticsEvent>` component

Wrap any element with `<SparklyticsEvent>` to track clicks declaratively — no handler needed:

```tsx
import { SparklyticsEvent } from '@sparklytics/next'

// Tracks "hero_cta" on click, preserves the button's existing onClick
<SparklyticsEvent name="hero_cta" data={{ variant: 'A', position: 'above_fold' }}>
  <button onClick={existingHandler}>Start free trial</button>
</SparklyticsEvent>
```

`<SparklyticsEvent>` accepts a single child element, fires `track()` on click, and calls the child's existing `onClick` (if any) afterwards. It never swallows the event.

### `<TrackedLink>` component

A drop-in replacement for Next.js `<Link>` that fires a Sparklytics event on every click — **no `onClick` boilerplate needed**:

```tsx
import { TrackedLink } from '@sparklytics/next'

// Fires "link_click" with { href: '/pricing' } on click
<TrackedLink href="/pricing">View pricing</TrackedLink>

// Custom event name + extra context
<TrackedLink
  href="/blog/why-rust"
  eventName="blog_cta"
  eventData={{ position: 'hero', variant: 'A' }}
>
  Read the post
</TrackedLink>

// Works with UrlObject hrefs too — pathname is used as href in the event
<TrackedLink href={{ pathname: '/products', query: { id: 42 } }}>
  View product
</TrackedLink>
```

`<TrackedLink>` accepts all the same props as Next.js `<Link>` plus two extra:

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `eventName` | `string` | `"link_click"` | Sparklytics event name fired on click |
| `eventData` | `Record<string, unknown>` | `{}` | Extra payload merged with `{ href }` |

The `href` is always captured automatically. Existing `onClick` handlers are preserved.

---

## Typed event schemas

Define your event names and payload shapes once, get TypeScript autocomplete everywhere.

### 1. Declare your events (e.g. `types/analytics.d.ts`)

```ts
declare module '@sparklytics/next' {
  interface SparklyticsEvents {
    signup_click:      { plan: 'free' | 'pro' | 'enterprise' }
    checkout_started:  { cart_value: number; currency: string }
    video_played:      { title: string; duration_s: number }
    search_performed:  { query: string; results_count: number }
  }
}
```

### 2. Enjoy autocomplete and type checking

```ts
const { track } = useSparklytics()

// ✅ Known event — payload shape is enforced
track('signup_click', { plan: 'pro' })

// ✅ Unknown events still work with arbitrary data
track('some_new_event', { anything: true })

// ❌ TypeScript error — 'invalid' is not a valid plan
track('signup_click', { plan: 'invalid' })

// ❌ TypeScript error — missing required 'currency' field
track('checkout_started', { cart_value: 49.99 })
```

No runtime overhead — the `SparklyticsEvents` interface is erased at compile time.

---

## Automatic link tracking (`trackLinks`)

The `trackLinks` prop intercepts **every `<a>` click on the page** via a single event-delegation listener — no changes to existing `<Link>` or `<a>` components needed:

```tsx
// Track all link clicks (internal + external)
<SparklyticsProvider websiteId="..." trackLinks>
  {children}
</SparklyticsProvider>

// Track only outbound links (different origin) — useful for affiliate / social clicks
<SparklyticsProvider websiteId="..." trackLinks="outbound">
  {children}
</SparklyticsProvider>
```

Every click fires a `"link_click"` event. The payload is built automatically:

| Field | Value |
|-------|-------|
| `href` | Pathname+search+hash for internal; full URL for external |
| `text` | Visible link text (trimmed, max 100 chars), when present |
| `external` | `true` for cross-origin links; omitted for internal |

**Always ignored:** hash-only anchors (`#`, `#section`), `javascript:` hrefs.

**Combine with `<TrackedLink>`** when you need a custom event name or extra context on a specific link — delegation and explicit components work side-by-side.

---

## Scroll depth tracking (`trackScrollDepth`)

The `trackScrollDepth` prop fires `"scroll_depth"` events automatically as users scroll down the page — no additional code required:

```tsx
// Fire at default milestones: 25%, 50%, 75%, 100%
<SparklyticsProvider websiteId="..." trackScrollDepth>
  {children}
</SparklyticsProvider>

// Custom thresholds
<SparklyticsProvider websiteId="..." trackScrollDepth={[33, 66, 100]}>
  {children}
</SparklyticsProvider>
```

Each threshold fires **at most once per page** and resets automatically on navigation. The event payload is `{ depth: N }` where N is the integer threshold crossed.

Use this data to measure content engagement: which pages do users read fully vs. abandon early?

---

## Form submission tracking (`trackForms`)

The `trackForms` prop captures every `<form>` submit via event delegation — useful for measuring conversion on contact forms, search bars, and newsletter sign-ups:

```tsx
<SparklyticsProvider websiteId="..." trackForms>
  {children}
</SparklyticsProvider>
```

Every submission fires a `"form_submit"` event. The payload is derived from the form element's attributes:

| Field | Source | Present when |
|-------|--------|--------------|
| `form_id` | `form.id` | Form has an `id` attribute |
| `form_name` | `form.name` | Form has a `name` attribute |
| `action` | `form.action` | Non-empty, non-`javascript:` action |

---

## Server-side tracking

Import from `@sparklytics/next/server` to track events from **Route Handlers**, **Server Actions**, and **Middleware** — no React, no browser APIs required.

### Zero-config setup ✨

Set two env vars once, then create a client — no configuration on every call:

```bash
# .env.local
SPARKLYTICS_HOST=https://analytics.example.com
SPARKLYTICS_WEBSITE_ID=site_abc123def456
```

```ts
// lib/analytics.ts  ← create once, import anywhere
import { createServerClient } from '@sparklytics/next/server'

export const analytics = createServerClient()
// No arguments — reads SPARKLYTICS_HOST and SPARKLYTICS_WEBSITE_ID automatically
```

### `fromRequest(request)` — auto-extract all headers ✨

In Route Handlers, call `fromRequest(request)` to automatically extract `url`, `userAgent`, `ip`, `referrer`, and `language` — no boilerplate:

```ts
// app/api/checkout/route.ts
import { analytics } from '@/lib/analytics'

export async function POST(request: Request) {
  const { cartValue } = await request.json()

  // One line — url, userAgent, ip all auto-extracted from request
  await analytics.fromRequest(request).trackEvent({
    eventName: 'purchase',
    eventData: { cart_value: cartValue, currency: 'USD' },
  })

  return Response.json({ ok: true })
}
```

```ts
// Pageview — zero options needed when all come from the request
export async function GET(request: Request) {
  await analytics.fromRequest(request).trackPageview()
  // ...
}
```

### Server Actions

```ts
// app/actions/checkout.ts
'use server'
import { analytics } from '@/lib/analytics'

export async function completePurchase(cartValue: number) {
  // ... process payment ...
  await analytics.trackEvent({
    url:       '/checkout',
    eventName: 'purchase',
    eventData: { cart_value: cartValue, currency: 'USD' },
  })
}
```

### Error handling

By default, `createServerClient` runs in **silent mode** — errors are logged via `console.warn` and never break your request handlers. Analytics should never crash your app.

If you need errors to propagate (e.g. for debugging or when analytics reliability is critical), opt in to strict mode:

```ts
export const analytics = createServerClient({ silent: false })
// Errors now reject the Promise — wrap calls in try/catch
```

### One-off helpers (no singleton)

If you prefer to avoid a singleton, the standalone functions still work:

```ts
import { trackServerPageview, trackServerEvent } from '@sparklytics/next/server'

await trackServerPageview({
  host:      process.env.SPARKLYTICS_HOST!,
  websiteId: process.env.SPARKLYTICS_WEBSITE_ID!,
  url:       '/page',
})
```

### Server-side options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `host` | `string` | ✅ (standalone) | Base URL of your Sparklytics server. Not needed on a `createServerClient()` client. |
| `websiteId` | `string` | ✅ (standalone) | Website ID from your dashboard. Not needed on a `createServerClient()` client. |
| `url` | `string` | ✅ | URL path to record (e.g. `"/checkout"`) |
| `eventName` | `string` | ✅ (`trackEvent` / `trackServerEvent` only) | Event name, max 50 chars |
| `eventData` | `Record<string, unknown>` | — | Event payload, max 4 KB |
| `referrer` | `string` | — | HTTP Referer from the incoming request |
| `language` | `string` | — | Accept-Language header value |
| `userAgent` | `string` | — | User-Agent for browser/OS/device detection |
| `ip` | `string` | — | Client IP for geo-lookup (never stored) |

> **Error handling:** `createServerClient` is silent by default — errors become `console.warn`. The standalone `trackServerPageview` / `trackServerEvent` helpers always throw on error. Use `silent: false` on the client if you need errors to propagate.

> **Edge Runtime:** Both `createServerClient` and the standalone helpers use only global `fetch` and are safe in Edge Runtime Middleware.

---

## `SparklyticsProvider` props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `websiteId` | `string` | `NEXT_PUBLIC_SPARKLYTICS_WEBSITE_ID` | Website ID. Falls back to `NEXT_PUBLIC_SPARKLYTICS_WEBSITE_ID` env var when omitted. |
| `host` | `string` | `NEXT_PUBLIC_SPARKLYTICS_HOST` or `''` | Base URL of your Sparklytics server. Falls back to `NEXT_PUBLIC_SPARKLYTICS_HOST` env var. Omit for same-origin setups. |
| `respectDnt` | `boolean` | `true` | Honour `navigator.doNotTrack` and `navigator.globalPrivacyControl` — suppresses all tracking when set |
| `disabled` | `boolean` | `false` | Disable all tracking. Useful in development or staging environments. |
| `trackLinks` | `boolean \| 'outbound'` | `false` | Auto-track link clicks via event delegation. `true` = all links; `'outbound'` = cross-origin only. |
| `trackScrollDepth` | `boolean \| number[]` | `false` | Auto-track scroll milestones. `true` = 25/50/75/100%; `number[]` = custom thresholds. |
| `trackForms` | `boolean` | `false` | Auto-track form submissions via event delegation. |

---

## Self-hosted setup

### Point the SDK at your server

```tsx
<SparklyticsProvider
  host="https://analytics.yourdomain.com"  // your Sparklytics server
  websiteId="site_abc123"
>
```

The SDK sends events to `https://analytics.yourdomain.com/api/collect`. Trailing slashes on `host` are trimmed automatically.

### Configure CORS on your server

When your app (`yoursite.com`) and your Sparklytics server (`analytics.yourdomain.com`) are on different origins, add your site to `SPARKLYTICS_CORS_ORIGINS` in your server config:

```bash
# docker-compose.yml or server environment
SPARKLYTICS_CORS_ORIGINS=https://yoursite.com,https://www.yoursite.com
```

Without this, browsers will block cross-origin requests from the SDK.

> **Same-origin setups don't need this.** If your Sparklytics server is on the same domain as your app (e.g. both on `yoursite.com`), omit the `host` prop and leave `SPARKLYTICS_CORS_ORIGINS` unset.

---

## Privacy

### DNT and GPC

When `respectDnt={true}` (the default), the SDK checks two signals before sending any event:

- `navigator.doNotTrack === '1'` — browser-level Do Not Track
- `navigator.globalPrivacyControl === true` — Global Privacy Control (Firefox, Brave)

If either is set, **no events are sent at all** — not even pageviews.

To track regardless of these signals (if your privacy policy allows it):

```tsx
<SparklyticsProvider websiteId="..." respectDnt={false}>
```

### Disable in development

```tsx
<SparklyticsProvider
  websiteId="..."
  disabled={process.env.NODE_ENV === 'development'}
>
```

Or use an environment variable for staging environments:

```tsx
<SparklyticsProvider
  websiteId={process.env.NEXT_PUBLIC_SPARKLYTICS_WEBSITE_ID!}
  host={process.env.NEXT_PUBLIC_SPARKLYTICS_HOST}
  disabled={process.env.NEXT_PUBLIC_SPARKLYTICS_DISABLED === 'true'}
>
```

### What data is collected

| Field | Value | Notes |
|-------|-------|-------|
| URL | `window.location.pathname` | Path only — no query string, no hash |
| Referrer | `document.referrer` | Empty string if direct visit |
| Event name | As passed to `track()` | Custom events only |
| Event data | As passed to `track()` | Custom events only |

**What is NOT collected:** cookies, localStorage, IP address (IP is used server-side to derive an anonymous visitor ID but is never stored), device fingerprint, personal identifiers.

---

## Batching and delivery

Events are queued locally and sent in batches to minimise network overhead:

| Condition | Behaviour |
|-----------|-----------|
| First event in a new batch | Starts a 500ms debounce timer |
| 10 events accumulated | Immediate flush — no timer wait |
| Tab closes / navigates away | `beforeunload` fires an immediate flush via `sendBeacon` |
| `sendBeacon` unavailable or rejected | Falls back to `fetch` with `keepalive: true` |
| Network error | Retries once after 2 seconds, then drops silently |
| Server returns 4xx / 5xx | Retries once after 2 seconds, then drops silently |

Events are **never** stored in localStorage or IndexedDB — the queue lives in memory only. If the browser is killed (power loss, task manager), queued events are lost. For typical browsing sessions this is not an issue because `beforeunload` fires reliably.

---

## Local development

### Test with `npm link`

To develop the SDK against a local Next.js app without publishing to npm:

```bash
# In the SDK directory — build and create a global symlink
cd sdk/next
npm run build
npm link

# In your Next.js app directory — use the symlinked package
cd /path/to/your-nextjs-app
npm link @sparklytics/next
```

After SDK changes, run `npm run build` again (or use `npm run dev` for watch mode).

To unlink when done:

```bash
# In your Next.js app
npm unlink @sparklytics/next

# In the SDK directory
npm unlink
```

---

## Troubleshooting

### No events appearing in the dashboard

1. **Check `websiteId`** — open browser devtools, look for `[Sparklytics] websiteId is required` in the console.
2. **Check network requests** — devtools → Network tab → filter by `/api/collect`. If requests are blocked with a CORS error, set `SPARKLYTICS_CORS_ORIGINS` on your server.
3. **Check privacy signals** — if `navigator.doNotTrack === '1'`, the SDK is suppressing all events. Pass `respectDnt={false}` temporarily to verify.
4. **Check `disabled` prop** — `disabled={true}` silences everything without any console output.

### Events show the wrong URL

The SDK tracks `window.location.pathname` — path only. Query strings (`?page=2`) and hashes (`#section`) are intentionally excluded. If you need to track query parameters as part of a custom event, pass them manually in `eventData`:

```ts
track('search_performed', {
  query: searchParams.get('q'),
  results_count: results.length,
})
```

### `useSparklytics()` throws "must be used within a Provider"

`useSparklytics()` called outside `<SparklyticsProvider>` returns a no-op `track()` and `pageview()` — it does not throw. If you are seeing an error, it is likely from a different context hook. Verify the component tree has `<SparklyticsProvider>` as an ancestor.

### TypeScript error: "Property 'X' does not exist on type 'SparklyticsEvents'"

You have augmented `SparklyticsEvents` and are calling `track()` with a property that does not exist in your declared schema. Either add it to the interface or check for a typo in the event name or property key.

---

## Edge Runtime compatibility

The client package (`@sparklytics/next`) does not use `process`, `fs`, `net`, or any Node.js-only API. It is safe to import in Edge Runtime middleware, though `useSparklytics()` must still be used in Client Components only.

The server package (`@sparklytics/next/server`) uses only global `fetch` and is safe in both Node.js and Edge Runtime.

---

## Exports

### `@sparklytics/next` (client)

| Export | Type | Description |
|--------|------|-------------|
| `SparklyticsProvider` | Component | Root provider — mount once in your layout |
| `useSparklytics` | Hook | Returns `{ track, pageview }` for custom events and manual pageviews |
| `SparklyticsEvent` | Component | Declarative click tracker wrapping any element |
| `TrackedLink` | Component | Next.js `<Link>` wrapper with automatic click tracking |
| `SparklyticsEvents` | Interface | Augment to add typed event schemas |
| `SparklyticsProviderProps` | Type | Props type for the provider |
| `SparklyticsHook` | Type | Return type of `useSparklytics()` |
| `TrackedLinkProps` | Type | Props type for `<TrackedLink>` |
| `BatchEvent` | Type | Internal wire format (advanced use) |

### `@sparklytics/next/server` (server-side)

| Export | Type | Description |
|--------|------|-------------|
| `createServerClient` | Function | Create a pre-configured client (recommended) |
| `trackServerPageview` | Function | One-off pageview tracking |
| `trackServerEvent` | Function | One-off custom event tracking |
| `ServerClient` | Interface | Return type of `createServerClient` |
| `BoundServerClient` | Interface | Return type of `ServerClient.fromRequest()` |
| `ServerClientConfig` | Interface | Config for `createServerClient` |
| `TrackServerPageviewOptions` | Type | Options for `trackServerPageview` |
| `TrackServerEventOptions` | Type | Options for `trackServerEvent` |
| `TrackServerBaseOptions` | Type | Shared base options |

---

## Bundle size

| Format | Size |
|--------|------|
| Minified + gzipped (ESM, client) | < 5 KB |
| Tree-shakeable | Yes (`"sideEffects": false`) |
| Runtime dependencies | None (React and Next.js are peer dependencies) |

---

## License

MIT — [github.com/Sparklytics/sparklytics-next](https://github.com/Sparklytics/sparklytics-next)
