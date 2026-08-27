"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { formatDisplayValue } from "@/lib/display-format";
import { DEFAULT_PAGE_SIZE } from "@/lib/pagination";
import { buildDetailRoute, buildListRoute, getCurrentRoute, useListScrollPosition } from "@/lib/client-list-navigation";
import { Button, Input, Panel } from "./ui";
import { PaginationBar } from "./pagination-bar";
import { StickyTable } from "./sticky-table";
import { TableColumnMenu, type TableFilterOption, type TableSortOrder } from "./table-column-menu";

type Row = Record<string, string | number | boolean | null>;

const columns: Array<{ key: string; label: string; type?: string }> = [
  { key: "adjustmentNo", label: "调整单号" },
  { key: "status", label: "状态" },
  { key: "countryCode", label: "国家" },
  { key: "batchName", label: "批次号" },
  { key: "contractNo", label: "预付款合同号" },
  { key: "itemCount", label: "明细数量", type: "number" },
  { key: "differenceTotal", label: "调整差额合计", type: "number" },
  { key: "reason", label: "调整原因" },
  { key: "confirmedAt", label: "确认时间", type: "datetime" },
  { key: "createdAt", label: "创建时间", type: "datetime" },
  { key: "updatedAt", label: "更新时间", type: "datetime" },
];
const tableColumns = columns.map((column) => ({ ...column, sortable: true, filterable: true }));

