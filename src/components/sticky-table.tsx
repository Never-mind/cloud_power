"use client";

import {
  Children,
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";

type TableElementProps = {
  children?: ReactNode;
  className?: string;
  style?: React.CSSProperties;
  [key: string]: unknown;
};

type StickyTableProps = {
  children: ReactNode;
  className: string;
  tableKey?: string;
  topOffset?: number;
};

type StickyMetrics = {
  left: number;
  width: number;
  tableWidth: number;
  scrollLeft: number;
  stuck: boolean;
  columnWidths: number[];
};

const DEFAULT_HEADER_HEIGHT = 48;

function getStaticText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(getStaticText).join("");
  if (isValidElement<TableElementProps>(node)) return getStaticText(node.props.children);
  return "";
}

function getActionColumnIndexes(table: HTMLTableElement) {
  const headerRow = table.tHead?.rows[0];
  if (!headerRow) return [];

  const indexes: number[] = [];
  let columnIndex = 0;
  for (const cell of Array.from(headerRow.cells)) {
    const span = Math.max(cell.colSpan || 1, 1);
    if (cell.tagName === "TH" && (cell.textContent ?? "").replace(/\s+/g, "").trim() === "操作") {
      for (let offset = 0; offset < span; offset += 1) indexes.push(columnIndex + offset);
    }
    columnIndex += span;
  }
  return indexes;
}

function markActionColumns(table: HTMLTableElement) {
  const actionIndexes = new Set(getActionColumnIndexes(table));
  if (!actionIndexes.size) return;

  for (const row of Array.from(table.rows)) {
    let columnIndex = 0;
    for (const cell of Array.from(row.cells)) {
      const span = Math.max(cell.colSpan || 1, 1);
      const isActionCell = span === 1 && actionIndexes.has(columnIndex);
      if (isActionCell) cell.dataset.cloudPowerActionColumn = "1";
      else delete cell.dataset.cloudPowerActionColumn;
      columnIndex += span;
    }
  }
}

function getTableChildren(table: ReactElement<TableElementProps>) {
  return Children.toArray(table.props.children);
}

function cloneHeaderNode(
  node: ReactNode,
  columnWidths: number[],
  columnIndex: { value: number },
  actionTranslateX?: number,
): ReactNode {
  if (!isValidElement<TableElementProps>(node)) return node;

  if (node.type === "th") {
    const width = columnWidths[columnIndex.value];
    const isActionHeader = getStaticText(node.props.children).replace(/\s+/g, "").trim() === "操作";
    columnIndex.value += 1;
    if (!width) return node;
    return cloneElement(node, {
      ...(isActionHeader ? { "data-cloud-power-action-column": "1" } : {}),
      style: {
        ...node.props.style,
        width,
        minWidth: width,
        maxWidth: width,
        ...(isActionHeader && actionTranslateX !== undefined
          ? {
              position: "relative",
              right: "auto",
              zIndex: 35,
              backgroundColor: "#f5f7fa",
              transform: `translateX(${actionTranslateX}px)`,
            }
          : {}),
      },
    });
  }

  if (!node.props.children) return node;
  return cloneElement(node, {
    children: Children.map(node.props.children, (child) => cloneHeaderNode(child, columnWidths, columnIndex, actionTranslateX)),
  });
}

function getHeaderChildren(table: ReactElement<TableElementProps>, columnWidths: number[], actionTranslateX?: number) {
  const columnIndex = { value: 0 };
  return getTableChildren(table)
    .filter((child) => isValidElement(child) && child.type === "thead")
    .map((child) => cloneHeaderNode(child, columnWidths, columnIndex, actionTranslateX));
}

function withTableId(
  table: ReactElement<TableElementProps>,
  tableId: string,
  children: ReactNode,
  width?: number,
) {
  return cloneElement(table, {
    "data-cloud-power-table-id": tableId,
    children,
    ...(width
      ? {
          style: {
            ...table.props.style,
            width,
            minWidth: width,
          },
        }
      : {}),
  });
}

/**
 * Keeps page-level vertical scrolling while providing a real fixed header for
 * horizontally scrollable tables. The header is rendered once more only while
 * the table is crossing the top of the viewport, so its controls remain live.
 */
