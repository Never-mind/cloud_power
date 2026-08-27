"use client";

import { useEffect, useRef, useState } from "react";
import { CheckSquare, RefreshCw, Search } from "lucide-react";
import { formatDisplayValue } from "@/lib/display-format";
import { DEFAULT_PAGE_SIZE } from "@/lib/pagination";
import { fetchTableFilterOptions } from "@/lib/table-query-client";
import { PaginationBar } from "./pagination-bar";
import { StickyTable } from "./sticky-table";
import { TableColumnMenu, type TableSortOrder } from "./table-column-menu";
import { useRequestGuard } from "@/lib/table-query-client";
import { Button, Input, Panel } from "./ui";

type Row = Record<string, string | number | boolean | null>;

const columns = [
  ["countryCode", "国家"],
  ["undertakingUnitCode", "承接单位"],
  ["supplierCode", "供应商"],
  ["customerCode", "客户"],
  ["batchName", "批次"],
  ["requestNo", "需求单号"],
  ["poNo", "PO单号"],
  ["deviceCode", "实例编码"],
  ["modelCode", "机型"],
  ["nameEn", "英文名称"],
  ["quantity", "数量", "number"],
  ["currency", "币种"],
  ["revenueExcludingTax", "合同收入（未税）", "money"],
  ["procurementCost", "采购总成本", "money"],
  ["expectedInternalServiceFee", "预计内部服务费", "money"],
] as const;

