/**
 * The switch on block kind (plan section 11.2).
 *
 * A block is a kind, a dataset id, a caption, a conclusion and options. This
 * validates the options against the kind's schema once more (the stored
 * draft was validated at submission, but a schema can tighten between then
 * and now), picks the dataset from the edition's metadata, and hands the
 * right component its typed inputs. A block whose dataset is missing renders
 * its caption, its conclusion and a "data not available" line; a block whose
 * kind or options no longer parse renders the same, never a crash and never
 * an invented figure.
 *
 * Server component.
 */

import { isBlockKind, parseBlockOptions, type BLOCK_OPTION_SCHEMAS } from "@/lib/brief-desk/blocks";
import type { z } from "zod";
import type { BundleDataset, DraftBlock } from "@/lib/brief-desk/types";
import type { BlockPlayer } from "@/lib/brief-desk/edition-data";
import type { RelayCardData } from "@/lib/relays/load";
import { BlockDataMissing, BlockShell } from "./block-shell";
import { StatTilesBlock } from "./stat-tiles";
import { ValueMoversBlock } from "./value-movers";
import { TopScorersTable } from "./top-scorers";
import { BoxScoreLinesBlock } from "./box-score-lines";
import { InjuryTimelineBlock, readTimelineRows } from "./injury-timeline";
import { ActionListBlock } from "./action-list";
import { FormatToggle } from "./format-toggle";
import { ReturnPlanner } from "./return-planner";
import { RelayQuoteBlock } from "./relay-quote";
import { CalloutBlock } from "./callout";

type Options<K extends keyof typeof BLOCK_OPTION_SCHEMAS> = z.infer<(typeof BLOCK_OPTION_SCHEMAS)[K]>;

export interface BlockContext {
  datasets: Record<string, BundleDataset>;
  relays: Record<string, RelayCardData>;
  players: Record<string, BlockPlayer>;
  formats: Array<{ slug: string; display: string }>;
}

export function RenderBlock({ block, ctx }: { block: DraftBlock; ctx: BlockContext }) {
  const { id, caption, conclusion } = block;
  if (!isBlockKind(block.kind)) return <BlockDataMissing id={id} caption={caption} conclusion={conclusion} />;
  const parsed = parseBlockOptions(block.kind, block.options);
  if (!parsed.ok) return <BlockDataMissing id={id} caption={caption} conclusion={conclusion} />;
  const dataset = block.dataset_id ? (ctx.datasets[block.dataset_id] ?? null) : null;
  const needsData = block.kind !== "relay_quote" && block.kind !== "callout" && block.kind !== "action_list";
  if (needsData && !dataset) return <BlockDataMissing id={id} caption={caption} conclusion={conclusion} />;

  switch (block.kind) {
    case "stat_tiles":
      return <StatTilesBlock id={id} caption={caption} conclusion={conclusion} dataset={dataset as BundleDataset} />;
    case "value_movers":
      return (
        <ValueMoversBlock
          id={id}
          caption={caption}
          conclusion={conclusion}
          dataset={dataset as BundleDataset}
          options={parsed.options as Options<"value_movers">}
        />
      );
    case "top_scorers": {
      const o = parsed.options as Options<"top_scorers">;
      return (
        <BlockShell id={id} caption={caption} conclusion={conclusion} dataset={dataset}>
          <TopScorersTable blockId={id} dataset={dataset as BundleDataset} positions={o.positions} limit={o.limit} />
        </BlockShell>
      );
    }
    case "box_score_lines":
      return (
        <BoxScoreLinesBlock
          id={id}
          caption={caption}
          conclusion={conclusion}
          dataset={dataset as BundleDataset}
          options={parsed.options as Options<"box_score_lines">}
        />
      );
    case "injury_timeline":
      return <InjuryTimelineBlock id={id} caption={caption} conclusion={conclusion} dataset={dataset as BundleDataset} />;
    case "action_list":
      return (
        <ActionListBlock
          id={id}
          caption={caption}
          conclusion={conclusion}
          dataset={dataset}
          options={parsed.options as Options<"action_list">}
          players={ctx.players}
        />
      );
    case "format_toggle": {
      const o = parsed.options as Options<"format_toggle">;
      return (
        <BlockShell id={id} caption={caption} conclusion={conclusion} dataset={dataset}>
          <FormatToggle blockId={id} dataset={dataset as BundleDataset} formats={ctx.formats} defaultSlug={o.default} />
        </BlockShell>
      );
    }
    case "return_planner": {
      const o = parsed.options as Options<"return_planner">;
      return (
        <BlockShell id={id} caption={caption} conclusion={conclusion} dataset={dataset}>
          <ReturnPlanner rows={readTimelineRows(dataset as BundleDataset)} defaultWeeks={o.default_weeks} />
        </BlockShell>
      );
    }
    case "relay_quote": {
      const o = parsed.options as Options<"relay_quote">;
      return <RelayQuoteBlock id={id} caption={caption} conclusion={conclusion} relay={ctx.relays[o.relay_id] ?? null} />;
    }
    case "callout":
      return <CalloutBlock id={id} caption={caption} conclusion={conclusion} options={parsed.options as Options<"callout">} />;
    default: {
      const exhaustive: never = block.kind;
      return exhaustive;
    }
  }
}
