/**
 * Tomorrow's prompts (plan 21.1 section 2): each prompt's text, family, answer
 * count and tier distribution, with the answer names inside a closed
 * disclosure per prompt so the admin can judge the set. Only ever rendered
 * for TOMORROW; today's answers are never listed here.
 */

import { TIERS, TIER_WORDS, type AnswerEntry } from "@/lib/long-shot/types";
import { TEMPLATE_LABELS } from "@/lib/long-shot/template-labels";
import type { TemplateKey } from "@/lib/long-shot/types";

export interface PreviewPrompt {
  position: number;
  templateKey: string;
  promptText: string;
  answers: AnswerEntry[];
}

export function PuzzlePreview({ prompts, names }: { prompts: PreviewPrompt[]; names: Map<string, string> }) {
  return (
    <ol className="space-y-4">
      {prompts.map((p) => (
        <li key={p.position} className="rounded-card border border-line bg-surface/40 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-subtle">
            Prompt {p.position}, {TEMPLATE_LABELS[p.templateKey as TemplateKey] ?? p.templateKey}, {p.answers.length} answers
          </p>
          <p className="mt-1 text-sm font-medium text-ink">{p.promptText}</p>
          <p className="mt-2 text-xs text-ink-muted">
            {TIERS.map((t) => `${TIER_WORDS[t]} ${p.answers.filter((a) => a.tier === t).length}`).join(", ")}
          </p>
          <details className="mt-2">
            <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-semibold text-brand-cyan">
              Show the {p.answers.length} answers
            </summary>
            <ul className="mt-2 grid gap-1 text-xs text-ink-muted sm:grid-cols-2">
              {p.answers.map((a) => (
                <li key={a.player_id}>
                  {names.get(a.player_id) ?? a.player_id}, {TIER_WORDS[a.tier]}, rostered in {Math.round(a.rate * 100)} percent
                </li>
              ))}
            </ul>
          </details>
        </li>
      ))}
    </ol>
  );
}
