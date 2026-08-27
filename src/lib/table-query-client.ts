"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReadonlyURLSearchParams } from "next/navigation";
import type { TableFilterOption, TableSortOrder } from "@/components/table-column-menu";

export function useTableColumnState(searchParams: ReadonlyURLSearchParams, keys: string[]) {
  const [sortField, setSortField] = useState(() => searchParams.get("sortField") ?? "");
  const [sortOrder, setSortOrder] = useState<TableSortOrder>(() => {
    const value = searchParams.get("sortOrder");
    return value === "asc" || value === "desc" ? value : "";
  });
  const [columnFilters, setColumnFilters] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(keys.map((key) => [key, searchParams.getAll(`filter.${key}`)])),
  );

  useEffect(() => {
    setSortField(searchParams.get("sortField") ?? "");
    const nextOrder = searchParams.get("sortOrder");
    setSortOrder(nextOrder === "asc" || nextOrder === "desc" ? nextOrder : "");
    setColumnFilters(Object.fromEntries(keys.map((key) => [key, searchParams.getAll(`filter.${key}`)])));
  }, [keys, searchParams]);

  return useMemo(() => ({
    sortField,
    sortOrder,
    columnFilters,
    setSort(field: string, order: Exclude<TableSortOrder, "">) {
      setSortField(field);
      setSortOrder(order);
    },
    setFilter(field: string, values: string[]) {
      setColumnFilters((current) => ({ ...current, [field]: values }));
    },
  }), [columnFilters, sortField, sortOrder]);
}

/**
 * Makes concurrent list loads last-write-wins. This prevents a slower request
 * started before a filter or sort change from replacing the newer result.
 */
export function useRequestGuard() {
  const requestSequence = useRef(0);

  useEffect(() => () => {
    requestSequence.current += 1;
  }, []);

  return useCallback(() => {
    const requestId = ++requestSequence.current;
    return () => requestId === requestSequence.current;
  }, []);
}

export async function fetchTableFilterOptions(
  endpoint: string,
  field: string,
  keyword: string,
  extraParams: Record<string, string> = {},
  filters: Record<string, string[]> = {},
  filterPrefix = "filter",
): Promise<TableFilterOption[]> {
  const params = new URLSearchParams({ field, ...extraParams });
  if (keyword.trim()) params.set("keyword", keyword.trim());
  for (const [filterField, values] of Object.entries(filters)) {
    if (filterField === field) continue;
    for (const value of values) params.append(`${filterPrefix}.${filterField}`, value);
  }
  const response = await fetch(`${endpoint}?${params.toString()}`);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "筛选候选值加载失败");
  return (data.options ?? []) as TableFilterOption[];
}

export function appendTableFilterParams(
  params: URLSearchParams,
  filters: Record<string, string[]>,
  excludedField?: string,
) {
  for (const [field, values] of Object.entries(filters)) {
    if (field === excludedField) continue;
    for (const value of values) params.append(`filter.${field}`, value);
  }
}

export function appendTableQueryParams(
  params: URLSearchParams,
  sortField: string,
  sortOrder: TableSortOrder,
  columnFilters: Record<string, string[]>,
) {
  if (sortField && sortOrder) {
    params.set("sortField", sortField);
    params.set("sortOrder", sortOrder);
  }
  for (const [key, values] of Object.entries(columnFilters)) {
    for (const value of values) params.append(`filter.${key}`, value);
  }
}
