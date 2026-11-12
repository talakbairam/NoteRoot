/** The rows at the top of the Notes tree that always exist: the sync rows and the three groups. */
export const SIDEBAR_FIXED_ITEMS = ["sync", "favorites", "pinned", "recent"] as const;
export type SidebarFixedId = (typeof SIDEBAR_FIXED_ITEMS)[number];

/** A blank row: `gap1`, `gap2`... The user adds and removes them, so there can be none or several. */
export type SidebarGapId = `gap${number}`;
export type SidebarItemId = SidebarFixedId | SidebarGapId;

/** Most blank rows the user can have. */
export const MAX_SIDEBAR_GAPS = 10;

const GAP_PATTERN = /^gap([1-9]\d{0,2})$/;

export function isGapItem(id: SidebarItemId): id is SidebarGapId {
  return GAP_PATTERN.test(id);
}

export function isSidebarItemId(value: unknown): value is SidebarItemId {
  return (
    typeof value === "string" &&
    ((SIDEBAR_FIXED_ITEMS as readonly string[]).includes(value) || GAP_PATTERN.test(value))
  );
}

/** The order of the rows and the ones the user hid. */
export interface SidebarLayout {
  order: SidebarItemId[];
  hidden: SidebarItemId[];
}

/** The default order: a blank row after the sync rows and one before the folders. */
export const DEFAULT_SIDEBAR_ORDER: readonly SidebarItemId[] = [
  "sync",
  "gap1",
  "favorites",
  "pinned",
  "recent",
  "gap2",
];

/** The default: every row, in the default order. */
export function defaultLayout(): SidebarLayout {
  return { order: [...DEFAULT_SIDEBAR_ORDER], hidden: [] };
}

/**
 * Turns a stored value into a usable layout: unknown and repeated ids are dropped, a row that always exists and is missing
 * (a newer version added one) goes to the end, and a hidden id that is not in the order is forgotten. Blank rows are only
 * the ones that are stored, at most {@link MAX_SIDEBAR_GAPS}; nothing stored gives the default layout.
 */
export function normalizeLayout(raw: unknown): SidebarLayout {
  if (typeof raw !== "object" || raw === null) {
    return defaultLayout();
  }
  const stored = raw as Record<string, unknown>;
  const ids = (value: unknown): SidebarItemId[] =>
    (Array.isArray(value) ? value : []).filter(
      (id, index, all): id is SidebarItemId => isSidebarItemId(id) && all.indexOf(id) === index
    );
  let gaps = 0;
  const order = ids(stored.order).filter((id) => !isGapItem(id) || ++gaps <= MAX_SIDEBAR_GAPS);
  for (const id of SIDEBAR_FIXED_ITEMS) {
    if (!order.includes(id)) {
      order.push(id);
    }
  }
  return { order, hidden: ids(stored.hidden).filter((id) => order.includes(id)) };
}

/** `order` with `id` one place earlier (`-1`) or later (`1`); at the edge it stays as it is. */
export function moveItem(
  order: readonly SidebarItemId[],
  id: SidebarItemId,
  direction: -1 | 1
): SidebarItemId[] {
  const result = [...order];
  const from = result.indexOf(id);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= result.length) {
    return result;
  }
  [result[from], result[to]] = [result[to], result[from]];
  return result;
}

/** How many blank rows `order` has. */
export function countGaps(order: readonly SidebarItemId[]): number {
  return order.filter((id) => isGapItem(id)).length;
}

/** `order` with a new blank row at the end (the lowest free number), or as it is when there are already the most. */
export function addGap(order: readonly SidebarItemId[]): SidebarItemId[] {
  if (countGaps(order) >= MAX_SIDEBAR_GAPS) {
    return [...order];
  }
  let number = 1;
  while (order.includes(`gap${number}`)) {
    number++;
  }
  return [...order, `gap${number}`];
}

/** `order` without the blank row `id`. A row that always exists is never removed. */
export function removeGap(order: readonly SidebarItemId[], id: SidebarItemId): SidebarItemId[] {
  return isGapItem(id) ? order.filter((item) => item !== id) : [...order];
}
