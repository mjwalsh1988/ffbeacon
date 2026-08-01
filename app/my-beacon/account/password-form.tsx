"use client";

import { useId, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Circle, Eye, EyeOff, KeyRound } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Status =
  | { kind: "idle" }
  | { kind: "error"; message: string }
  | { kind: "success"; message: string };

type Rule = {
  id: string;
  label: string;
  test: (value: string) => boolean;
};

// Rules are intentionally conservative, they match the common policy that
// most users have already internalized from other sites, so the checklist
// reads as familiar rather than nitpicky. Tweak the set here and the UI
// updates automatically.
const RULES: Rule[] = [
  { id: "length", label: "At least 8 characters", test: (v) => v.length >= 8 },
  { id: "lower", label: "A lowercase letter (a-z)", test: (v) => /[a-z]/.test(v) },
  { id: "upper", label: "An uppercase letter (A-Z)", test: (v) => /[A-Z]/.test(v) },
  { id: "number", label: "A number (0-9)", test: (v) => /[0-9]/.test(v) },
  {
    id: "symbol",
    label: "A symbol (e.g. !, @, #, $)",
    test: (v) => /[^A-Za-z0-9]/.test(v),
  },
];

/**
 * Two-mode password form:
 *  - `hasPassword=true` , confirm-then-update flow with a current-password
 *                          check (Supabase doesn't natively require the
 *                          current password, so we re-authenticate first).
 *  - `hasPassword=false`, single new-password field for users who only
 *                          have OAuth identities and want to add a password
 *                          fallback.
 *
 * Each input has a visibility toggle, and the new-password field shows a
 * live checklist of strength rules. Submission is gated on all rules
 * passing and both new-password fields matching.
 */
export function PasswordForm({
  hasPassword,
  email,
}: {
  hasPassword: boolean;
  email: string | null;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [pending, startTransition] = useTransition();

  const currentId = useId();
  const newId = useId();
  const confirmId = useId();
  const statusId = useId();
  const rulesId = useId();

  // Recompute rule results on every keystroke. Cheap (5 regex tests) so no
  // memo is strictly needed, but the useMemo keeps the reference stable
  // for downstream effects/comparisons.
  const ruleResults = useMemo(
    () => RULES.map((rule) => ({ ...rule, passed: rule.test(newPassword) })),
    [newPassword],
  );
  const allRulesPassed = ruleResults.every((r) => r.passed);
  const passwordsMatch =
    confirmPassword.length > 0 && newPassword === confirmPassword;
  // Submit is blocked until the new password is strong AND the confirm
  // field matches AND (when applicable) the current password is provided.
  const canSubmit =
    !pending &&
    allRulesPassed &&
    passwordsMatch &&
    (!hasPassword || currentPassword.length > 0);

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus({ kind: "idle" });

    if (!allRulesPassed) {
      setStatus({
        kind: "error",
        message: "Password doesn't meet all the requirements below.",
      });
      return;
    }
    if (!passwordsMatch) {
      setStatus({
        kind: "error",
        message: "The two new password fields don't match.",
      });
      return;
    }

    startTransition(async () => {
      // Re-authenticate against the current password before allowing a
      // change. Without this, anyone with a live session cookie could
      // hijack the account permanently. Skipped for users who don't yet
      // have a password (OAuth-only accounts adding one for the first time).
      if (hasPassword) {
        if (!email) {
          setStatus({
            kind: "error",
            message: "Account has no email on file; can't verify password.",
          });
          return;
        }
        const { error: verifyError } = await supabase.auth.signInWithPassword({
          email,
          password: currentPassword,
        });
        if (verifyError) {
          setStatus({
            kind: "error",
            message: "Current password is incorrect.",
          });
          return;
        }
      }

      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });
      if (error) {
        setStatus({ kind: "error", message: error.message });
        return;
      }

      setStatus({
        kind: "success",
        message: hasPassword
          ? "Password updated."
          : "Password set. You can now sign in with email + password.",
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setShowCurrent(false);
      setShowNew(false);
      setShowConfirm(false);
      router.refresh();
    });
  };

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {hasPassword && (
        <PasswordField
          id={currentId}
          label="Current password"
          value={currentPassword}
          onChange={setCurrentPassword}
          autoComplete="current-password"
          visible={showCurrent}
          onToggleVisible={() => setShowCurrent((v) => !v)}
          describedBy={statusId}
        />
      )}

      <div>
        <PasswordField
          id={newId}
          label={hasPassword ? "New password" : "Set a password"}
          value={newPassword}
          onChange={setNewPassword}
          autoComplete="new-password"
          visible={showNew}
          onToggleVisible={() => setShowNew((v) => !v)}
          describedBy={`${rulesId} ${statusId}`}
          minLength={8}
        />
        <PasswordRules
          id={rulesId}
          rules={ruleResults}
          allPassed={allRulesPassed}
        />
      </div>

      <PasswordField
        id={confirmId}
        label="Confirm new password"
        value={confirmPassword}
        onChange={setConfirmPassword}
        autoComplete="new-password"
        visible={showConfirm}
        onToggleVisible={() => setShowConfirm((v) => !v)}
        describedBy={`${confirmId}-match ${statusId}`}
        minLength={8}
        trailingHint={
          confirmPassword.length > 0 ? (
            <p
              id={`${confirmId}-match`}
              className={`mt-1 text-xs ${
                passwordsMatch ? "text-signal-success" : "text-signal-danger"
              }`}
              aria-live="polite"
            >
              {passwordsMatch
                ? "Matches the new password."
                : "Doesn't match the new password yet."}
            </p>
          ) : null
        }
      />

      <button
        type="submit"
        disabled={!canSubmit}
        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-card bg-beacon px-5 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
      >
        <KeyRound aria-hidden="true" className="h-4 w-4" />
        {pending
          ? hasPassword
            ? "Updating..."
            : "Saving..."
          : hasPassword
            ? "Update password"
            : "Set password"}
      </button>

      <div
        id={statusId}
        aria-live="polite"
        role="status"
        className="min-h-[1.25rem] text-sm"
      >
        {status.kind === "error" && (
          <p
            role="alert"
            className="rounded-card border border-signal-danger/40 bg-signal-danger/10 px-3 py-2 text-signal-danger"
          >
            {status.message}
          </p>
        )}
        {status.kind === "success" && (
          <p className="rounded-card border border-signal-success/40 bg-signal-success/10 px-3 py-2 text-signal-success">
            {status.message}
          </p>
        )}
      </div>
    </form>
  );
}

