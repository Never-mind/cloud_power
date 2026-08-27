"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Download, RefreshCw, Search, Trash2 } from "lucide-react";
import { formatDisplayValue } from "@/lib/display-format";
import { DEFAULT_PAGE_SIZE } from "@/lib/pagination";
import { postWorkspaceMessage } from "@/lib/tab-workspace";
import { Button, Input, Panel } from "./ui";
import { PaginationBar } from "./pagination-bar";
import { StickyTable } from "./sticky-table";
import { TableColumnMenu, type TableFilterOption, type TableSortOrder } from "./table-column-menu";
import { WorkspaceNavigationDialog } from "./workspace-navigation-dialog";

type Row = Record<string, string | number | boolean | null>;
type SnapshotListResponse = { rows: Row[]; total: number; page: number; pageSize: number; totalPages: number };

const snapshotColumns: Array<{ key: string; label: string; type?: string }> = [
  { key: "snapshotNo", label: "对账单号" },
  { key: "status", label: "状态" },
  { key: "countryCode", label: "国家" },
  { key: "startDate", label: "起始日期", type: "date" },
  { key: "endDate", label: "终止日期", type: "date" },
  { key: "currencySummary", label: "币种汇总" },
  { key: "totalQuantity", label: "总数量", type: "number" },
  { key: "totalAmount", label: "总金额", type: "number" },
  { key: "itemCount", label: "明细数量", type: "number" },
  { key: "createdAt", label: "创建时间", type: "date" },
  { key: "updatedAt", label: "更新时间", type: "date" },
  { key: "confirmedAt", label: "确认时间", type: "date" },
];

const previewColumns: Array<{ key: string; label: string; type?: string }> = [
  { key: "instanceContractNo", label: "实例合同号" },
  { key: "productType", label: "实例名称" },
  { key: "unitPriceVatExcluded", label: "不含税单价", type: "number" },
  { key: "vatRate", label: "税率", type: "number" },
  { key: "unitPriceVatIncluded", label: "含税单价", type: "number" },
  { key: "quantity", label: "数量", type: "number" },
  { key: "amount", label: "金额", type: "number" },
  { key: "currency", label: "币种" },
];
const tableColumns = snapshotColumns.map((column) => ({ ...column, sortable: true, filterable: true }));

