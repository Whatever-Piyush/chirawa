// ── Analytics (Track_Order.md · Analytics) ───────────────────────────────────
// A single, typed entry point so instrumentation is centralized and provider-
// ready. No provider is wired yet, so events fan out to registered sinks (none by
// default) — never to console. A real provider (Segment/PostHog/…) is attached
// later via `onAnalytics`, with zero changes at the call sites.

export type AnalyticsEvent =
  | 'tracking_bubble_viewed'
  | 'tracking_bubble_pressed'
  | 'tracking_opened'
  | 'multiple_orders_viewed'
  | 'bubble_hidden'
  | 'bubble_dismissed'
  | 'order_delivered_viewed';

export type AnalyticsProps = Record<string, string | number | boolean | undefined>;

export type AnalyticsSink = (event: AnalyticsEvent, props?: AnalyticsProps) => void;

const sinks = new Set<AnalyticsSink>();

// Record an event. Fans out to every registered sink; a throwing sink can't take
// down a UI interaction, so failures are swallowed.
export function track(event: AnalyticsEvent, props?: AnalyticsProps): void {
  for (const sink of sinks) {
    try {
      sink(event, props);
    } catch {
      // A misbehaving analytics sink must never break the app.
    }
  }
}

// Attach a provider (or a test spy). Returns an unsubscribe function.
export function onAnalytics(sink: AnalyticsSink): () => void {
  sinks.add(sink);
  return () => sinks.delete(sink);
}
