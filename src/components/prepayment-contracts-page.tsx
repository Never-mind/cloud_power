"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Plus, RefreshCw, Search, Trash2, X } from "lucide-react";
import { formatDisplayValue } from "@/lib/display-format";
import { DEFAULT_PAGE_SIZE } from "@/lib/pagination";
import { buildDetailRoute, buildListRoute, getCurrentRoute, useListScrollPosition } from "@/lib/client-list-navigation";
import { Button, Input, Panel } from "./ui";
import { PaginationBar } from "./pagination-bar";
import { StickyTable } from "./sticky-table";
import { TableColumnMenu, type TableFilterOption, type TableSortOrder } from "./table-column-menu";

type Row = Record<string, string | number | boolean | null>;

const columns: Array<{ key: string; label: string; type?: string }> = [
  { key: "contractNo", label: "预付款合同号" },
  { key: "status", label: "状态" },
  { key: "currency", label: "币种" },
  { key: "effectiveDate", label: "生效日期", type: "date" },
  { key: "totalAmount", label: "合同总金额", type: "money" },
  { key: "confirmedAt", label: "确认时间", type: "datetime" },
  { key: "createdAt", label: "创建时间", type: "datetime" },
  { key: "updatedAt", label: "更新时间", type: "datetime" },
] .map((column) => ({ ...column, sortable: true, filterable: true }));