export function StickyTable({ children, className, tableKey, topOffset = 0 }: StickyTableProps) {
  const generatedTableKey = useId().replace(/:/g, "");
  const stableTableKey = tableKey || `table-${generatedTableKey}`;
  const regionRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const headerViewportRef = useRef<HTMLDivElement>(null);
  const [headerHeight, setHeaderHeight] = useState(DEFAULT_HEADER_HEIGHT);
  const [metrics, setMetrics] = useState<StickyMetrics>({
    left: 0,
    width: 0,
    tableWidth: 0,
    scrollLeft: 0,
    stuck: false,
    columnWidths: [],
  });

  useEffect(() => {
    const region = regionRef.current;
    const body = bodyRef.current;
    if (!region || !body) return;

    let animationFrame = 0;
    const refresh = () => {
      if (animationFrame) return;
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = 0;
        const regionRect = region.getBoundingClientRect();
        const bodyRect = body.getBoundingClientRect();
        const headerRow = body.querySelector<HTMLTableRowElement>("thead tr");
        const columnWidths = headerRow
          ? Array.from(headerRow.cells).map((cell) => Math.ceil(cell.getBoundingClientRect().width))
          : [];
        const next: StickyMetrics = {
          left: bodyRect.left,
          width: body.clientWidth,
          tableWidth: Math.max(body.scrollWidth, body.clientWidth),
          scrollLeft: body.scrollLeft,
          stuck: regionRect.top <= topOffset && regionRect.bottom > topOffset + headerHeight,
          columnWidths,
        };
        setMetrics((current) =>
          current.left === next.left
            && current.width === next.width
            && current.tableWidth === next.tableWidth
            && current.scrollLeft === next.scrollLeft
            && current.stuck === next.stuck
            && current.columnWidths.length === next.columnWidths.length
            && current.columnWidths.every((width, index) => width === next.columnWidths[index])
            ? current
            : next,
        );
      });
    };

    body.addEventListener("scroll", refresh, { passive: true });
    window.addEventListener("scroll", refresh, { passive: true, capture: true });
    window.addEventListener("resize", refresh);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(refresh);
    observer?.observe(region);
    observer?.observe(body);
    refresh();

    return () => {
      body.removeEventListener("scroll", refresh);
      window.removeEventListener("scroll", refresh, true);
      window.removeEventListener("resize", refresh);
      observer?.disconnect();
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
    };
  }, [headerHeight, topOffset]);

  // Mark the action column in both the source table and its fixed-header copy.
  // This also covers rows rendered by child components, which are not visible
  // to the React tree walker used to build the cloned header.
  useEffect(() => {
    const region = regionRef.current;
    if (!region) return;

    const markTables = () => {
      region.querySelectorAll<HTMLTableElement>("table").forEach(markActionColumns);
    };
    markTables();
    const observer = new MutationObserver(markTables);
    observer.observe(region, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!metrics.stuck || !headerViewportRef.current) return;
    const measuredHeight = Math.ceil(headerViewportRef.current.getBoundingClientRect().height);
    if (measuredHeight > 0 && measuredHeight !== headerHeight) setHeaderHeight(measuredHeight);
  }, [headerHeight, metrics.stuck]);

  const childNodes = Children.toArray(children);
  const tableIndex = childNodes.findIndex((child) => isValidElement<TableElementProps>(child) && child.type === "table");
  const table = tableIndex >= 0 ? childNodes[tableIndex] as ReactElement<TableElementProps> : null;

  if (!table) {
    return <div ref={bodyRef} className={className}>{children}</div>;
  }

  const extraChildren = childNodes.filter((_, index) => index !== tableIndex);

  const headerTable = withTableId(
    table,
    stableTableKey,
    getHeaderChildren(
      table,
      metrics.columnWidths,
      metrics.width > 0 && metrics.tableWidth > 0
        ? metrics.width - metrics.tableWidth + metrics.scrollLeft
        : undefined,
    ),
    metrics.tableWidth || undefined,
  );
  const bodyTable = withTableId(table, stableTableKey, table.props.children);

  return (
    <div ref={regionRef} className="sticky-table-region min-w-0 max-w-full">
      <div ref={bodyRef} className={className}>
        {bodyTable}
        {extraChildren}
      </div>
      {metrics.stuck ? (
        <div
          className="pointer-events-auto fixed z-[60] overflow-hidden border border-[#dcdfe6] bg-white shadow-sm"
          style={{
            left: metrics.left,
            top: topOffset,
            width: metrics.width,
          }}
        >
          <div ref={headerViewportRef} className="overflow-hidden">
            <div style={{ width: metrics.tableWidth, transform: `translateX(-${metrics.scrollLeft}px)` }}>
              {headerTable}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