export function InternalServiceFeeAvailablePage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [total, setTotal] = useState(0);
  const pageSizeRef = useRef(pageSize);
  const [sortField, setSortField] = useState("");
  const [sortOrder, setSortOrder] = useState<TableSortOrder>("");
  const [columnFilters, setColumnFilters] = useState<Record<string, string[]>>({});
  const beginRequest = useRequestGuard();

  async function loadRows(nextPage = page, nextPageSize = pageSizeRef.current, queryState = { sortField, sortOrder, columnFilters }) {
    const isCurrentRequest = beginRequest();
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(nextPage), pageSize: String(nextPageSize) });
      if (keyword.trim()) params.set("keyword", keyword.trim());
      if (queryState.sortField && queryState.sortOrder) { params.set("sortField", queryState.sortField); params.set("sortOrder", queryState.sortOrder); }
      for (const [field, values] of Object.entries(queryState.columnFilters)) for (const value of values) params.append(`filter.${field}`, value);
      const response = await fetch(`/api/internal-service-fees/available?${params}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "待初始化清单加载失败");
      if (!isCurrentRequest()) return;
      setRows(data.rows ?? []);
      setTotal(Number(data.total ?? 0));
      setPage(Number(data.page ?? nextPage));
    } catch (error) {
      if (!isCurrentRequest()) return;
      alert(error instanceof Error ? error.message : "待初始化清单加载失败");
    } finally {
      if (isCurrentRequest()) setLoading(false);
    }
  }

  function refreshTableQuery(next: { sortField?: string; sortOrder?: TableSortOrder; columnFilters?: Record<string, string[]> }) {
    const nextState = { sortField: next.sortField ?? sortField, sortOrder: next.sortOrder ?? sortOrder, columnFilters: next.columnFilters ?? columnFilters };
    setSortField(nextState.sortField); setSortOrder(nextState.sortOrder); setColumnFilters(nextState.columnFilters); setPage(1); void loadRows(1, pageSizeRef.current, nextState);
  }

  useEffect(() => {
    void loadRows();
  }, []);

  const currentPageIds = rows.map((row) => String(row.ledgerId));
  const allSelected = currentPageIds.length > 0 && currentPageIds.every((id) => selected.includes(id));

  function toggleCurrentPageSelection() {
    setSelected((current) =>
      allSelected
        ? current.filter((id) => !currentPageIds.includes(id))
        : Array.from(new Set([...current, ...currentPageIds])),
    );
  }

  function toggleRow(id: string) {
    setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  async function initialize(ledgerIds?: string[]) {
    const targets = ledgerIds ?? selected;
    if (!targets.length) {
      alert("请至少勾选一条待初始化实例");
      return;
    }
    if (!confirm(`确认初始化 ${targets.length} 条内部服务费台账吗？`)) return;
    const response = await fetch("/api/internal-service-fees", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ledgerIds: targets }),
    });
    const data = await response.json();
    if (!response.ok) {
      alert(data.error ?? "初始化失败");
      return;
    }
    setSelected((current) => current.filter((id) => !targets.includes(id)));
    await loadRows();
    alert(`已初始化 ${data.count ?? 0} 条内部服务费台账`);
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-medium text-[#303133]">待初始化内部服务费实例</h1>
        <p className="mt-1 text-sm text-[#909399]">展示已有月账单台账但尚未生成内部服务费的实例，确认后自动建立 60 个月内部服务费计划。</p>
      </div>
      <Panel>
        <div className="flex flex-wrap items-center gap-2 border-b border-[#ebeef5] p-4">
          <Input placeholder="搜索批次、需求单、PO或实例编码" value={keyword} onChange={(event) => setKeyword(event.target.value)} />
          <Button tone="primary" onClick={() => { setPage(1); void loadRows(1, pageSizeRef.current); }}><Search size={15} />查询</Button>
          <Button onClick={() => void loadRows()}><RefreshCw size={15} />刷新</Button>
          <Button tone="success" onClick={() => void initialize()}><CheckSquare size={15} />初始化已选（{selected.length}）</Button>
          <Button tone="primary" onClick={() => void initialize(currentPageIds)}>初始化本页（{rows.length}）</Button>
        </div>
        <StickyTable className="table-scroll overflow-auto" tableKey="internal-service-fee-available">
          <table className="w-full min-w-[1560px] border-collapse text-sm">
            <thead className="bg-[#f5f7fa] text-[#303133]">
              <tr>
                <th className="w-12 border-b border-r border-[#ebeef5] px-3 py-3"><input type="checkbox" checked={allSelected} onChange={toggleCurrentPageSelection} /></th>
                {columns.map(([key, label]) => <th className="whitespace-nowrap border-b border-r border-[#ebeef5] px-3 py-3 text-left font-medium" key={key}>
                  <TableColumnMenu
                    column={{ key, label, sortable: true, filterable: true }}
                    sortOrder={sortField === key ? sortOrder : ""}
                    filterValues={columnFilters[key] ?? []}
                    loadOptions={(keyword) => fetchTableFilterOptions("/api/internal-service-fees/available", key, keyword, {}, columnFilters)}
                    onSort={(order) => refreshTableQuery({ sortField: order ? key : "", sortOrder: order })}
                    onFilter={(values) => refreshTableQuery({ columnFilters: { ...columnFilters, [key]: values } })}
                  />
                </th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const id = String(row.ledgerId);
                return <tr className="hover:bg-[#fafafa]" key={id}>
                  <td className="border-b border-r border-[#ebeef5] px-3 py-3"><input type="checkbox" checked={selected.includes(id)} onChange={() => toggleRow(id)} /></td>
                  {columns.map(([key, , type]) => <td className="whitespace-nowrap border-b border-r border-[#ebeef5] px-3 py-3" key={key}>{formatDisplayValue(row[key], type)}</td>)}
                </tr>;
              })}
              {!rows.length && <tr><td className="py-12 text-center text-[#909399]" colSpan={columns.length + 1}>{loading ? "加载中..." : "暂无待初始化实例"}</td></tr>}
            </tbody>
          </table>
        </StickyTable>
        <PaginationBar
          page={page}
          pageSize={pageSize}
          total={total}
          onPageChange={(next) => { setPage(next); void loadRows(next, pageSizeRef.current); }}
          onPageSizeChange={(next) => { pageSizeRef.current = next; setPageSize(next); setPage(1); void loadRows(1, next); }}
        />
      </Panel>
    </div>
  );
}
