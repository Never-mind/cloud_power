"use client";

import { createPortal } from "react-dom";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDownAZ, ArrowUpAZ, Check, ListFilter, Lock, Search, Unlock, X } from "lucide-react";
import { Input } from "./ui";

export type TableFilterOption = {
  value: string;
  count?: number;
};

export type TableSortOrder = "asc" | "desc" | "";

type TableColumnMenuProps = {
  column: { key: string; label: string; type?: string; sortable?: boolean; filterable?: boolean };
  sortOrder?: TableSortOrder;
  filterValues?: string[];
  loadOptions: (keyword: string) => Promise<TableFilterOption[]>;
  onSort: (order: TableSortOrder) => void;
  onFilter: (values: string[]) => void;
};

const LOCK_STORAGE_PREFIX = "cloud-power-table-locks:";

type TableController = {
  refresh: () => void;
  subscribe: (listener: () => void) => () => void;
};

const tableControllers = new WeakMap<HTMLTableElement, TableController>();

function getTableContext(button: HTMLButtonElement | null) {
  const table = button?.closest("table");
  if (!table) return null;
  const tableId = table.getAttribute("data-cloud-power-table-id");
  const tableIndex = Array.from(document.querySelectorAll("table")).indexOf(table);
  const storageKey = `${LOCK_STORAGE_PREFIX}${window.location.pathname}::${tableId || tableIndex}`;
  return { table, storageKey };
}

