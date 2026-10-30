/**
 * The Blueprint body while it loads (plan 9.17, 10.3). Same section count,
 * order and two-column pairs as the real body, so nothing jumps when it
 * arrives. aria-busy with one status sentence; the pulse stops under reduced
 * motion.
 */

const BLOCK = "animate-pulse rounded-modal border border-line bg-surface/50 motion-reduce:animate-none";

function Block({ h }: { h: string }) {
  return (
    <div className={BLOCK} style={{ height: h }}>
      <div className="h-[74px] border-b border-line bg-surface-elevated/50" />
    </div>
  );
}

export function BodySkeleton({ withShare = true }: { withShare?: boolean }) {
  return (
    <div className="mt-6 space-y-6" aria-busy="true">
      <p role="status" className="text-sm text-ink-muted">
        Building the blueprint: grades, calls and trade shapes from the league&apos;s own numbers.
      </p>
      {withShare && <div className="h-[60px] animate-pulse rounded-card bg-surface/60 motion-reduce:animate-none" />}
      <Block h="260px" />
      <Block h="230px" />
      <Block h="520px" />
      <Block h="420px" />
      <div className="grid items-start gap-6 xl:grid-cols-2">
        <Block h="240px" />
        <Block h="340px" />
      </div>
      <div className="grid items-start gap-6 xl:grid-cols-2">
        <Block h="300px" />
        <Block h="260px" />
      </div>
      <Block h="640px" />
      <div className="grid items-start gap-6 xl:grid-cols-2">
        <Block h="260px" />
        <Block h="260px" />
      </div>
      <Block h="520px" />
    </div>
  );
}
