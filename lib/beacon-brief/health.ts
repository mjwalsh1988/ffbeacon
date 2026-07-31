/**
 * Circuit breaker and alert throttle for the Beacon Brief.
 *
 * Backed by the beacon_brief_health table (migration 0154), one row per
 * component. It answers two questions the pipeline could not answer before:
 *
 *   "Should I even try to call X right now?"  -> beginXCall()
 *   "Have I already told the owner about this?" -> the cooldown inside record*()
 *
 * The 2026-07-31 incident is the shape this exists to prevent. The X account ran
 * out of credits, every call returned HTTP 402, and because each failure was
 * handled in isolation the pipeline retried 5 times per job, sent one email per
 * job (30 of them), and left no record anywhere of what was actually wrong.
 *
 * While a component is in outage the pipeline stops calling it entirely except
 * for one probe per bb_x_probe_interval_minutes. That probe is what detects
 * recovery, so nothing needs to be restarted by hand after a top-up.
 *
 * Nothing here throws. Health tracking is observability, and a failure to write
 * a health row must never take down the run it is observing.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { isXOutageKind, type XError } from "@/lib/x";
import type { BeaconBriefSettings } from "./settings";
import {
  sendBeaconBriefOutageEmail,
  sendBeaconBriefRecoveryEmail,
} from "./email";

type Admin = SupabaseClient<Database>;

export type HealthComponent = "x_api" | "queue_failures";

export interface HealthRow {
  component: string;
  status: string;
  error_kind: string | null;
  error_detail: string | null;
  http_status: number | null;
  failing_since: string | null;
  last_success_at: string | null;
  last_probe_at: string | null;
  last_alert_at: string | null;
  suppressed_alerts: number;
  consecutive_failures: number;
}

/**
 * Consecutive transient failures tolerated before the breaker trips. Credits and
 * auth failures trip immediately (they are account-wide and cannot recover on
 * their own); a timeout or a 5xx is usually one bad minute, so those need to
 * persist before the pipeline stops trying.
 */
const TRANSIENT_FAILURES_BEFORE_OUTAGE = 10;

const SELECT_COLUMNS =
  "component, status, error_kind, error_detail, http_status, failing_since, last_success_at, last_probe_at, last_alert_at, suppressed_alerts, consecutive_failures";

export async function loadHealth(
  admin: Admin,
  component: HealthComponent,
): Promise<HealthRow | null> {
  try {
    const { data } = await admin
      .from("beacon_brief_health")
      .select(SELECT_COLUMNS)
      .eq("component", component)
      .maybeSingle();
    return (data as HealthRow | null) ?? null;
  } catch {
    return null;
  }
}

async function upsertHealth(
  admin: Admin,
  component: HealthComponent,
  patch: Record<string, unknown>,
): Promise<void> {
  try {
    await admin
      .from("beacon_brief_health")
      .upsert(
        {
          component,
          ...patch,
          updated_at: new Date().toISOString(),
        } as never,
        { onConflict: "component" },
      )
      .select("component");
  } catch {
    // Observability only; never let it break the caller.
  }
}

function minutesSince(iso: string | null | undefined): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return Number.POSITIVE_INFINITY;
  return (Date.now() - t) / 60_000;
}

export interface XCallGate {
  allowed: boolean;
  /** True when this call is the single recovery probe for the current outage. */
  isProbe: boolean;
  /** Populated when allowed is false, for the caller's log line. */
  reason?: string;
}

/**
 * Decide whether the pipeline may call X right now, and stamp the probe if this
 * call is one.
 *
 * Healthy: always allowed. In outage: allowed only once per probe interval, and
 * that one call is what re-opens the circuit when it succeeds. Stamping
 * last_probe_at BEFORE the call (rather than after) means two workers running
 * concurrently cannot both decide they are the probe.
 */
export async function beginXCall(
  admin: Admin,
  settings: BeaconBriefSettings,
): Promise<XCallGate> {
  const health = await loadHealth(admin, "x_api");
  if (!health || health.status !== "outage") {
    return { allowed: true, isProbe: false };
  }

  const interval =
    settings.xProbeIntervalMinutes > 0 ? settings.xProbeIntervalMinutes : 15;
  if (minutesSince(health.last_probe_at) < interval) {
    return {
      allowed: false,
      isProbe: false,
      reason: `X integration is in outage (${
        health.error_kind ?? "unknown"
      }): ${health.error_detail ?? "no detail"}. Next recovery probe in ${Math.ceil(
        interval - minutesSince(health.last_probe_at),
      )} min.`,
    };
  }

  await upsertHealth(admin, "x_api", {
    last_probe_at: new Date().toISOString(),
  });
  return { allowed: true, isProbe: true };
}