function readLockedColumns(storageKey: string) {
  try {
    const value = JSON.parse(window.localStorage.getItem(storageKey) ?? "[]");
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function writeLockedColumns(storageKey: string, columns: string[]) {
  window.localStorage.setItem(storageKey, JSON.stringify(columns));
}

function applyLockedColumns(table: HTMLTableElement, lockedColumns: string[]) {
  const headerRow = table.tHead?.rows[0];
  if (!headerRow) return;
  const headerCells = Array.from(headerRow.cells);
  const indexes = lockedColumns
    .map((column) => headerCells.findIndex((cell) => cell.querySelector("[data-cloud-power-column]")?.getAttribute("data-cloud-power-column") === column))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right);
  for (const row of Array.from(table.rows)) {
    for (const cell of Array.from(row.cells)) {
      if (cell.dataset.cloudPowerLocked !== "1") continue;
      cell.style.position = "";
      cell.style.left = "";
      cell.style.zIndex = "";
      cell.style.backgroundColor = "";
      cell.style.boxShadow = "";
      delete cell.dataset.cloudPowerLocked;
    }
  }

  let left = 0;
  for (const index of indexes) {
    const width = headerCells[index]?.getBoundingClientRect().width ?? 0;
    for (const row of Array.from(table.rows)) {
      const cell = row.cells[index];
      if (!cell || cell.colSpan > 1) continue;
      cell.dataset.cloudPowerLocked = "1";
      cell.style.position = "sticky";
      cell.style.left = `${left}px`;
      cell.style.zIndex = row.parentElement === table.tHead ? "35" : "25";
      cell.style.backgroundColor = row.parentElement === table.tHead ? "#f5f7fa" : "#ffffff";
      if (index === indexes[indexes.length - 1]) cell.style.boxShadow = "2px 0 4px rgba(0, 0, 0, 0.08)";
    }
    left += width;
  }
}

function getTableController(table: HTMLTableElement, storageKey: string) {
  const existing = tableControllers.get(table);
  if (existing) return existing;

  const subscribers = new Set<() => void>();
  let animationFrame = 0;
  const refreshNow = () => {
    animationFrame = 0;
    applyLockedColumns(table, readLockedColumns(storageKey));
    subscribers.forEach((listener) => listener());
  };
  const refresh = () => {
    if (animationFrame) return;
    animationFrame = window.requestAnimationFrame(refreshNow);
  };
  const observer = new MutationObserver(refresh);
  observer.observe(table, { childList: true, subtree: true });
  const onLockChange = (event: Event) => {
    if ((event as CustomEvent<string>).detail === storageKey) refresh();
  };
  window.addEventListener("cloud-power-table-lock-change", onLockChange);
  window.addEventListener("resize", refresh);

  const controller: TableController = {
    refresh,
    subscribe(listener) {
      subscribers.add(listener);
      refresh();
      return () => {
        subscribers.delete(listener);
        if (subscribers.size) return;
        observer.disconnect();
        window.removeEventListener("cloud-power-table-lock-change", onLockChange);
        window.removeEventListener("resize", refresh);
        if (animationFrame) window.cancelAnimationFrame(animationFrame);
        tableControllers.delete(table);
      };
    },
  };
  tableControllers.set(table, controller);
  return controller;
}

export function TableColumnMenu({
  column,
  sortOrder = "",
  filterValues = [],
  loadOptions,
  onSort,
  onFilter,
}: TableColumnMenuProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [options, setOptions] = useState<TableFilterOption[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set(filterValues));
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [locked, setLocked] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 300 });
  const selectionTouchedRef = useRef(filterValues.length > 0);
  const hasSearchedRef = useRef(false);
  const requestIdRef = useRef(0);

  const updatePosition = useCallback(() => {
    const button = buttonRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    const width = 300;
    const left = Math.min(Math.max(8, rect.right - width), window.innerWidth - width - 8);
    const top = rect.bottom + 6 + 360 <= window.innerHeight ? rect.bottom + 6 : Math.max(8, rect.top - 366);
    setPosition({ top, left, width });
  }, []);

  async function fetchOptions(keyword: string) {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    try {
      const next = await loadOptions(keyword);
      if (requestId !== requestIdRef.current) return;
      setOptions(next);
      if (!filterValues.length && !selectionTouchedRef.current) {
        setSelected(new Set(next.map((option) => option.value)));
        if (keyword) hasSearchedRef.current = true;
      }
    } catch {
      if (requestId !== requestIdRef.current) return;
      setOptions([]);
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }

  function openMenu() {
    updatePosition();
    setOpen(true);
    setFilterOpen(false);
  }

  function openFilter() {
    updatePosition();
    setOpen(false);
    setFilterOpen(true);
    setSearch("");
    setSelected(new Set(filterValues));
    selectionTouchedRef.current = filterValues.length > 0;
    hasSearchedRef.current = false;
    void fetchOptions("");
  }

  function applyFilter() {
    const allVisible = !search.trim() && options.length > 0 && options.every((option) => selected.has(option.value));
    onFilter(allVisible ? [] : Array.from(selected));
    setFilterOpen(false);
  }

  function toggleLock() {
    const context = getTableContext(buttonRef.current);
    if (!context) return;
    const current = readLockedColumns(context.storageKey);
    const next = current.includes(column.key)
      ? current.filter((key) => key !== column.key)
      : [...current, column.key];
    writeLockedColumns(context.storageKey, next);
    const tableId = context.table.getAttribute("data-cloud-power-table-id");
    if (tableId) {
      document.querySelectorAll<HTMLTableElement>("table[data-cloud-power-table-id]").forEach((table) => {
        if (table.getAttribute("data-cloud-power-table-id") === tableId) applyLockedColumns(table, next);
      });
    } else {
      applyLockedColumns(context.table, next);
    }
    window.dispatchEvent(new CustomEvent("cloud-power-table-lock-change", { detail: context.storageKey }));
    setLocked(next.includes(column.key));
    getTableController(context.table, context.storageKey).refresh();
    setOpen(false);
  }

  useEffect(() => {
    if (!open && !filterOpen) return;
    updatePosition();
    const onResize = () => updatePosition();
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
    };
  }, [filterOpen, open, updatePosition]);

  useEffect(() => {
    if (!open && !filterOpen) return;
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
      setFilterOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [filterOpen, open]);

  useEffect(() => {
    if (!filterOpen) return;
    const timer = window.setTimeout(() => void fetchOptions(search.trim()), 180);
    return () => window.clearTimeout(timer);
  }, [filterOpen, search]);

  useEffect(() => {
    const context = getTableContext(buttonRef.current);
    if (!context) return;
    const refresh = () => {
      const next = readLockedColumns(context.storageKey);
      setLocked(next.includes(column.key));
    };
    refresh();
    return getTableController(context.table, context.storageKey).subscribe(refresh);
  }, [column.key]);

  const visibleSelectedCount = options.filter((option) => selected.has(option.value)).length;
  const active = Boolean(sortOrder || filterValues.length);
  const panel = open || filterOpen ? (
    <div
      ref={panelRef}
      className="fixed z-[80] border border-[#dcdfe6] bg-white shadow-xl"
      style={{ top: position.top, left: position.left, width: position.width }}
    >
      {open ? (
        <div className="p-1 text-sm text-[#303133]">
          <button className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-[#f5f7fa]" type="button" onClick={() => { onSort("asc"); setOpen(false); }}>
            <ArrowUpAZ size={15} />
            升序
          </button>
          <button className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-[#f5f7fa]" type="button" onClick={() => { onSort("desc"); setOpen(false); }}>
            <ArrowDownAZ size={15} />
            降序
          </button>
          <button className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-[#f5f7fa]" type="button" onClick={openFilter}>
                   <ListFilter size={15} />
                   筛选
                 </button>
          <button className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-[#f5f7fa]" type="button" onClick={toggleLock}>
            {locked ? <Unlock size={15} /> : <Lock size={15} />}
            {locked ? "取消锁定此列" : "锁定此列"}
          </button>
          {(sortOrder || filterValues.length) ? (
              <button className="flex w-full items-center gap-2 border-t border-[#ebeef5] px-3 py-2 text-left text-[#909399] hover:bg-[#f5f7fa]" type="button" onClick={() => { onSort(""); onFilter([]); setOpen(false); }}>
              <X size={15} />
              清除当前设置
            </button>
          ) : null}
        </div>
      ) : (
        <div className="text-sm text-[#303133]">
          <div className="flex items-center gap-2 border-b border-[#ebeef5] p-2">
            <Search className="text-[#909399]" size={15} />
            <Input className="h-8 min-w-0 flex-1 border-0 px-1 shadow-none focus:border-0" placeholder="请输入关键字" value={search} onChange={(event) => setSearch(event.target.value)} autoFocus />
          </div>
          <div className="max-h-[260px] overflow-auto p-2">
            <label className="flex cursor-pointer items-center gap-2 border-b border-[#ebeef5] px-1 py-2 text-xs font-medium text-[#606266]">
              <input
                checked={options.length > 0 && options.every((option) => selected.has(option.value))}
                type="checkbox"
                onChange={(event) => {
                  selectionTouchedRef.current = true;
                  setSelected((current) => {
                   const next = new Set(current);
                   for (const option of options) {
                     if (event.target.checked) next.add(option.value);
                     else next.delete(option.value);
                   }
                   return next;
                  });
                }}
              />
              全选
            </label>
            {loading ? <div className="py-6 text-center text-xs text-[#909399]">加载中...</div> : null}
            {!loading && !options.length ? <div className="py-6 text-center text-xs text-[#909399]">暂无可选值</div> : null}
            {!loading ? options.map((option) => (
              <label className="flex cursor-pointer items-center gap-2 px-1 py-1.5 text-sm hover:bg-[#f5f7fa]" key={option.value} title={option.value}>
                <input
                  checked={selected.has(option.value)}
                  type="checkbox"
                  onChange={(event) => {
                    selectionTouchedRef.current = true;
                    setSelected((current) => {
                    const next = new Set(current);
                    if (event.target.checked) next.add(option.value);
                    else next.delete(option.value);
                    return next;
                    });
                  }}
                />
                <span className="min-w-0 flex-1 truncate">{option.value || "（空白）"}</span>
                {option.count === undefined ? null : <span className="text-xs text-[#909399]">({option.count})</span>}
              </label>
            )) : null}
          </div>
          <div className="flex items-center justify-between border-t border-[#ebeef5] p-2 text-xs">
            <span className="text-[#606266]">已选择 {visibleSelectedCount} / {options.length}</span>
            <div className="flex items-center gap-2">
              <button className="px-2 py-1 text-[#606266] hover:bg-[#f5f7fa]" type="button" onClick={() => setFilterOpen(false)}>取消</button>
              <button className="inline-flex items-center gap-1 bg-[#f56c6c] px-3 py-1 text-white hover:opacity-85" type="button" onClick={applyFilter}><Check size={13} />确定</button>
            </div>
          </div>
        </div>
      )}
    </div>
  ) : null;

  return (
    <>
      <span className="flex min-w-0 items-center justify-between gap-2">
        <span className="min-w-0 truncate" title={column.label}>{column.label}</span>
               <button
                 ref={buttonRef}
          aria-expanded={open || filterOpen}
          aria-label={`${column.label}排序和筛选`}
           className={`inline-flex h-5 w-5 items-center justify-center ${active ? "text-[#1890ff]" : "text-[#909399]"} hover:text-[#1890ff]`}
           data-cloud-power-column={column.key}
          title="排序和筛选"
          type="button"
          onClick={() => (open || filterOpen ? (setOpen(false), setFilterOpen(false)) : openMenu())}
        >
           <ListFilter size={14} />
         </button>
      </span>
      {typeof document === "undefined" ? null : createPortal(panel, document.body)}
    </>
  );
}
