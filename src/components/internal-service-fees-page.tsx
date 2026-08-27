"use client";

import { useEffect, useRef, useState } from "react";
import { Archive, FileDown, RefreshCw, Search, SlidersHorizontal } from "lucide-react";
import { formatDisplayValue } from "@/lib/display-format";
import { DEFAULT_PAGE_SIZE } from "@/lib/pagination";
import { PaginationBar } from "./pagination-bar";
import { StickyTable } from "./sticky-table";
import { TableColumnMenu, type TableFilterOption, type TableSortOrder } from "./table-column-menu";
import { useRequestGuard } from "@/lib/table-query-client";
import { Button, Input, Panel, Textarea } from "./ui";

type Row = Record<string, string | number | boolean | null>;
type ListResponse = { rows: Row[]; total: number; totalAmount: number; page: number; pageSize: number; totalPages: number };

const columns: Array<{ key: string; label: string; type?: string }> = [
  { key: "writeOffMonth", label: "核算月份", type: "date" },
  { key: "countryCode", label: "国家" },
  { key: "undertakingUnitCode", label: "承接单位" },
  { key: "supplierCode", label: "供应商" },
  { key: "customerCode", label: "客户" },
  { key: "batchName", label: "批次" },
  { key: "requestNo", label: "需求单号" },
  { key: "poNo", label: "PO单号" },
  { key: "deviceCode", label: "实例编码" },
  { key: "modelCode", label: "机型" },
  { key: "nameEn", label: "英文名称" },
  { key: "quantity", label: "数量", type: "number" },
  { key: "currency", label: "币种" },
  { key: "internalServiceFeeAmount", label: "内部服务费（未税）", type: "money" },
  { key: "sourceType", label: "计算来源" },
  { key: "adjustmentNo", label: "调整单号" },
  { key: "archived", label: "归档状态" },
  { key: "createdAt", label: "创建日期", type: "date" },
  { key: "updatedAt", label: "更新日期", type: "date" },
];
const tableColumns = columns.map((column) => ({ ...column, sortable: true, filterable: true }));

