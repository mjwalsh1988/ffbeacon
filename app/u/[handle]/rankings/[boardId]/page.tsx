import type { Metadata } from "next";
import { buildBoardMetadata, BoardView } from "@/components/signal/board-view";

export const revalidate = 3600;

// Legacy alias. The render lives in components/signal/board-view.tsx and is
// shared byte-for-byte with the root /{handle}/rankings/{boardId} route. While
// /u is canonical (Phase 7 Stage B), canonicalBase is "/u".
const CANONICAL_BASE = "/u";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string; boardId: string }>;
}): Promise<Metadata> {
  const { handle, boardId } = await params;
  return buildBoardMetadata(handle, boardId, { canonicalBase: CANONICAL_BASE });
}

export default async function PublicBoardPage({
  params,
}: {
  params: Promise<{ handle: string; boardId: string }>;
}) {
  const { handle, boardId } = await params;
  return (
    <BoardView rawHandle={handle} boardId={boardId} canonicalBase={CANONICAL_BASE} />
  );
}