export function BillingStatementsPage() {
  const [snapshots, setSnapshots] = useState<Row[]>([]);
  const [previewRows, setPreviewRows] = useState<Row[]>([]);
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState("");
  const [countryCode, setCountryCode] = useState("BR");
  const [currency, setCurrency] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [snapshotNo, setSnapshotNo] = useState("");
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [total, setTotal] = useState(0);
  const [navigationPrompt, setNavigationPrompt] = useState<{ route: string; detail: string } | null>(null);
  const [sortField, setSortField] = useState("");
  const [sortOrder, setSortOrder] = useState<TableSortOrder>("");
  const [columnFilters, setColumnFilters] = useState<Record<string, string[]>>({});
  const pageSizeRef = useRef(pageSize);
  const skipNextPageChangeRef = useRef(false);

  async function loadSnapshots(nextPage = page, nextPageSize = pageSizeRef.current) {
    setLoading(true);
    const params = new URLSearchParams();
    if (keyword.trim()) params.set("keyword", keyword.trim());
    if (status) params.set("status", status);
    if (sortField && sortOrder) { params.set("sortField", sortField); params.set("sortOrder", sortOrder); }
    for (const [key, values] of Object.entries(columnFilters)) values.forEach((value) => params.append(`filter.${key}`, value));
    params.set("page", String(nextPage));
    params.set("pageSize", String(nextPageSize));
    try {
      const response = await fetch(`/api/billing-statements?${params.toString()}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "月账单对账单加载失败");
      const result = data as SnapshotListResponse;
      setSnapshots(result.rows ?? []);
      setTotal(Number(result.total ?? 0));
      if (result.page !== nextPage) setPage(result.page);
    } catch (error) {
      setSnapshots([]);
      setTotal(0);
      alert(error instanceof Error ? error.message : "月账单对账单加载失败");
    } finally {
      setLoading(false);
    }
  }

  async function preview() {
    const params = buildStatementParams({ countryCode, currency, startDate, endDate });
    const response = await fetch(`/api/billing-statements?mode=preview&${params.toString()}`);
    const data = await response.json();
    if (!response.ok) {
      alert(data.error ?? "预览失败");
      return;
    }
    setPreviewRows(data.rows ?? []);
  }

  async function createSnapshot() {
    setCreating(true);
    const response = await fetch("/api/billing-statements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ snapshotNo: snapshotNo.trim(), countryCode, currency, startDate, endDate }),
    });
    const data = await response.json();
    setCreating(false);
    if (!response.ok) {
      alert(data.error ?? "生成对账单草稿失败");
      return;
    }
    setSnapshotNo(data.snapshotNo ?? "");
    setPreviewRows(data.rows ?? []);
    await loadSnapshots();
    alert(`已生成月账单对账单草稿：${data.snapshotNo}`);
  }

  async function changeSnapshot(snapshotNo: string, action: "confirm" | "delete") {
    const message = action === "confirm"
      ? "确认该月账单对账单？确认后不能删除或退回。"
      : "确认删除该未确认月账单对账单？其快照明细也会同时删除。";
    if (!confirm(message)) return;
    const response = await fetch(
      `/api/billing-statements/${encodeURIComponent(snapshotNo)}${action === "confirm" ? "/confirm" : ""}`,
      { method: action === "confirm" ? "POST" : "DELETE" },
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      alert(data.error ?? (action === "confirm" ? "确认失败" : "删除失败"));
      return;
    }
    await loadSnapshots();
    if (action === "confirm") {
      setNavigationPrompt({
        route: `/finance/billing-statements/${encodeURIComponent(snapshotNo)}`,
        detail: `对账单号：${snapshotNo}`,
      });
    }
  }

  useEffect(() => {
    void loadSnapshots();
  }, []);

  useEffect(() => {
    if (!Object.keys(columnFilters).length && !sortField && !sortOrder) return;
    void loadSnapshots(1);
  }, [columnFilters, sortField, sortOrder]);

  async function loadColumnOptions(field: string, optionKeyword: string): Promise<TableFilterOption[]> {
    const params = new URLSearchParams({ field });
    if (optionKeyword.trim()) params.set("keyword", optionKeyword.trim());
    for (const [key, values] of Object.entries(columnFilters)) {
      if (key === field) continue;
      for (const value of values) params.append(`filter.${key}`, value);
    }
    const response = await fetch(`/api/billing-statements?${params}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "筛选候选值加载失败");
    return (data.options ?? []) as TableFilterOption[];
  }

  function renderHeader(column: (typeof tableColumns)[number]) {
    return <TableColumnMenu column={column} filterValues={columnFilters[column.key] ?? []} loadOptions={(keyword) => loadColumnOptions(column.key, keyword)} onFilter={(values) => { setColumnFilters((current) => ({ ...current, [column.key]: values })); setPage(1); }} onSort={(order) => { setSortField(order ? column.key : ""); setSortOrder(order); setPage(1); }} sortOrder={sortField === column.key ? sortOrder : ""} />;
  }

  const previewSummary = useMemo(
    () =>
      previewRows.reduce<{ totalQuantity: number; totalAmount: number }>(
        (summary, row) => ({
          totalQuantity: summary.totalQuantity + Number(row.quantity ?? 0),
          totalAmount: summary.totalAmount + Number(row.amount ?? 0),
        }),
        { totalQuantity: 0, totalAmount: 0 },
      ),
    [previewRows],
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-medium text-[#303133]">月账单对账单</h1>
        <p className="mt-1 text-sm text-[#909399]">按国家和期间生成月账单对账单草稿，确认后冻结且不受后续月账单调整影响。</p>
      </div>

      <Panel>
        <div className="grid gap-4 border-b border-[#ebeef5] p-4 md:grid-cols-6">
          <label>
            <span className="mb-1 block text-sm font-medium text-[#606266]">国家</span>
            <select className="h-9 w-full rounded border border-[#dcdfe6] bg-white px-3 text-sm outline-none focus:border-[#1890ff]" value={countryCode} onChange={(event) => setCountryCode(event.target.value)}>
              <option value="BR">BR</option>
              <option value="CL">CL</option>
              <option value="MX">MX</option>
            </select>
          </label>
          <label>
            <span className="mb-1 block text-sm font-medium text-[#606266]">币种</span>
            <select className="h-9 w-full rounded border border-[#dcdfe6] bg-white px-3 text-sm outline-none focus:border-[#1890ff]" value={currency} onChange={(event) => setCurrency(event.target.value)}>
              <option value="">全部</option>
              <option value="CNY">CNY</option>
              <option value="USD">USD</option>
              <option value="MXN">MXN</option>
              <option value="CLP">CLP</option>
              <option value="BRL">BRL</option>
            </select>
          </label>
          <label>
            <span className="mb-1 block text-sm font-medium text-[#606266]">起始日期</span>
            <Input className="w-full" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
          </label>
          <label>
            <span className="mb-1 block text-sm font-medium text-[#606266]">终止日期</span>
            <Input className="w-full" type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
          </label>
          <label className="md:col-span-2">
            <span className="mb-1 block text-sm font-medium text-[#606266]">对账单号</span>
            <Input className="w-full" placeholder="不填自动生成" value={snapshotNo} onChange={(event) => setSnapshotNo(event.target.value)} />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-b border-[#ebeef5] p-4">
          <Button onClick={() => void preview()}>
            <Search size={15} />
            预览
          </Button>
          <Button disabled={creating} tone="success" onClick={() => void createSnapshot()}>
            <CheckCircle2 size={15} />
            {creating ? "生成中" : "生成对账单草稿"}
          </Button>
          <span className="text-sm text-[#909399]">
            预览 {previewRows.length} 条，数量 {formatValue(previewSummary.totalQuantity, "number")}，金额 {formatValue(previewSummary.totalAmount, "number")}
          </span>
        </div>
        <div className="table-scroll max-h-[360px] overflow-auto">
          <table className="min-w-full border-collapse text-sm">
            <thead className="bg-[#f5f7fa] text-[#303133]">
              <tr>
                {previewColumns.map((column) => (
                  <th className="whitespace-nowrap border-b border-r border-[#ebeef5] px-3 py-3 text-left font-medium" key={column.key}>
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {previewRows.map((row, index) => (
                <tr className="hover:bg-[#fafafa]" key={`${row.instanceContractNo}-${row.productType}-${index}`}>
                  {previewColumns.map((column) => (
                    <td className="whitespace-nowrap border-b border-r border-[#ebeef5] px-3 py-3" key={column.key}>
                      {formatValue(row[column.key], column.type)}
                    </td>
                  ))}
                </tr>
              ))}
              {!previewRows.length ? (
                <tr>
                  <td className="py-10 text-center text-[#909399]" colSpan={previewColumns.length}>
                    请选择条件后预览或生成快照
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel>
        <div className="flex flex-wrap items-center gap-2 border-b border-[#ebeef5] p-4">
          <Input placeholder="搜索对账单号/国家/币种" value={keyword} onChange={(event) => setKeyword(event.target.value)} />
          <select className="h-9 min-w-28 rounded border border-[#dcdfe6] bg-white px-3 text-sm" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">全部状态</option>
            <option value="未确认">未确认</option>
            <option value="已确认">已确认</option>
          </select>
          <Button tone="primary" onClick={() => void loadSnapshots()}>
            <Search size={15} />
            查询
          </Button>
          <Button onClick={() => void loadSnapshots()}>
            <RefreshCw size={15} />
            刷新
          </Button>
        </div>
        <StickyTable className="table-scroll overflow-auto" tableKey="billing-statements">
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
              {snapshots.map((row) => {
                const snapshot = String(row.snapshotNo ?? "");
                const confirmed = row.status === "已确认";
                return (
                  <tr className="hover:bg-[#fafafa]" key={snapshot}>
                    {snapshotColumns.map((column) => (
                      <td className="whitespace-nowrap border-b border-r border-[#ebeef5] px-3 py-3" key={column.key}>
                        {column.key === "snapshotNo" ? (
                          <button
                            className="font-medium text-[#1890ff] hover:underline"
                            onClick={() => postWorkspaceMessage({
                              type: "cloud-power:open-tab",
                              route: `/finance/billing-statements/${encodeURIComponent(snapshot)}`,
                              title: "月账单对账单明细",
                            })}
                            title="在新标签查看对账单明细"
                            type="button"
                          >
                            {snapshot}
                          </button>
                        ) : formatValue(row[column.key], column.type)}
                      </td>
                    ))}
                    <td className="sticky right-0 whitespace-nowrap border-b border-[#ebeef5] bg-white px-3 py-3">
                      <div className="flex items-center gap-2">
                        {!confirmed ? <Button tone="success" onClick={() => void changeSnapshot(snapshot, "confirm")}><CheckCircle2 size={15} />确认</Button> : null}
                        {!confirmed ? <Button tone="danger" onClick={() => void changeSnapshot(snapshot, "delete")}><Trash2 size={15} />删除</Button> : null}
                        <a href={`/api/billing-statements/${encodeURIComponent(snapshot)}/export`}>
                          <Button tone="warning"><Download size={15} />导出 Excel</Button>
                        </a>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!snapshots.length ? (
                <tr>
                  <td className="py-12 text-center text-[#909399]" colSpan={snapshotColumns.length + 1}>
                    {loading ? "加载中..." : "暂无月账单对账单"}
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
            void loadSnapshots(nextPage, pageSizeRef.current);
          }}
          onPageSizeChange={(nextPageSize) => {
            pageSizeRef.current = nextPageSize;
            skipNextPageChangeRef.current = true;
            setPageSize(nextPageSize);
            setPage(1);
            void loadSnapshots(1, nextPageSize);
          }}
        />
      </Panel>
      {navigationPrompt ? (
        <WorkspaceNavigationDialog
          title="月账单对账单已确认"
          message="月账单对账单已确认，是否打开对应的对账单明细？"
          detail={navigationPrompt.detail}
          onStay={() => setNavigationPrompt(null)}
          onOpen={() => {
            const target = navigationPrompt;
            setNavigationPrompt(null);
            postWorkspaceMessage({ type: "cloud-power:open-tab", route: target.route, title: "月账单对账单明细" });
          }}
        />
      ) : null}
    </div>
  );
}

function buildStatementParams(values: Record<string, string>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value.trim()) params.set(key, value.trim());
  }
  return params;
}

function formatValue(value: unknown, type?: string) {
  return formatDisplayValue(value as string | number | boolean | null | undefined, type);
}
