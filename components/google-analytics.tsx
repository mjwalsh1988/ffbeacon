import Script from "next/script";

/**
 * The Google tag, in two halves.
 *
 * The first half is a few bytes of inline script in <head>: it creates the
 * `dataLayer` queue and the `gtag` function and records the config. It runs
 * before React hydrates, so an event fired from an effect on the very first
 * render (the sign-in report, for instance) is queued rather than lost.
 *
 * The second half is Google's own library, about 130 KB, loaded with
 * `afterInteractive`: after the page is visible and working, never in the way
 * of the first paint. It drains the queue when it arrives.
 *
 * Page views need no code. GA's enhanced measurement listens for history
 * changes, so a client-side route change in the App Router counts as one; that
 * setting is on in the property and must stay on.
 *
 * Rendered only when `isGoogleAnalyticsEnabled()` says so, which also checks
 * the ID's format before it is written into the inline script below.
 */
const MEASUREMENT_ID_SHAPE = /^G-[A-Z0-9]{4,20}$/;

export function GoogleAnalyticsHead({ measurementId }: { measurementId: string }) {
  // The layout's gate already checks this. Checked again here because this is
  // the line that writes the ID into a script, and a second caller must not be
  // able to skip the check by forgetting it.
  if (!MEASUREMENT_ID_SHAPE.test(measurementId)) return null;
  const init = [
    "window.dataLayer=window.dataLayer||[];",
    "function gtag(){dataLayer.push(arguments);}",
    "window.gtag=gtag;",
    "gtag('js',new Date());",
    `gtag('config','${measurementId}');`,
  ].join("");
  return <script id="ga4-init" dangerouslySetInnerHTML={{ __html: init }} />;
}

export function GoogleAnalyticsLibrary({ measurementId }: { measurementId: string }) {
  if (!MEASUREMENT_ID_SHAPE.test(measurementId)) return null;
  return (
    <Script
      id="ga4-library"
      src={`https://www.googletagmanager.com/gtag/js?id=${measurementId}`}
      strategy="afterInteractive"
    />
  );
}