/* ---------- Password field with show/hide ---------- */

function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  visible,
  onToggleVisible,
  describedBy,
  minLength,
  trailingHint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  autoComplete: "current-password" | "new-password";
  visible: boolean;
  onToggleVisible: () => void;
  describedBy: string;
  minLength?: number;
  trailingHint?: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-ink">
        {label}
      </label>
      {/* Wrapping div is positioned so the eye toggle can overlay the
          right edge of the input without changing the input's box model.
          Padding-right on the input reserves space for the toggle. */}
      <div className="relative mt-2">
        <input
          id={id}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          required
          minLength={minLength}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-describedby={describedBy}
          className="w-full rounded-card border border-line bg-base py-3 pl-3 pr-12 text-sm placeholder:text-ink-subtle focus:border-brand-purple focus:outline-none focus:ring-2 focus:ring-brand-purple/30"
        />
        <button
          type="button"
          onClick={onToggleVisible}
          aria-pressed={visible}
          aria-label={
            visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`
          }
          aria-controls={id}
          className="absolute inset-y-0 right-0 inline-flex h-full w-11 items-center justify-center rounded-r-card text-ink-muted transition-colors hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand-cyan"
        >
          {visible ? (
            <EyeOff aria-hidden="true" className="h-5 w-5" />
          ) : (
            <Eye aria-hidden="true" className="h-5 w-5" />
          )}
        </button>
      </div>
      {trailingHint}
    </div>
  );
}

/* ---------- Live strength checklist ---------- */

function PasswordRules({
  id,
  rules,
  allPassed,
}: {
  id: string;
  rules: Array<Rule & { passed: boolean }>;
  allPassed: boolean;
}) {
  const passedCount = rules.filter((r) => r.passed).length;
  return (
    <div className="mt-2 space-y-2">
      {/* Live region carries a compact summary that announces as the user
          types. The full list below is static enough for screen readers
          to navigate; the summary is the at-a-glance signal. */}
      <p
        id={`${id}-summary`}
        aria-live="polite"
        className={`text-xs font-medium ${
          allPassed ? "text-signal-success" : "text-ink-muted"
        }`}
      >
        {allPassed
          ? "All password requirements met."
          : `Password strength: ${passedCount} of ${rules.length} requirements met.`}
      </p>
      <ul
        id={id}
        role="list"
        aria-label="Password requirements"
        className="space-y-1"
      >
        {rules.map((rule) => (
          <li
            key={rule.id}
            className={`flex items-start gap-2 text-xs leading-relaxed ${
              rule.passed ? "text-signal-success" : "text-ink-muted"
            }`}
          >
            {rule.passed ? (
              <Check
                aria-hidden="true"
                className="mt-0.5 h-3.5 w-3.5 shrink-0"
              />
            ) : (
              <Circle
                aria-hidden="true"
                className="mt-0.5 h-3.5 w-3.5 shrink-0"
              />
            )}
            {/* Visually-hidden state prefix so screen readers hear "Met:" or
                "Not yet:" before the rule text, instead of relying on icon
                shape alone. */}
            <span>
              <span className="sr-only">
                {rule.passed ? "Met: " : "Not yet: "}
              </span>
              {rule.label}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