/**
 * Record a successful X call. Clears an open outage and sends the one recovery
 * email for that incident. Kept cheap on the healthy path: a row that is already
 * ok with no failure count only gets its last_success_at refreshed.
 */
export async function recordXSuccess(admin: Admin): Promise<void> {
  const health = await loadHealth(admin, "x_api");
  const wasOutage = health?.status === "outage";
  const downSince = health?.failing_since ?? null;

  await upsertHealth(admin, "x_api", {
    status: "ok",
    error_kind: null,
    error_detail: null,
    http_status: null,
    failing_since: null,
    last_success_at: new Date().toISOString(),
    consecutive_failures: 0,
    suppressed_alerts: 0,
  });

  if (wasOutage) {
    await sendBeaconBriefRecoveryEmail({
      component: "X (Twitter) API",
      downSince,
      recoveredAt: new Date().toISOString(),
    });
  }
}

/**
 * Record a failed X call, trip the breaker when the failure is account-wide (or
 * a transient one has persisted), and alert at most once per cooldown window.
 *
 * Returns whether the breaker is now open, so the caller can decide to stop
 * rather than work through the rest of its batch.
 */
export async function recordXFailure(
  admin: Admin,
  settings: BeaconBriefSettings,
  error: XError,
): Promise<{ outage: boolean }> {
  const health = await loadHealth(admin, "x_api");
  const consecutive = (health?.consecutive_failures ?? 0) + 1;
  const accountWide = isXOutageKind(error.kind);
  const outage =
    accountWide || consecutive >= TRANSIENT_FAILURES_BEFORE_OUTAGE;
  const alreadyDown = health?.status === "outage";
  const failingSince =
    health?.failing_since ?? (outage ? new Date().toISOString() : null);

  const cooldown =
    settings.alertCooldownMinutes > 0 ? settings.alertCooldownMinutes : 360;
  const cooledDown = minutesSince(health?.last_alert_at) >= cooldown;
  const shouldAlert = outage && cooledDown;

  await upsertHealth(admin, "x_api", {
    status: outage ? "outage" : (health?.status ?? "ok"),
    error_kind: error.kind,
    error_detail: error.detail.slice(0, 500),
    http_status: error.status,
    failing_since: failingSince,
    consecutive_failures: consecutive,
    ...(shouldAlert
      ? { last_alert_at: new Date().toISOString(), suppressed_alerts: 0 }
      : outage
        ? { suppressed_alerts: (health?.suppressed_alerts ?? 0) + 1 }
        : {}),
  });

  if (shouldAlert) {
    await sendBeaconBriefOutageEmail({
      component: "X (Twitter) API",
      kind: error.kind,
      httpStatus: error.status,
      detail: error.detail,
      failingSince,
      consecutiveFailures: consecutive,
      suppressedSince: health?.suppressed_alerts ?? 0,
      alreadyDown,
    });
  }

  return { outage };
}

/**
 * Throttle for permanently-failed queue jobs. One root cause can fail many jobs
 * (the 2026-07-31 outage failed 30), and the owner needs to know once, not once
 * per job. Every failure still lands in the admin Moderation queue regardless of
 * what this returns; only the email is throttled.
 *
 * Returns how many failures the cooldown swallowed since the last email, so the
 * email that does go out can say what it stands for.
 */
export async function shouldEmailQueueFailure(
  admin: Admin,
  settings: BeaconBriefSettings,
): Promise<{ send: boolean; suppressedSince: number }> {
  const health = await loadHealth(admin, "queue_failures");
  const cooldown =
    settings.alertCooldownMinutes > 0 ? settings.alertCooldownMinutes : 360;
  const send = minutesSince(health?.last_alert_at) >= cooldown;
  const suppressedSince = health?.suppressed_alerts ?? 0;

  await upsertHealth(admin, "queue_failures", {
    status: "ok",
    consecutive_failures: (health?.consecutive_failures ?? 0) + 1,
    ...(send
      ? { last_alert_at: new Date().toISOString(), suppressed_alerts: 0 }
      : { suppressed_alerts: suppressedSince + 1 }),
  });

  return { send, suppressedSince };
}
