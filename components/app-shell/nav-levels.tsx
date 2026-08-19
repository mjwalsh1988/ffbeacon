"use client";

/**
 * The two-level navigation used by both halves of the app shell: the desktop
 * rail and the mobile drawer.
 *
 * Level one lists the sections. A section that has children is a button rather
 * than a link; pressing it slides level one out to the left while level two
 * comes in from the right, so moving into a section reads as one motion. Level
 * two opens with a Back row and then a row pointing at the section's own index
 * page, so `/tools` is never stranded behind its own submenu, followed by the
 * children.
 *
 * What keeps this honest for a screen reader:
 *   - The whole thing is a `<nav>` with a name, so it is findable from the
 *     landmark list. It is the site's primary navigation and there is nowhere
 *     else to look for it.
 *   - The parked level carries `inert`, so it is out of the tab order and out
 *     of the accessibility tree for as long as it is off screen. A reader can
 *     never land on a link that is not visible.
 *   - Level two is a `role="group"` labelled by a heading that stays in the
 *     accessibility tree even when the rail is a strip of icons, so the section
 *     you are inside is always named.
 *   - The section button is a real disclosure: `aria-expanded` on all of them,
 *     `aria-controls` only on the one that is actually open, so nothing points
 *     at a panel holding someone else's children.
 *   - Opening moves focus to the Back button, whose name says which section you
 *     just entered. Closing puts focus back on the section button that was
 *     pressed. Escape closes, and that Escape is bound to this nav rather than
 *     to the document: a global listener would fight every dialog, palette, and
 *     popover on the site for the same key.
 *   - Every row keeps its label and its one-line hint in its accessible name at
 *     both sizes, so the rail and the drawer announce the same thing.
 */

import Link from "next/link";
import type { Route } from "next";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ChevronRight, ChevronLeft } from "lucide-react";
import type { NavNode } from "@/lib/nav-types";
import { navIcon } from "./nav-icons";

export type NavLevelsProps = {
  tree: NavNode[];
  /** The section and child the pathname sits under. */
  activeSectionId: string | null;
  activeChildId: string | null;
  /**
   * The current row inside a route-contributed section, when there is one.
   *
   * Both this and the pathname trail are true at the same time: inside a draft
   * room you are on the Grades view AND on `/tools/on-the-clock`. Replacing one
   * with the other loses an `aria-current` a reader was using.
   */
  contributedActive?: { sectionId: string; childId: string | null } | null;
  /** "rail" is the compact desktop strip; "drawer" is the roomy mobile sheet. */
  variant: "rail" | "drawer";
  /** Names the nav landmark. Both instances describe the same tree, so only one
   *  of them is ever rendered at a given width. */
  label?: string;
  /** Called after any link is followed. The drawer uses it to close itself. */
  onNavigate?: () => void;
  /** Called when a section is opened while the rail is collapsed, so the rail
   *  can widen and show the level the reader just asked for. */
  onRequestExpand?: () => void;
  /** A section to show opened on arrival. League Pulse uses it so the league's
   *  own sections are the first thing in the rail once you are inside one.
   *  Opening on arrival does NOT move focus; only a press does. */
  defaultOpenId?: string | null;
};

