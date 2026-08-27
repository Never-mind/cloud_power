"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { FileDown, RefreshCw, Search } from "lucide-react";
import { formatDisplayValue } from "@/lib/display-format";
import { DEFAULT_PAGE_SIZE } from "@/lib/pagination";
import { PaginationBar } from "./pagination-bar";
import { StickyTable } from "./sticky-table";
import { TableColumnMenu, type TableFilterOption, type TableSortOrder } from "./table-column-menu";
import { useRequestGuard } from "@/lib/table-query-client";
import { buildDetailRoute, buildListRoute, getCurrentRoute, getPositiveNumber, useListScrollPosition } from "@/lib/client-list-navigation";
import { Button, Input, Panel } from "./ui";

type Row = Record<string, string | number | boolean | null>;
type ListResponse = { rows: Row[]; total: number; totalAmount: number; page: number; pageSize: number; totalPages: number };

const columns: Array<{ key: string; label: string; type?: string }> = [
  { key: "writeOffMonth", label: "核销月份", type: "date" },
  { key: "countryCode", label: "国家" },
  { key: "batchName", label: "批次号" },
  { key: "requestNo", label: "需求单号" },
  { key: "poNo", label: "PO单号" },
  { key: "deviceCode", label: "实例编码" },
  { key: "requestType", label: "类型" },
  { key: "modelCode", label: "机型" },
  { key: "nameEn", label: "英文名称" },
  { key: "quantity", label: "数量" },
  { key: "instanceContractNo", label: "实例合同号" },
  { key: "currency", label: "币种" },
  { key: "monthlyAmount", label: "月账单实例价格（含税）", type: "money" },
  { key: "monthlyTotalAmount", label: "月账单金额（含税）", type: "money" },
  { key: "stage", label: "阶段" },
  { key: "sourceType", label: "来源" },
  { key: "adjustmentNo", label: "调整单号" },
  { key: "createdAt", label: "创建日期", type: "date" },
  { key: "updatedAt", label: "更新日期", type: "date" },
];

const displayColumns = columns.flatMap((column) =>
  column.key === "countryCode"
    ? [column, { key: "undertakingUnitCode", label: "承接单位" }, { key: "supplierCode", label: "供应商" }]
    : [column],
).map((column) => ({ ...column, sortable: true, filterable: true }));