export function PrepaymentWriteOffAdjustmentsPage() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [rows, setRows] = useState<Row[]>([]);
  const [keyword, setKeyword] = useState(() => searchParams.get("keyword") ?? "");
  const [appliedKeyword, setAppliedKeyword] = useState(() => searchParams.get("keyword") ?? "");
  const [statusTab, setStatusTab] = useState<"draft" | "confirmed">(() =>
    searchParams.get("statusTab") === "confirmed" ? "confirmed" : "draft",
  );
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [total, setTotal] = useState(0);
  const [sortField, setSortField] = useState("");
  const [sortOrder, setSortOrder] = useState<TableSortOrder>("");
  const [columnFilters, setColumnFilters] = useState<Record<string, string[]>>({});
  const pageSizeRef = useRef(pageSize);
  const currentRoute = getCurrentRoute(pathname, searchParams.toString());

  useListScrollPosition(currentRoute, !loading);

  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("statusTab", statusTab);
    if (appliedKeyword.trim()) params.set("keyword", appliedKeyword);
    else params.delete("keyword");
    const nextRoute = buildListRoute(pathname, params);
    if (nextRoute !== currentRoute) router.replace(nextRoute, { scroll: false });
  }, [appliedKeyword, currentRoute, pathname, router, searchParams, statusTab]);

  async function loadData(nextPage = page, nextPageSize = pageSizeRef.current, nextStatusTab = statusTab, nextKeyword = appliedKeyword) {
    setLoading(true);
    const params = new URLSearchParams();
    params.set("page", String(nextPage));
    params.set("pageSize", String(nextPageSize));
    params.set("status", nextStatusTab === "confirmed" ? "已确认" : "草稿");
    if (nextKeyword.trim()) params.set("keyword", nextKeyword.trim());
    if (sortField && sortOrder) { params.set("sortField", sortField); params.set("sortOrder", sortOrder); }
    for (const [key, values] of Object.entries(columnFilters)) values.forEach((value) => params.append(`filter.${key}`, value));
    const response = await fetch(`/api/prepayment-adjustments?${params.toString()}`);
    const data = await response.json();
    setRows(data.rows ?? []);
    setTotal(Number(data.total ?? 0));
    setPage(Number(data.page ?? nextPage));
    setLoading(false);
  }

  useEffect(() => {
    void loadData();
  }, []);

  useEffect(() => {
    if (!Object.keys(columnFilters).length && !sortField && !sortOrder) return;
    void loadData(1);
  }, [columnFilters, sortField, sortOrder]);

  async function loadColumnOptions(field: string, optionKeyword: string): Promise<TableFilterOption[]> {
    const params = new URLSearchParams({ field });
    if (optionKeyword.trim()) params.set("keyword", optionKeyword.trim());
    params.set("status", statusTab === "confirmed" ? "已确认" : "草稿");
    for (const [key, values] of Object.entries(columnFilters)) {
      if (key === field) continue;
      for (const value of values) params.append(`filter.${key}`, value);
    }
    const response = await fetch(`/api/prepayment-adjustments?${params}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "筛选候选值加载失败");
    return (data.options ?? []) as TableFilterOption[];
  }

  function renderHeader(column: (typeof tableColumns)[number]) {
    return <TableColumnMenu column={column} filterValues={columnFilters[column.key] ?? []} loadOptions={(keyword) => loadColumnOptions(column.key, keyword)} onFilter={(values) => { setColumnFilters((current) => ({ ...current, [column.key]: values })); setPage(1); }} onSort={(order) => { setSortField(order ? column.key : ""); setSortOrder(order); setPage(1); }} sortOrder={sortField === column.key ? sortOrder : ""} />;
  }

  async function deleteDraft(adjustmentNo: string) {
    if (!confirm("确认删除该预付款核销调整单草稿？")) return;
    await fetch(`/api/prepayment-adjustments/${encodeURIComponent(adjustmentNo)}`, { method: "DELETE" });
    await loadData();
  }

  async function confirmAdjustment(adjustmentNo: string) {
    if (!confirm("确认后会更新对应月份的预付款月核销金额，是否继续？")) return;
    const response = await fetch(`/api/prepayment-adjustments/${encodeURIComponent(adjustmentNo)}/confirm`, {
      method: "POST",
    });
    const data = await response.json();
    if (!response.ok) {
      alert(data.error ?? "确认失败");
      return;
    }
    await loadData();
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-medium text-[#303133]">预付款核销调整单</h1>
        <p className="mt-1 text-sm text-[#909399]">针对特定批次、实例、月份调整预付款每月核销金额，未选择的月份保持不变。</p>
      </div>

      <Panel>
        <div className="flex items-center gap-2 border-b border-[#ebeef5] bg-[#fafafa] p-3">
          <Button tone={statusTab === "draft" ? "primary" : "default"} onClick={() => { setStatusTab("draft"); setPage(1); void loadData(1, pageSizeRef.current, "draft"); }}>
            草稿
            <span className="ml-1 rounded bg-white/35 px-1.5 text-xs">
              {statusTab === "draft" ? total : ""}
            </span>
          </Button>
          <Button tone={statusTab === "confirmed" ? "primary" : "default"} onClick={() => { setStatusTab("confirmed"); setPage(1); void loadData(1, pageSizeRef.current, "confirmed"); }}>
            已确认
            <span className="ml-1 rounded bg-white/35 px-1.5 text-xs">
              {statusTab === "confirmed" ? total : ""}
            </span>
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-[#ebeef5] p-4">
          <Input placeholder="搜索调整单/合同/批次/原因" value={keyword} onChange={(event) => setKeyword(event.target.value)} />
          <Button tone="primary" onClick={() => { setAppliedKeyword(keyword); setPage(1); void loadData(1, pageSizeRef.current, statusTab, keyword); }}>
            <Search size={15} />
            查询
          </Button>
          <Button onClick={() => void loadData()}>
            <RefreshCw size={15} />
            刷新
          </Button>
          <Link className="ml-auto" href="/finance/prepayment-writeoff-adjustments/new">
            <Button tone="primary">
              <Plus size={15} />
              新建调整单
            </Button>
          </Link>
        </div>

        <StickyTable className="table-scroll overflow-auto" tableKey="prepayment-writeoff-adjustments">
          <table className="min-w-full border-collapse text-sm">
            <thead className="bg-[#f5f7fa] text-[#303133]">
              <tr>
                {tableColumns.map((column) => (
                  <th className="whitespace-nowrap border-b border-r border-[#ebeef5] px-3 py-3 text-left font-medium" key={column.key}>
                    {renderHeader(column)}
                  </th>
                ))}
                <th className="sticky right-0 border-b border-[#ebeef5] bg-[#f5f7fa] px-3 py-3 text-left font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const adjustmentNo = String(row.adjustmentNo ?? "");
                const confirmed = String(row.status ?? "") === "已确认";
                return (
                  <tr className="hover:bg-[#fafafa]" key={adjustmentNo}>
                    {columns.map((column) => (
                      <td className="whitespace-nowrap border-b border-r border-[#ebeef5] px-3 py-3" key={column.key}>
                        {column.key === "adjustmentNo" ? (
                          <Link className="font-medium text-[#1890ff] hover:underline" href={buildDetailRoute(`/finance/prepayment-writeoff-adjustments/${encodeURIComponent(adjustmentNo)}`, currentRoute)}>
                            {adjustmentNo}
                          </Link>
                        ) : (
                          formatValue(row[column.key], column.type)
                        )}
                      </td>
                    ))}
                    <td className="sticky right-0 whitespace-nowrap border-b border-[#ebeef5] bg-white px-3 py-3">
                      <div className="flex items-center gap-2">
                        <Link href={buildDetailRoute(`/finance/prepayment-writeoff-adjustments/${encodeURIComponent(adjustmentNo)}`, currentRoute)}>
                          <Button>{confirmed ? "查看" : "编辑"}</Button>
                        </Link>
                        <Button disabled={confirmed} tone="success" onClick={() => void confirmAdjustment(adjustmentNo)}>
                          <CheckCircle2 size={15} />
                          确认
                        </Button>
                        <Button disabled={confirmed} tone="danger" onClick={() => void deleteDraft(adjustmentNo)}>
                          <Trash2 size={15} />
                          删除
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!rows.length ? (
                <tr>
                  <td className="py-12 text-center text-[#909399]" colSpan={columns.length + 1}>
                    {loading ? "加载中..." : "暂无数据"}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </StickyTable>
        <PaginationBar page={page} pageSize={pageSize} total={total} onPageChange={(next) => { setPage(next); void loadData(next, pageSizeRef.current); }} onPageSizeChange={(next) => { pageSizeRef.current = next; setPageSize(next); setPage(1); void loadData(1, next); }} />
      </Panel>
    </div>
  );
}

function formatValue(value: unknown, type?: string) {
  return formatDisplayValue(value as string | number | boolean | null | undefined, type);
}
