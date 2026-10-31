"use client";

/**
 * The questions on a complimentary order. The admin created it, so the customer has
 * not been asked anything yet; this is fieldset 3 of the checkout on its own, and it
 * goes away once Michael starts. The textareas are the checkout's own, counter and
 * all, so the two forms cannot drift apart.
 */

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateIntakeAction } from "@/app/actions/commerce";
import { TEAM_REVIEW_QUESTIONS } from "@/lib/commerce/intake";
import type { TeamReviewDirection } from "@/lib/commerce/types";
import { TextArea } from "./checkout-form";

export function IntakeUpdateForm({ orderId }: { orderId: string }) {
  const router = useRouter();
  const ids = useId();
  const [direction, setDirection] = useState<TeamReviewDirection>("unsure");
  const [questions, setQuestions] = useState("");
  const [offLimits, setOffLimits] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    startTransition(async () => {
      const result = await updateIntakeAction(orderId, { direction, questions, offLimits });
      if (result.ok) router.refresh();
      else setError(result.message);
    });
  };

  return (
    <form onSubmit={submit} className="max-w-2xl space-y-4">
      <fieldset className="min-w-0">
        <legend className="text-sm font-semibold text-ink">{TEAM_REVIEW_QUESTIONS.direction.legend}</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {TEAM_REVIEW_QUESTIONS.direction.options.map((option) => (
            <label
              key={option.value}
              className="flex min-h-11 cursor-pointer items-center gap-3 rounded-card border border-line bg-surface/60 p-3 has-[:checked]:border-brand-cyan has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-cyan"
            >
              <input
                type="radio"
                name={`${ids}-direction`}
                checked={direction === option.value}
                onChange={() => setDirection(option.value)}
                className="h-4 w-4 shrink-0 accent-brand-cyan"
              />
              <span className="text-sm font-medium text-ink">{option.label}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <TextArea
        label={TEAM_REVIEW_QUESTIONS.questions.label}
        hint={TEAM_REVIEW_QUESTIONS.questions.hint}
        max={TEAM_REVIEW_QUESTIONS.questions.max}
        value={questions}
        rows={5}
        onChange={setQuestions}
      />
      <TextArea
        label={TEAM_REVIEW_QUESTIONS.offLimits.label}
        hint={TEAM_REVIEW_QUESTIONS.offLimits.hint}
        max={TEAM_REVIEW_QUESTIONS.offLimits.max}
        value={offLimits}
        rows={3}
        onChange={setOffLimits}
      />
      {error && (
        <p role="alert" className="text-sm font-medium text-signal-danger">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="inline-flex min-h-11 w-full items-center justify-center rounded-card bg-beacon px-5 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-60 sm:w-auto"
      >
        {pending ? "Sending..." : "Send these to Michael"}
      </button>
    </form>
  );
}