export function PrepaymentContractsPage() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [rows, setRows] = useState<Row[]>([]);
  const [keyword, setKeyword] = useState(() => searchParams.get("keyword") ?? "");
  const [appliedKeyword, setAppliedKeyword] = useState(() => searchParams.get("keyword") ?? "");
  const [statusTab, setStatusTab] = useState<"draft" | "confirmed">(() => searchParams.get("statusTab") === "confirmed" ? "confirmed" : "draft");
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [total, setTotal] = useState(0);
  const [sortField, setSortField] = useState("");
  const [sortOrder, setSortOrder] = useState<TableSortOrder>("");
  const [columnFilters, setColumnFilters] = useState<Record<string, string[]>>({});
  const [showCreate, setShowCreate] = useState(false);
  const [newContractNo, setNewContractNo] = useState("");
  const [newEffectiveDate, setNewEffectiveDate] = useState("");
  const [newCurrency, setNewCurrency] = useState("USD");
  const [creating, setCreating] = useState(false);
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
    try {
      const params = new URLSearchParams({ page: String(nextPage), pageSize: String(nextPageSize), status: nextStatusTab === "confirmed" ? "已确认" : "草稿" });
      if (nextKeyword.trim()) params.set("keyword", nextKeyword.trim());
      if (sortField && sortOrder) { params.set("sortField", sortField); params.set("sortOrder", sortOrder); }
      for (const [key, values] of Object.entries(columnFilters)) values.forEach((value) => params.append(`filter.${key}`, value));
      const response = await fetch(`/api/entities/prepayment-contracts?${params}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "合同加载失败");
      setRows(data.rows ?? []);
      setTotal(Number(data.total ?? 0));
      setPage(Number(data.page ?? nextPage));
    } catch (error) {
      setRows([]);
      setTotal(0);
      alert(error instanceof Error ? error.message : "合同加载失败");
    } finally {
      setLoading(false);
    }
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
    const response = await fetch(`/api/entities/prepayment-contracts/filter-options?${params}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "筛选候选值加载失败");
    return (data.options ?? []) as TableFilterOption[];
  }

  function renderHeader(column: (typeof columns)[number]) {
    return <TableColumnMenu column={column} filterValues={columnFilters[column.key] ?? []} loadOptions={(keyword) => loadColumnOptions(column.key, keyword)} onFilter={(values) => { setColumnFilters((current) => ({ ...current, [column.key]: values })); setPage(1); }} onSort={(order) => { setSortField(order ? column.key : ""); setSortOrder(order); setPage(1); }} sortOrder={sortField === column.key ? sortOrder : ""} />;
  }

  async function deleteDraft(contractNo: string) {
    if (!confirm("确认删除该预付款合同草稿？删除后已占用实例会释放回待生成列表。")) return;
    await fetch(`/api/prepayments/contracts/${encodeURIComponent(contractNo)}`, { method: "DELETE" });
    await loadData();
  }

  function openCreateDialog() {
    const today = new Date().toISOString().slice(0, 10);
    setNewContractNo(`PPC-${today.replaceAll("-", "")}`);
    setNewEffectiveDate(today);
    setNewCurrency("USD");
    setShowCreate(true);
  }

  async function createBlankDraft() {
    if (!newContractNo.trim()) {
      alert("预付款合同号不能为空");
      return;
    }
    if (!newEffectiveDate) {
      alert("合同生效日期不能为空");
      return;
    }
    setCreating(true);
    try {
      const response = await fetch("/api/prepayments/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contractNo: newContractNo.trim(),
          effectiveDate: newEffectiveDate,
          currency: newCurrency,
          purchaseOrderItemIds: [],
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "预付款合同草稿创建失败");
      setShowCreate(false);
      router.push(`/finance/prepayment-contracts/${encodeURIComponent(String(data.contractNo))}`);
    } catch (error) {
      alert(error instanceof Error ? error.message : "预付款合同草稿创建失败");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-medium text-[#303133]">预付款合同</h1>
        <p className="mt-1 text-sm text-[#909399]">管理预付款合同草稿和已确认合同，草稿删除后会释放对应实例。</p>
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
          <Input placeholder="搜索合同号/状态/币种" value={keyword} onChange={(event) => setKeyword(event.target.value)} />
          <Button tone="primary" onClick={() => { setAppliedKeyword(keyword); setPage(1); void loadData(1, pageSizeRef.current, statusTab, keyword); }}>
            <Search size={15} />
            查询
          </Button>
          <Button onClick={() => void loadData(page, pageSizeRef.current)}>
            <RefreshCw size={15} />
            刷新
          </Button>
          <Button className="ml-auto" onClick={openCreateDialog}>
            <Plus size={15} />
            新建空白合同
          </Button>
          <Link href="/finance/prepayment-available">
            <Button tone="primary">去生成预付款草稿</Button>
          </Link>
        </div>

        <StickyTable className="table-scroll overflow-auto" tableKey="prepayment-contracts">
          <table className="min-w-full border-collapse text-sm">
            <thead className="bg-[#f5f7fa] text-[#303133]">
              <tr>
                {columns.map((column) => (
                  <th className="whitespace-nowrap border-b border-r border-[#ebeef5] px-3 py-3 text-left font-medium" key={column.key}>
                    {renderHeader(column)}
                  </th>
                ))}
                <th className="sticky right-0 border-b border-[#ebeef5] bg-[#f5f7fa] px-3 py-3 text-left font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const contractNo = String(row.contractNo ?? "");
                const confirmed = String(row.status ?? "") === "已确认";
                return (
                  <tr className="hover:bg-[#fafafa]" key={contractNo}>
                    {columns.map((column) => (
                      <td className="whitespace-nowrap border-b border-r border-[#ebeef5] px-3 py-3" key={column.key}>
                        {column.key === "contractNo" ? (
                          <Link className="font-medium text-[#1890ff] hover:underline" href={buildDetailRoute(`/finance/prepayment-contracts/${encodeURIComponent(contractNo)}`, currentRoute)}>
                            {contractNo}
                          </Link>
                        ) : (
                          formatValue(row[column.key], column.type)
                        )}
                      </td>
                    ))}
                    <td className="sticky right-0 whitespace-nowrap border-b border-[#ebeef5] bg-white px-3 py-3">
                      <div className="flex items-center gap-2">
                        <Link href={buildDetailRoute(`/finance/prepayment-contracts/${encodeURIComponent(contractNo)}`, currentRoute)}>
                          <Button>{confirmed ? "查看" : "编辑"}</Button>
                        </Link>
                        <Button disabled={confirmed} tone="danger" onClick={() => void deleteDraft(contractNo)}>
                          <Trash2 size={15} />
                          删除草稿
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
      {showCreate ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4">
          <div className="w-full max-w-xl border border-[#dcdfe6] bg-white shadow-xl">
            <div className="flex items-center border-b border-[#ebeef5] px-5 py-4">
              <div>
                <h2 className="font-medium text-[#303133]">新建空白预付款合同</h2>
                <p className="mt-1 text-xs text-[#909399]">适用于没有实例、仅登记费用明细的预付款合同。</p>
              </div>
              <button className="ml-auto text-[#909399] hover:text-[#303133]" onClick={() => setShowCreate(false)} type="button">
                <X size={18} />
              </button>
            </div>
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <label className="sm:col-span-2">
                <span className="mb-1 block text-sm text-[#606266]">预付款合同号</span>
                <Input className="w-full" value={newContractNo} onChange={(event) => setNewContractNo(event.target.value)} />
              </label>
              <label>
                <span className="mb-1 block text-sm text-[#606266]">合同币种</span>
                <select className="h-9 w-full rounded border border-[#dcdfe6] bg-white px-3 text-sm" value={newCurrency} onChange={(event) => setNewCurrency(event.target.value)}>
                  {["CNY", "MXN", "CLP", "USD", "BRL"].map((currency) => <option key={currency} value={currency}>{currency}</option>)}
                </select>
              </label>
              <label>
                <span className="mb-1 block text-sm text-[#606266]">生效日期</span>
                <Input className="w-full" type="date" value={newEffectiveDate} onChange={(event) => setNewEffectiveDate(event.target.value)} />
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t border-[#ebeef5] px-5 py-4">
              <Button disabled={creating} onClick={() => setShowCreate(false)}>取消</Button>
              <Button disabled={creating} tone="primary" onClick={() => void createBlankDraft()}>{creating ? "创建中" : "创建并进入明细"}</Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function formatValue(value: unknown, type?: string) {
  return formatDisplayValue(value as string | number | boolean | null | undefined, type);
}
