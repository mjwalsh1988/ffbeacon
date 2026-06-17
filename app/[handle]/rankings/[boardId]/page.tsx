import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { normalizeHandle, validateHandleFormat } from "@/lib/signal";
import { isReservedRouteSegment } from "@/lib/signal/reserved-routes";
import { buildBoardMetadata, BoardView } from "@/components/signal/board-view";

// Root /{handle}/rankings/{boardId} alias, mirroring the public board view so a
// Signal reads as a standalone website end to end. Render shared byte-for-byte
// with /u/{handle}/rankings/{boardId} via components/signal/board-view.tsx.
//
// The middle "rankings" segment is literal, so this matches
// /{anything}/rankings/{anything}. The handle is gated the same way as the root
// profile route (format + reserved) before any board load.
export const revalidate = 3600;

// Stage C: root is canonical (see app/[handle]/page.tsx).
const CANONICAL_BASE = "";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string; boardId: string }>;
}): Promise<Metadata> {
  const { handle: rawHandle, boardId } = await params;
  const handle = normalizeHandle(rawHandle);
  if (validateHandleFormat(handle) !== null || isReservedRouteSegment(handle)) {
    return { title: "Board not found", robots: { index: false, follow: false } };
  }
  return buildBoardMetadata(handle, boardId, { canonicalBase: CANONICAL_BASE });
}

export default async function RootPublicBoardPage({
  params,
}: {
  params: Promise<{ handle: string; boardId: string }>;
}) {
  const { handle: rawHandle, boardId } = await params;
  const handle = normalizeHandle(rawHandle);
  if (validateHandleFormat(handle) !== null || isReservedRouteSegment(handle)) {
    notFound();
  }
  return (
    <BoardView rawHandle={rawHandle} boardId={boardId} canonicalBase={CANONICAL_BASE} />
  );
}
