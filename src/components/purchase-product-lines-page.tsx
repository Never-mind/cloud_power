"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { FileDown, RefreshCw, Search } from "lucide-react";
import { formatDisplayValue } from "@/lib/display-format";
import { exportRowsToXlsx } from "@/lib/client-xlsx-export";
import { fetchAllEntityRows } from "@/lib/client-entity-fetch";
import { DEFAULT_PAGE_SIZE } from "@/lib/pagination";
import { PURCHASE_PRODUCT_LINE_COLUMNS } from "@/lib/purchase-lines";
import { PaginationBar } from "./pagination-bar";
import { StickyTable } from "./sticky-table";
import { TableColumnMenu, type TableFilterOption, type TableSortOrder } from "./table-column-menu";
import { useRequestGuard } from "@/lib/table-query-client";
import { Button, Input, Panel } from "./ui";
import { buildListRoute, getCurrentRoute, useListScrollPosition } from "@/lib/client-list-navigation";

type Row = Record<string, string | number | boolean | null>;
type ListResponse = { rows: Row[]; total: number; page: number; pageSize: number; totalPages: number };

const columns = PURCHASE_PRODUCT_LINE_COLUMNS.map((column) => ({ ...column, sortable: true, filterable: true }));

export function PurchaseProductLinesPage() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [rows, setRows] = useState<Row[]>([]);
  const [keyword, setKeyword] = useState(() => searchParams.get("keyword") ?? "");
  const [countryCode, setCountryCode] = useState(() => searchParams.get("countryCode") ?? "");
  const [appliedKeyword, setAppliedKeyword] = useState(() => searchParams.get("keyword") ?? "");
  const [appliedCountryCode, setAppliedCountryCode] = useState(() => searchParams.get("countryCode") ?? "");
  const [countries, setCountries] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(() => Number(searchParams.get("page") ?? 1) || 1);
  const [pageSize, setPageSize] = useState(() => Number(searchParams.get("pageSize") ?? DEFAULT_PAGE_SIZE) || DEFAULT_PAGE_SIZE);
  const [sortField, setSortField] = useState(() => searchParams.get("sortField") ?? "");
  const [sortOrder, setSortOrder] = useState<TableSortOrder>(() => {
    const value = searchParams.get("sortOrder");
    return value === "asc" || value === "desc" ? value : "";
  });
  const [columnFilters, setColumnFilters] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(columns.map((column) => [column.key, searchParams.getAll(`filter.${column.key}`)])),
  );
  const [total, setTotal] = useState(0);
  const pageSizeRef = useRef(pageSize);
  const skipNextPageChangeRef = useRef(false);
  const beginRequest = useRequestGuard();
  const currentRoute = getCurrentRoute(pathname, searchParams.toString());

  useListScrollPosition(currentRoute, !loading);

  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", String(page));
    params.set("pageSize", String(pageSize));
    if (appliedKeyword.trim()) params.set("keyword", appliedKeyword); else params.delete("keyword");
    if (appliedCountryCode.trim()) params.set("countryCode", appliedCountryCode); else params.delete("countryCode");
    if (sortField && sortOrder) { params.set("sortField", sortField); params.set("sortOrder", sortOrder); }
    else { params.delete("sortField"); params.delete("sortOrder"); }
    for (const [key, values] of Object.entries(columnFilters)) {
      params.delete(`filter.${key}`);
      values.forEach((value) => params.append(`filter.${key}`, value));
    }
    const nextRoute = buildListRoute(pathname, params);
    if (nextRoute !== currentRoute) router.replace(nextRoute, { scroll: false });
  }, [appliedCountryCode, appliedKeyword, columnFilters, currentRoute, page, pageSize, pathname, router, searchParams, sortField, sortOrder]);

  function buildParams(nextPage: number, nextPageSize: number, exportAll = false, nextCountryCode = appliedCountryCode, nextKeyword = appliedKeyword) {
    const params = new URLSearchParams({ page: String(nextPage), pageSize: String(nextPageSize) });
    if (nextKeyword.trim()) params.set("keyword", nextKeyword.trim());
    if (nextCountryCode.trim()) params.set("countryCode", nextCountryCode.trim());
    if (sortField && sortOrder) { params.set("sortField", sortField); params.set("sortOrder", sortOrder); }
    for (const [key, values] of Object.entries(columnFilters)) values.forEach((value) => params.append(`filter.${key}`, value));
    if (exportAll) params.set("export", "1");
    return params;
  }

  async function fetchData(nextPage: number, nextPageSize: number, exportAll = false, nextCountryCode = appliedCountryCode, nextKeyword = appliedKeyword): Promise<ListResponse> {
    const response = await fetch(`/api/purchase/product-lines?${buildParams(nextPage, nextPageSize, exportAll, nextCountryCode, nextKeyword)}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "采购明细加载失败");
    return data as ListResponse;
  }

  async function loadData(nextPage = page, nextPageSize = pageSizeRef.current, nextCountryCode = appliedCountryCode, nextKeyword = appliedKeyword) {
    const isCurrentRequest = beginRequest();
    setLoading(true);
    try {
      const data = await fetchData(nextPage, nextPageSize, false, nextCountryCode, nextKeyword);
      if (!isCurrentRequest()) return;
      setRows(data.rows ?? []);
      setTotal(Number(data.total ?? 0));
      if (data.page !== nextPage) setPage(data.page);
    } catch (error) {
      if (!isCurrentRequest()) return;
      setRows([]);
      setTotal(0);
      alert(error instanceof Error ? error.message : "采购明细加载失败");
    } finally {
      if (isCurrentRequest()) setLoading(false);
    }
  }

  useEffect(() => {
    void loadData(page, pageSizeRef.current, appliedCountryCode, appliedKeyword);
  }, [appliedCountryCode, appliedKeyword, columnFilters, page, sortField, sortOrder]);

  useEffect(() => {
    void fetchAllEntityRows<Row>("countries").then(setCountries).catch(() => setCountries([]));
  }, []);

  async function exportRows() {
    try {
      const data = await fetchData(1, pageSizeRef.current, true, appliedCountryCode, appliedKeyword);
      exportRowsToXlsx({
        columns: columns.map((column) => ({ ...column, format: (value) => formatValue(value) })),
        rows: data.rows,
        sheetName: "采购明细一览",
        fileName: "采购明细一览.xlsx",
      });
    } catch (error) {
      alert(error instanceof Error ? error.message : "采购明细导出失败");
    }
  }

  async function loadColumnOptions(field: string, optionKeyword: string): Promise<TableFilterOption[]> {
    const params = new URLSearchParams({ field, mode: "purchase" });
    if (optionKeyword.trim()) params.set("keyword", optionKeyword.trim());
    if (appliedCountryCode.trim()) params.set("countryCode", appliedCountryCode.trim());
    for (const [key, values] of Object.entries(columnFilters)) {
      if (key === field) continue;
      for (const value of values) params.append(`filter.${key}`, value);
    }
    const response = await fetch(`/api/purchase/product-lines?${params}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "筛选候选值加载失败");
    return (data.options ?? []) as TableFilterOption[];
  }

  function renderHeader(column: (typeof columns)[number]) {
    return <TableColumnMenu column={column} filterValues={columnFilters[column.key] ?? []} loadOptions={(keyword) => loadColumnOptions(column.key, keyword)} onFilter={(values) => { setColumnFilters((current) => ({ ...current, [column.key]: values })); setPage(1); }} onSort={(order) => { setSortField(order ? column.key : ""); setSortOrder(order); setPage(1); }} sortOrder={sortField === column.key ? sortOrder : ""} />;
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-medium text-[#303133]">采购明细一览</h1>
        <p className="mt-1 text-sm text-[#909399]">按已确认采购订单中的产品实例集中展示实例编码、名称、数量、币种和单价。</p>
      </div>

      <Panel>
        <div className="flex flex-wrap items-center gap-2 border-b border-[#ebeef5] p-4">
          <Input placeholder="搜索PO订单号/需求单号/实例编码/名称" value={keyword} onChange={(event) => setKeyword(event.target.value)} />
          <select className="h-9 min-w-32 rounded border border-[#dcdfe6] bg-white px-3 text-sm outline-none focus:border-[#1890ff]" value={countryCode} onChange={(event) => setCountryCode(event.target.value)}>
            <option value="">全部国家</option>
            {countries
              .map((country) => ({ code: String(country.code ?? "").trim(), nameZh: String(country.nameZh ?? "").trim() }))
              .filter((country) => country.code)
              .sort((left, right) => left.code.localeCompare(right.code))
              .map((country) => <option key={country.code} value={country.code}>{country.nameZh ? `${country.code} - ${country.nameZh}` : country.code}</option>)}
          </select>
          <Button tone="primary" onClick={() => { setAppliedKeyword(keyword); setAppliedCountryCode(countryCode); setPage(1); void loadData(1, pageSizeRef.current, countryCode, keyword); }}>
            <Search size={15} />
            查询
          </Button>
          <Button onClick={() => void loadData()}>
            <RefreshCw size={15} />
            刷新
          </Button>
          <Button tone="warning" onClick={() => void exportRows()}>
            <FileDown size={15} />
            导出 Excel
          </Button>
        </div>

        <StickyTable className="table-scroll overflow-auto" tableKey="purchase-product-lines">
          <table className="min-w-full border-collapse text-sm">
            <thead className="bg-[#f5f7fa] text-[#303133]"><tr>{columns.map((column) => <th className="whitespace-nowrap border-b border-r border-[#ebeef5] px-3 py-3 text-left font-medium" key={column.key}>{renderHeader(column)}</th>)}</tr></thead>
            <tbody>
              {rows.map((row) => <tr className="hover:bg-[#fafafa]" key={String(row.id)}>{columns.map((column) => <td className="whitespace-nowrap border-b border-r border-[#ebeef5] px-3 py-3" key={column.key}>{formatValue(row[column.key])}</td>)}</tr>)}
              {!rows.length ? <tr><td className="py-12 text-center text-[#909399]" colSpan={columns.length}>{loading ? "加载中..." : "暂无数据"}</td></tr> : null}
            </tbody>
          </table>
        </StickyTable>
        <PaginationBar
          page={page}
          pageSize={pageSize}
          total={total}
          onPageChange={(nextPage) => {
            if (skipNextPageChangeRef.current) {
              skipNextPageChangeRef.current = false;
              return;
            }
            setPage(nextPage);
            void loadData(nextPage, pageSizeRef.current);
          }}
          onPageSizeChange={(nextPageSize) => {
            pageSizeRef.current = nextPageSize;
            skipNextPageChangeRef.current = true;
            setPageSize(nextPageSize);
            setPage(1);
            void loadData(1, nextPageSize);
          }}
        />
      </Panel>
    </div>
  );
}

function formatValue(value: unknown, type?: string) {
  return formatDisplayValue(value as string | number | boolean | null | undefined, type);
}