export function NavLevels({
  tree,
  activeSectionId,
  activeChildId,
  contributedActive = null,
  variant,
  label = "Site sections",
  onNavigate,
  onRequestExpand,
  defaultOpenId = null,
}: NavLevelsProps) {
  // React 19 ids carry characters a CSS selector cannot take. These only ever
  // reach `id` and `aria-controls`, but strip them anyway so the next person to
  // query for one is not caught out.
  const reactId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const levelTwoId = `nav-level-2-${reactId}`;
  const levelTwoTitleId = `nav-level-2-title-${reactId}`;
  const [openId, setOpenId] = useState<string | null>(defaultOpenId);
  const rootRef = useRef<HTMLElement | null>(null);
  const buttonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const backRef = useRef<HTMLButtonElement | null>(null);
  const [announcement, setAnnouncement] = useState("");
  // Whether the level showing was asked for by a press, which is the only case
  // where focus should follow it. A level opened because the route arrived
  // already open must leave the reader where they are.
  const openedByPress = useRef(false);

  // The rail arrives showing the level that holds the page you are on: the
  // section a route asked for by name, else the section the pathname sits under
  // when that section has a second level, else level one. It keys on the active
  // SECTION rather than the pathname, so moving between two pages inside one
  // section leaves the level where the reader put it, and leaving the section
  // is what puts the rail back to level one. It deliberately does not move
  // focus; only a press does that.
  //
  // A route that contributes its own sections registers after hydration, so
  // `defaultOpenId` can arrive a beat late; it is a dependency for that reason.
  const activeHasChildren = tree.some(
    (section) => section.id === activeSectionId && (section.children?.length ?? 0) > 0,
  );
  useEffect(() => {
    openedByPress.current = false;
    setOpenId(defaultOpenId ?? (activeHasChildren ? activeSectionId : null));
  }, [defaultOpenId, activeSectionId, activeHasChildren]);

  const openSection = openId ? (tree.find((s) => s.id === openId) ?? null) : null;

  const openLevelTwo = useCallback(
    (section: NavNode) => {
      onRequestExpand?.();
      openedByPress.current = true;
      setOpenId(section.id);
      // Rows in the level about to appear: Back, then the index row when the
      // section has a page of its own, then the children. The section name
      // itself rides on the Back button's accessible name, because a polite
      // region queued in the same tick as a focus move is routinely dropped in
      // favour of the focus announcement.
      const rows = (section.children?.length ?? 0) + (section.href ? 2 : 1);
      setAnnouncement(`${rows} items.`);
    },
    [onRequestExpand],
  );

  const closeLevelTwo = useCallback(() => {
    const returnTo = openId ? buttonRefs.current[openId] : null;
    openedByPress.current = true;
    setOpenId(null);
    setAnnouncement("Main menu.");
    // The parked level is inert, so focus has to move before the state lands.
    window.requestAnimationFrame(() => returnTo?.focus());
  }, [openId]);

  // Focus the Back row as soon as level two is on screen, so the keyboard lands
  // inside the level that just opened rather than back at the top of the page.
  useEffect(() => {
    if (!openId || !openedByPress.current) return;
    const frame = window.requestAnimationFrame(() => backRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [openId]);

  // Escape steps back a level, and it is bound to this nav rather than to the
  // document. A document listener would fire for every Escape anywhere on the
  // page: closing the search palette would also collapse the rail and drag
  // focus onto a section button, on every route where a level is open, which is
  // most of them.
  const onEscape = useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      if (event.key !== "Escape" || !openId) return;
      event.preventDefault();
      event.stopPropagation();
      closeLevelTwo();
    },
    [openId, closeLevelTwo],
  );

  const isRail = variant === "rail";
  const rowBase = isRail
    ? "group relative flex min-h-11 w-full items-center gap-3 rounded-card border px-2.5 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
    : "group relative flex min-h-[3.25rem] w-full items-center gap-3 rounded-card border px-3 py-2 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan";

  const activeRow = "border-brand-cyan/40 bg-brand-cyan/10 text-brand-cyan";
  const idleRow = isRail
    ? "border-transparent text-ink-muted hover:bg-base/70 hover:text-ink"
    : "border-line bg-base/60 text-ink hover:border-line-accent";

  /** `page` only for the page you are actually on; `true` for its ancestors. */
  const current = (exact: boolean, ancestor = false) =>
    exact ? ("page" as const) : ancestor ? ("true" as const) : undefined;

  /**
   * Which child of the open section is current. A contributed section states
   * its own, because its rows can differ only by which view is showing and a
   * pathname cannot tell those apart. Every other section uses the pathname.
   */
  const openChildId =
    openSection && openSection.id === contributedActive?.sectionId
      ? contributedActive.childId
      : activeChildId;

  return (
    <nav
      ref={rootRef}
      aria-label={label}
      onKeyDown={onEscape}
      className="app-nav-levels flex-1"
    >
      {/* Level one. Parked to the left while a section is open. */}
      <div
        data-level="1"
        data-state={openSection ? "parked-left" : "current"}
        // `inert` is what keeps the parked level out of the tab order and out
        // of the accessibility tree while it is off screen.
        inert={Boolean(openSection)}
        aria-hidden={openSection ? true : undefined}
        className="app-nav-level absolute inset-0 overflow-y-auto beacon-scroll"
      >
        <ul className={isRail ? "space-y-1 p-2" : "space-y-2 p-3"}>
          {tree.map((section) => {
            const isContributed = section.id === contributedActive?.sectionId;
            const exact = section.id === activeSectionId && !activeChildId;
            const inSection = section.id === activeSectionId || isContributed;
            const hasChildren = (section.children?.length ?? 0) > 0;

            if (!hasChildren) {
              return (
                <li key={section.id}>
                  <NavRow
                    node={section}
                    variant={variant}
                    rowBase={rowBase}
                    className={inSection ? activeRow : idleRow}
                    active={inSection}
                    current={current(exact, inSection)}
                    onNavigate={onNavigate}
                  />
                </li>
              );
            }

            const isOpen = openId === section.id;
            return (
              <li key={section.id}>
                <button
                  type="button"
                  ref={(node) => {
                    buttonRefs.current[section.id] = node;
                  }}
                  onClick={() => openLevelTwo(section)}
                  aria-expanded={isOpen}
                  // Only the open button points at the panel. Advertising it on
                  // all of them sends a reader who jumps by aria-controls into
                  // whichever section happens to be showing.
                  aria-controls={isOpen ? levelTwoId : undefined}
                  title={section.label}
                  className={`${rowBase} ${inSection ? activeRow : idleRow}`}
                >
                  {inSection && <ActiveBar />}
                  <RowIcon icon={section.icon} variant={variant} active={inSection} />
                  <RowText
                    variant={variant}
                    label={section.label}
                    hint={section.hint}
                    active={inSection}
                  />
                  <ChevronRight
                    aria-hidden="true"
                    className={`ml-auto h-4 w-4 shrink-0 text-ink-muted ${
                      isRail ? "app-rail-when-open" : ""
                    }`}
                  />
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Level two. Parked to the right until a section is opened. */}
      <div
        id={levelTwoId}
        data-level="2"
        data-state={openSection ? "current" : "parked-right"}
        inert={!openSection}
        aria-hidden={openSection ? undefined : true}
        // A group, so the heading below can name it. A bare div takes no name.
        role="group"
        aria-labelledby={openSection ? levelTwoTitleId : undefined}
        className="app-nav-level absolute inset-0 overflow-y-auto beacon-scroll"
      >
        {openSection && (
          <div className={isRail ? "p-2" : "p-3"}>
            <button
              type="button"
              ref={backRef}
              onClick={closeLevelTwo}
              title="Back to main menu"
              className={`${rowBase} border-line bg-base/60 text-ink hover:border-line-accent`}
            >
              <ChevronLeft
                aria-hidden="true"
                className="h-[18px] w-[18px] shrink-0 text-brand-cyan"
              />
              {/* The visible label is short; the accessible name says which
                  section you are in, because this is what takes focus when a
                  level opens and it is the most reliable place to put it. */}
              <span className={isRail ? "app-rail-label truncate" : "truncate"}>
                Back to main menu
              </span>
              <span className="sr-only">, leaving {openSection.label}</span>
            </button>

            {/* The section name. Visible when there is room for it, and always
                in the accessibility tree, because it is what names the group. */}
            <h2
              id={levelTwoTitleId}
              className={`mt-3 px-2 text-[10px] font-bold uppercase tracking-[0.18em] text-brand-cyan ${
                isRail ? "app-rail-heading" : ""
              }`}
            >
              {openSection.label}
            </h2>

            <ul className={isRail ? "mt-1 space-y-1" : "mt-2 space-y-2"}>
              {/* The row pointing at the section's own page, so `/tools` is
                  never stranded behind its own submenu. A section with no page
                  of its own (a draft room's views, say) simply has none. */}
              {openSection.href && (
                <li>
                  <NavRow
                    node={{
                      ...openSection,
                      label: openSection.indexLabel ?? `All ${openSection.label}`,
                      children: undefined,
                    }}
                    variant={variant}
                    rowBase={rowBase}
                    className={
                      activeSectionId === openSection.id && !openChildId
                        ? activeRow
                        : idleRow
                    }
                    active={activeSectionId === openSection.id && !openChildId}
                    current={current(
                      activeSectionId === openSection.id && !openChildId,
                    )}
                    onNavigate={onNavigate}
                  />
                </li>
              )}
              {(openSection.children ?? []).map((child) => {
                const isActive = child.id === openChildId;
                return (
                  <li key={child.id}>
                    <NavRow
                      node={child}
                      variant={variant}
                      rowBase={rowBase}
                      className={isActive ? activeRow : idleRow}
                      active={isActive}
                      current={current(isActive)}
                      onNavigate={onNavigate}
                    />
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      {/* How many rows the level that just appeared holds. The slide itself
          carries nothing for anyone who is not watching it, and the section
          name is on the control that takes focus rather than in here. */}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </nav>
  );
}

/**
 * One row. A link when the node has an href, a button when it switches a view
 * in place, and never both. The two look identical on purpose: from the
 * reader's side the difference is where they end up, not what they pressed.
 *
 * An in-place row takes `aria-current="true"` rather than `"page"`, because a
 * draft view is a state of this page rather than a page of its own.
 */
function NavRow({
  node,
  variant,
  rowBase,
  className,
  active,
  current,
  onNavigate,
}: {
  node: NavNode;
  variant: "rail" | "drawer";
  rowBase: string;
  className: string;
  active: boolean;
  /** Only read on a link row. An in-place row is never a page. */
  current: "page" | "true" | undefined;
  onNavigate?: () => void;
}) {
  const inner = (
    <>
      {active && <ActiveBar />}
      <RowIcon icon={node.icon} variant={variant} active={active} />
      <RowText
        variant={variant}
        label={node.label}
        hint={node.hint}
        active={active}
      />
    </>
  );

  if (!node.href) {
    return (
      <button
        type="button"
        onClick={() => {
          node.onSelect?.();
          onNavigate?.();
        }}
        aria-current={active ? "true" : undefined}
        title={node.label}
        className={`${rowBase} ${className}`}
      >
        {inner}
      </button>
    );
  }

  return (
    <Link
      href={node.href as Route}
      aria-current={current}
      title={node.label}
      onClick={onNavigate}
      className={`${rowBase} ${className}`}
    >
      {inner}
    </Link>
  );
}

/** The bar down the left edge of the current row. Decorative: the state is
 *  already carried by aria-current and by the label. */
function ActiveBar() {
  return (
    <span
      aria-hidden="true"
      className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-brand-cyan"
    />
  );
}

function RowIcon({
  icon,
  variant,
  active,
}: {
  icon: NavNode["icon"];
  variant: "rail" | "drawer";
  active: boolean;
}) {
  const Icon = navIcon(icon);
  if (variant === "rail") {
    return <Icon aria-hidden="true" className="h-[18px] w-[18px] shrink-0" />;
  }
  return (
    <span
      aria-hidden="true"
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-card border ${
        active ? "border-brand-cyan/40 text-brand-cyan" : "border-line text-ink-muted"
      }`}
    >
      <Icon className="h-[18px] w-[18px]" />
    </span>
  );
}

function RowText({
  variant,
  label,
  hint,
  active,
}: {
  variant: "rail" | "drawer";
  label: string;
  hint: string;
  active: boolean;
}) {
  if (variant === "rail") {
    return (
      <span className="app-rail-label min-w-0 truncate">
        {label}
        {/* The hint is painted only in the drawer, where there is room for a
            second line, but it belongs to the accessible name at both sizes so
            the same link does not announce differently on a laptop and a
            phone. */}
        <span className="sr-only">. {hint}</span>
      </span>
    );
  }
  return (
    <span className="min-w-0 flex-1">
      <span
        className={`block text-sm font-semibold ${active ? "text-brand-cyan" : "text-ink"}`}
      >
        {label}
      </span>
      <span className="block text-xs text-ink-muted">{hint}</span>
    </span>
  );
}
