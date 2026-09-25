import type { Rule } from "eslint";

declare const plugin: {
  meta: { name: string };
  rules: Record<"ascii-punctuation" | "sleeper-api-host" | "eastern-time", Rule.RuleModule>;
};

export default plugin;