export function InternalServiceFeesPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [countryCode, setCountryCode] = useState("");
  const [batchName, setBatchName] = useState("");
  const [startMonth, setStartMonth] = useState("");
  const [endMonth, setEndMonth] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [total, setTotal] = useState(0);
  const [totalAmount, setTotalAmount] = useState(0);
  const [sortField, setSortField] = useState("");
  const [sortOrder, setSortOrder] = useState<TableSortOrder>("");
  const [columnFilters, setColumnFilters] = useState<Record<string, string[]>>({});
  const pageSizeRef = useRef(pageSize);
  const skipNextPageChangeRef = useRef(false);
  const beginRequest = useRequestGuard();
  const [adjustingRow, setAdjustingRow] = useState<Row | null>(null);
  const [adjustmentStart, setAdjustmentStart] = useState("");
  const [adjustmentEnd, setAdjustmentEnd] = useState("");
  const [adjustmentAmount, setAdjustmentAmount] = useState("");
  const [adjustmentReason, setAdjustmentReason] = useState("");
  const [archiveMonth, setArchiveMonth] = useState("");

  function buildParams(nextPage: number, nextPageSize: number, exportAll = false) {
    const params = new URLSearchParams();
    if (keyword.trim()) params.set("keyword", keyword.trim());
    if (countryCode.trim()) params.set("countryCode", countryCode.trim());
    if (batchName.trim()) params.set("batchName", batchName.trim());
    if (startMonth) params.set("startMonth", startMonth);
    if (endMonth) params.set("endMonth", endMonth);
    params.set("page", String(nextPage));
    params.set("pageSize", String(nextPageSize));
    if (sortField && sortOrder) { params.set("sortField", sortField); params.set("sortOrder", sortOrder); }
    for (const [key, values] of Object.entries(columnFilters)) values.forEach((value) => params.append(`filter.${key}`, value));
    if (exportAll) params.set("export", "1");
    return params;
  }

  async function fetchData(nextPage: number, nextPageSize: number, exportAll = false): Promise<ListResponse> {
    const response = await fetch(`/api/internal-service-fees?${buildParams(nextPage, nextPageSize, exportAll)}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "内部服务费加载失败");
    return data as ListResponse;
  }

  async function loadData(nextPage = page, nextPageSize = pageSizeRef.current) {
    const isCurrentRequest = beginRequest();
    setLoading(true);
    try {
      const data = await fetchData(nextPage, nextPageSize);
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
      alert(error instanceof Error ? error.message : "内部服务费加载失败");
    } finally {
      if (isCurrentRequest()) setLoading(false);
    }
  }

  useEffect(() => { void loadData(); }, []);

  useEffect(() => {
    if (!Object.keys(columnFilters).length && !sortField && !sortOrder) return;
    void loadData(1);
  }, [columnFilters, sortField, sortOrder]);

  async function loadColumnOptions(field: string, optionKeyword: string): Promise<TableFilterOption[]> {
    const params = new URLSearchParams({ field });
    if (optionKeyword.trim()) params.set("keyword", optionKeyword.trim());
    for (const [key, values] of Object.entries(columnFilters)) {
      if (key === field) continue;
      for (const value of values) params.append(`filter.${key}`, value);
    }
    const response = await fetch(`/api/internal-service-fees?${params}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "筛选候选值加载失败");
    return (data.options ?? []) as TableFilterOption[];
  }

  function renderHeader(column: (typeof tableColumns)[number]) {
    return <TableColumnMenu column={column} filterValues={columnFilters[column.key] ?? []} loadOptions={(keyword) => loadColumnOptions(column.key, keyword)} onFilter={(values) => { setColumnFilters((current) => ({ ...current, [column.key]: values })); setPage(1); }} onSort={(order) => { setSortField(order ? column.key : ""); setSortOrder(order); setPage(1); }} sortOrder={sortField === column.key ? sortOrder : ""} />;
  }

  async function syncLedgers() {
    if (!confirm("将根据月账单台账、采购成本和已确认调整单生成或重算未归档内部服务费，是否继续？")) return;
    const response = await fetch("/api/internal-service-fees", { method: "POST" });
    const data = await response.json();
    if (!response.ok) return alert(data.error ?? "生成失败");
    await loadData();
    alert(`已同步 ${data.count ?? 0} 条内部服务费台账`);
  }

  async function saveAdjustment() {
    if (!adjustingRow) return;
    const response = await fetch("/api/internal-service-fees/adjustments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ledgerId: adjustingRow.ledgerId,
        startMonth: adjustmentStart,
        endMonth: adjustmentEnd,
        monthlyAmount: Number(adjustmentAmount),
        reason: adjustmentReason,
      }),
    });
    const data = await response.json();
    if (!response.ok) return alert(data.error ?? "保存调整失败");
    setAdjustingRow(null);
    await loadData();
  }

  async function cancelAdjustment(adjustmentNo: string) {
    if (!confirm(`确认撤销内部服务费调整单 ${adjustmentNo} 吗？系统将重新分摊所有未归档月份。`)) return;
    const response = await fetch(`/api/internal-service-fees/adjustments/${encodeURIComponent(adjustmentNo)}`, { method: "DELETE" });
    const data = await response.json();
    if (!response.ok) return alert(data.error ?? "撤销调整失败");
    await loadData();
  }

  async function archiveSelectedMonth() {
    if (!archiveMonth) return alert("请选择归档月份");
    if (!confirm(`确认归档 ${archiveMonth.slice(0, 7)} 的内部服务费吗？归档后该月金额不可再自动修改。`)) return;
    const response = await fetch("/api/internal-service-fees/archive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ countryCode, archiveMonth }),
    });
    const data = await response.json();
    if (!response.ok) return alert(data.error ?? "归档失败");
    await loadData();
    alert(`已生成归档快照：${data.snapshotNo}`);
  }

  async function exportCsv() {
    let exportRows: Row[];
    try {
      const data = await fetchData(1, pageSizeRef.current, true);
      exportRows = data.rows;
    } catch (error) {
      alert(error instanceof Error ? error.message : "内部服务费导出失败");
      return;
    }
    const content = [columns.map((column) => column.label).join(","), ...exportRows.map((row) => columns.map((column) => `"${String(formatValue(row[column.key], column.type)).replaceAll('"', '""')}"`).join(","))].join("\n");
    const url = URL.createObjectURL(new Blob([`\uFEFF${content}`], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "internal-service-fees.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-medium text-[#303133]">内部服务费分摊</h1>
        <p className="mt-1 text-sm text-[#909399]">独立按合同未税收入减设备采购总成本计算，不影响月账单、预付款及实际服务费核算。</p>
      </div>
      <Panel>
        <div className="flex flex-wrap items-center gap-2 border-b border-[#ebeef5] p-4">
          <Input placeholder="搜索需求单、PO、实例编码或英文名称" value={keyword} onChange={(event) => setKeyword(event.target.value)} />
          <Input placeholder="国家" value={countryCode} onChange={(event) => setCountryCode(event.target.value)} />
          <Input placeholder="批次" value={batchName} onChange={(event) => setBatchName(event.target.value)} />
          <Input type="date" value={startMonth} onChange={(event) => setStartMonth(event.target.value)} />
          <Input type="date" value={endMonth} onChange={(event) => setEndMonth(event.target.value)} />
          <Button tone="primary" onClick={() => { setPage(1); void loadData(1, pageSizeRef.current); }}><Search size={15} />查询</Button>
          <Button onClick={() => void loadData()}><RefreshCw size={15} />刷新</Button>
          <Button tone="success" onClick={() => void syncLedgers()}><RefreshCw size={15} />生成/重算未归档</Button>
          <Button className="ml-auto" tone="warning" onClick={() => void exportCsv()}><FileDown size={15} />导出</Button>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-b border-[#ebeef5] bg-[#fafafa] px-4 py-3 text-sm text-[#606266]">
          <span>当前筛选 {total} 条，内部服务费合计 {formatValue(totalAmount, "money")}</span>
          <Input className="ml-auto min-w-[150px]" type="month" value={archiveMonth} onChange={(event) => setArchiveMonth(event.target.value)} />
          <Button onClick={() => void archiveSelectedMonth()}><Archive size={15} />归档当月</Button>
        </div>
        <StickyTable className="table-scroll overflow-auto" tableKey="internal-service-fees">
          <table className="w-full min-w-[1840px] border-collapse text-sm">
            <thead className="bg-[#f5f7fa] text-[#303133]"><tr>{tableColumns.map((column) => <th className="whitespace-nowrap border-b border-r border-[#ebeef5] px-3 py-3 text-left font-medium" key={column.key}>{renderHeader(column)}</th>)}<th className="sticky right-0 z-10 w-[236px] min-w-[236px] border-b border-[#ebeef5] bg-[#f5f7fa] px-3 py-3 text-left font-medium">操作</th></tr></thead>
            <tbody>
              {rows.map((row) => <tr className="hover:bg-[#fafafa]" key={String(row.id)}>{tableColumns.map((column) => <td className="whitespace-nowrap border-b border-r border-[#ebeef5] px-3 py-3" key={column.key}>{formatValue(row[column.key], column.type)}</td>)}<td className="sticky right-0 z-10 w-[236px] min-w-[236px] whitespace-nowrap border-b border-[#ebeef5] bg-white px-3 py-3"><div className="flex flex-nowrap items-center gap-2"><Button className="shrink-0 whitespace-nowrap" disabled={Boolean(row.archived)} onClick={() => { setAdjustingRow(row); setAdjustmentStart(String(row.writeOffMonth ?? "")); setAdjustmentEnd(String(row.writeOffMonth ?? "")); setAdjustmentAmount(String(row.internalServiceFeeAmount ?? "")); setAdjustmentReason(""); }}><SlidersHorizontal size={15} />区间调整</Button>{String(row.adjustmentNo ?? "") && !Boolean(row.archived) ? <Button className="shrink-0 whitespace-nowrap" tone="danger" onClick={() => void cancelAdjustment(String(row.adjustmentNo))}>撤销调整</Button> : null}</div></td></tr>)}
              {!rows.length && <tr><td className="py-12 text-center text-[#909399]" colSpan={columns.length + 1}>{loading ? "加载中..." : "暂无内部服务费明细，请先生成月账单台账后点击生成"}</td></tr>}
            </tbody>
          </table>
        </StickyTable>
        <PaginationBar page={page} pageSize={pageSize} total={total} onPageChange={(nextPage) => { if (skipNextPageChangeRef.current) { skipNextPageChangeRef.current = false; return; } setPage(nextPage); void loadData(nextPage, pageSizeRef.current); }} onPageSizeChange={(nextPageSize) => { pageSizeRef.current = nextPageSize; skipNextPageChangeRef.current = true; setPageSize(nextPageSize); setPage(1); void loadData(1, nextPageSize); }} />
      </Panel>
      {adjustingRow && <Panel className="fixed inset-x-0 bottom-5 z-50 mx-auto w-[min(720px,calc(100vw-32px))] shadow-xl">
        <div className="border-b border-[#ebeef5] px-4 py-3 font-medium text-[#303133]">内部服务费区间调整：{String(adjustingRow.deviceCode ?? "")}</div>
        <div className="grid gap-3 p-4 sm:grid-cols-2"><Input type="month" value={adjustmentStart} onChange={(event) => setAdjustmentStart(event.target.value)} /><Input type="month" value={adjustmentEnd} onChange={(event) => setAdjustmentEnd(event.target.value)} /><Input type="number" step="0.01" placeholder="每月内部服务费（未税）" value={adjustmentAmount} onChange={(event) => setAdjustmentAmount(event.target.value)} /><Textarea className="min-h-9" placeholder="调整原因" value={adjustmentReason} onChange={(event) => setAdjustmentReason(event.target.value)} /></div>
        <div className="flex justify-end gap-2 border-t border-[#ebeef5] p-3"><Button onClick={() => setAdjustingRow(null)}>取消</Button><Button tone="primary" onClick={() => void saveAdjustment()}>确认调整并重算剩余月份</Button></div>
      </Panel>}
    </div>
  );
}

function formatValue(value: unknown, type?: string) {
  if (type === "sourceType") return value === "manual" ? "人工区间调整" : "自动分摊";
  if (type === "archived") return value ? "已归档" : "未归档";
  return formatDisplayValue(value as string | number | boolean | null | undefined, type);
}