export function MonthlyBillingWriteOffsPage() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [rows, setRows] = useState<Row[]>([]);
  const [keyword, setKeyword] = useState(() => searchParams.get("keyword") ?? "");
  const [countryCode, setCountryCode] = useState(() => searchParams.get("countryCode") ?? "");
  const [batchName, setBatchName] = useState(() => searchParams.get("batchName") ?? "");
  const [startMonth, setStartMonth] = useState(() => searchParams.get("startMonth") ?? "");
  const [endMonth, setEndMonth] = useState(() => searchParams.get("endMonth") ?? "");
  const [requestType, setRequestType] = useState(() => searchParams.get("requestType") ?? "");
  const [appliedFilters, setAppliedFilters] = useState(() => ({ keyword, countryCode, batchName, startMonth, endMonth, requestType }));
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(() => getPositiveNumber(searchParams.get("page"), 1));
  const [pageSize, setPageSize] = useState(() => getPositiveNumber(searchParams.get("pageSize"), DEFAULT_PAGE_SIZE));
  const [total, setTotal] = useState(0);
  const [totalAmount, setTotalAmount] = useState(0);
  const [sortField, setSortField] = useState(() => searchParams.get("sortField") ?? "");
  const [sortOrder, setSortOrder] = useState<TableSortOrder>(() => {
    const value = searchParams.get("sortOrder");
    return value === "asc" || value === "desc" ? value : "";
  });
  const [columnFilters, setColumnFilters] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(displayColumns.map((column) => [column.key, searchParams.getAll(`filter.${column.key}`)])),
  );
  const pageSizeRef = useRef(pageSize);
  const skipNextPageChangeRef = useRef(false);
  const beginRequest = useRequestGuard();
  const currentRoute = getCurrentRoute(pathname, searchParams.toString());

  useListScrollPosition(currentRoute, !loading);

  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(appliedFilters)) {
      if (value.trim()) params.set(key, value);
      else params.delete(key);
    }
    params.set("page", String(page));
    params.set("pageSize", String(pageSize));
    if (sortField && sortOrder) { params.set("sortField", sortField); params.set("sortOrder", sortOrder); }
    else { params.delete("sortField"); params.delete("sortOrder"); }
    for (const [key, values] of Object.entries(columnFilters)) {
      params.delete(`filter.${key}`);
      values.forEach((value) => params.append(`filter.${key}`, value));
    }
    const nextRoute = buildListRoute(pathname, params);
    if (nextRoute !== currentRoute) router.replace(nextRoute, { scroll: false });
  }, [appliedFilters, columnFilters, currentRoute, page, pageSize, pathname, router, searchParams, sortField, sortOrder]);

  function buildRequestParams(nextPage: number, nextPageSize: number, exportAll = false, filters = appliedFilters) {
    const params = new URLSearchParams();
    if (filters.keyword.trim()) params.set("keyword", filters.keyword.trim());
    if (filters.countryCode.trim()) params.set("countryCode", filters.countryCode.trim());
    if (filters.batchName.trim()) params.set("batchName", filters.batchName.trim());
    if (filters.requestType.trim()) params.set("requestType", filters.requestType.trim());
    if (filters.startMonth) params.set("startMonth", filters.startMonth);
    if (filters.endMonth) params.set("endMonth", filters.endMonth);
    params.set("page", String(nextPage));
    params.set("pageSize", String(nextPageSize));
    if (sortField && sortOrder) { params.set("sortField", sortField); params.set("sortOrder", sortOrder); }
    for (const [key, values] of Object.entries(columnFilters)) values.forEach((value) => params.append(`filter.${key}`, value));
    if (exportAll) params.set("export", "1");
    return params;
  }

  async function loadColumnOptions(field: string, optionKeyword: string): Promise<TableFilterOption[]> {
    const params = new URLSearchParams({ field });
    if (optionKeyword.trim()) params.set("keyword", optionKeyword.trim());
    for (const [key, values] of Object.entries(columnFilters)) {
      if (key === field) continue;
      for (const value of values) params.append(`filter.${key}`, value);
    }
    const response = await fetch(`/api/billing/monthly-writeoffs?${params}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "筛选候选值加载失败");
    return (data.options ?? []) as TableFilterOption[];
  }

  function renderHeader(column: (typeof displayColumns)[number]) {
    return <TableColumnMenu column={column} filterValues={columnFilters[column.key] ?? []} loadOptions={(keyword) => loadColumnOptions(column.key, keyword)} onFilter={(values) => { setColumnFilters((current) => ({ ...current, [column.key]: values })); setPage(1); }} onSort={(order) => { setSortField(order ? column.key : ""); setSortOrder(order); setPage(1); }} sortOrder={sortField === column.key ? sortOrder : ""} />;
  }

  async function fetchData(nextPage: number, nextPageSize: number, exportAll = false, filters = appliedFilters): Promise<ListResponse> {
    const response = await fetch(`/api/billing/monthly-writeoffs?${buildRequestParams(nextPage, nextPageSize, exportAll, filters).toString()}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "月账单明细加载失败");
    return data as ListResponse;
  }

  async function loadData(nextPage = page, nextPageSize = pageSizeRef.current, filters = appliedFilters) {
    const isCurrentRequest = beginRequest();
    setLoading(true);
    try {
      const data = await fetchData(nextPage, nextPageSize, false, filters);
      if (!isCurrentRequest()) return;
      setRows(data.rows ?? []);
      setTotal(Number(data.total ?? 0));
      setTotalAmount(Number(data.totalAmount ?? 0));
      if (data.page !== nextPage) setPage(data.page);
    } catch (error) {
      if (!isCurrentRequest()) return;
      setRows([]);
      setTotal(0);
      setTotalAmount(0);
      alert(error instanceof Error ? error.message : "月账单明细加载失败");
    } finally {
      if (isCurrentRequest()) setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  async function exportCsv() {
    let exportRows: Row[];
    try {
      const data = await fetchData(1, pageSizeRef.current, true, appliedFilters);
      exportRows = data.rows ?? [];
    } catch (error) {
      alert(error instanceof Error ? error.message : "月账单明细导出失败");
      return;
    }
    const header = displayColumns.map((column) => column.label);
    const body = exportRows.map((row) =>
      displayColumns.map((column) => `"${String(formatValue(row[column.key], column.type)).replaceAll('"', '""')}"`).join(","),
    );
    const blob = new Blob([`\uFEFF${[header.join(","), ...body].join("\n")}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "monthly-billing-writeoffs.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-medium text-[#303133]">月账单每月明细</h1>
        <p className="mt-1 text-sm text-[#909399]">查看实例月账单生成的60个月核销明细和调整单影响。</p>
      </div>
      <Panel>
        <div className="flex flex-wrap items-center gap-2 border-b border-[#ebeef5] p-4">
          <Input placeholder="搜索国家/批次/需求单/PO/实例编码/合同号" value={keyword} onChange={(event) => setKeyword(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { const filters = { keyword, countryCode, batchName, startMonth, endMonth, requestType }; setAppliedFilters(filters); setPage(1); void loadData(1, pageSizeRef.current, filters); } }} />
          <Input placeholder="国家" value={countryCode} onChange={(event) => setCountryCode(event.target.value)} />
          <Input placeholder="批次" value={batchName} onChange={(event) => setBatchName(event.target.value)} />
          <Input type="date" value={startMonth} onChange={(event) => setStartMonth(event.target.value)} />
          <Input type="date" value={endMonth} onChange={(event) => setEndMonth(event.target.value)} />
          <select className="h-9 rounded border border-[#dcdfe6] bg-white px-3 text-sm" value={requestType} onChange={(event) => setRequestType(event.target.value)}>
            <option value="">全部类型</option>
            <option value="整机">整机</option>
            <option value="备件">备件</option>
          </select>
          <Button tone="primary" onClick={() => { const filters = { keyword, countryCode, batchName, startMonth, endMonth, requestType }; setAppliedFilters(filters); setPage(1); void loadData(1, pageSizeRef.current, filters); }}>
            <Search size={15} />
            查询
          </Button>
          <Button onClick={() => void loadData()}>
            <RefreshCw size={15} />
            刷新
          </Button>
          <Button className="ml-auto" tone="warning" onClick={() => void exportCsv()}>
            <FileDown size={15} />
            导出
          </Button>
        </div>
        <div className="border-b border-[#ebeef5] bg-[#fafafa] px-4 py-3 text-sm text-[#606266]">
          当前筛选共 {total} 条，月账单核销总金额合计 {formatValue(totalAmount, "money")}
        </div>
        <StickyTable className="table-scroll overflow-auto" tableKey="monthly-billing-writeoffs">
          <table className="min-w-full border-collapse text-sm">
            <thead className="bg-[#f5f7fa] text-[#303133]">
              <tr>
                {displayColumns.map((column) => (
                  <th className="whitespace-nowrap border-b border-r border-[#ebeef5] px-3 py-3 text-left font-medium" key={column.key}>
                    {renderHeader(column)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr className="hover:bg-[#fafafa]" key={String(row.id)}>
                  {displayColumns.map((column) => (
                    <td className="whitespace-nowrap border-b border-r border-[#ebeef5] px-3 py-3" key={column.key}>
                      {renderLinkedValue(row, column, currentRoute)}
                    </td>
                  ))}
                </tr>
              ))}
              {!rows.length ? (
                <tr>
                  <td className="py-12 text-center text-[#909399]" colSpan={displayColumns.length}>
                    {loading ? "加载中..." : "暂无月账单核销明细"}
                  </td>
                </tr>
              ) : null}
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

function renderLinkedValue(row: Row, column: { key: string; type?: string }, returnTo: string) {
  const value = formatValue(row[column.key], column.type);
  if (column.key === "requestNo" && row.requestNo) {
    return <Link className="font-medium text-[#1890ff] hover:underline" href={buildDetailRoute(`/requests/orders/${encodeURIComponent(String(row.requestNo))}`, returnTo)}>{value}</Link>;
  }
  if (column.key === "poNo" && row.purchaseOrderId) {
    return <Link className="font-medium text-[#1890ff] hover:underline" href={buildDetailRoute(`/purchase/orders/${encodeURIComponent(String(row.purchaseOrderId))}`, returnTo)}>{value}</Link>;
  }
  return value;
}

function formatValue(value: unknown, type?: string) {
  return formatDisplayValue(value as string | number | boolean | null | undefined, type);
}
