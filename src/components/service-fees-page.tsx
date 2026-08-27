"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, FileDown, RefreshCw, Search } from "lucide-react";
import { formatDisplayValue } from "@/lib/display-format";
import { DEFAULT_PAGE_SIZE } from "@/lib/pagination";
import { Button, Input, Panel } from "./ui";
import { PaginationBar } from "./pagination-bar";
import { StickyTable } from "./sticky-table";
import { TableColumnMenu, type TableFilterOption, type TableSortOrder } from "./table-column-menu";
import { useRequestGuard } from "@/lib/table-query-client";

type Row = Record<string, string | number | boolean | null>;
type ListResponse = { rows: Row[]; summary: Summary; total: number; page: number; pageSize: number; totalPages: number };

type Summary = {
  billingTotal: number;
  prepaymentTotal: number;
  serviceFeeTotal: number;
  serviceFeeTotalExcludingTax: number;
  instanceServiceFeeTotal: number;
  feeServiceFeeTotal: number;
};

const columns: Array<{ key: string; label: string; type?: string }> = [
  { key: "writeOffMonth", label: "核销月份", type: "date" },
  { key: "countryCode", label: "国家" },
  { key: "vatRate", label: "增值税税率（%）", type: "percentage" },
  { key: "batchName", label: "批次" },
  { key: "requestNo", label: "需求单号" },
  { key: "poNo", label: "PO单号" },
  { key: "deviceCode", label: "实例编码" },
  { key: "requestType", label: "类型" },
  { key: "modelCode", label: "机型" },
  { key: "nameEn", label: "英文名称" },
  { key: "undertakingUnitCode", label: "承接单位" },
  { key: "supplierCode", label: "供应商" },
  { key: "customerCode", label: "客户" },
  { key: "quantity", label: "数量", type: "number" },
  { key: "lineType", label: "明细类型", type: "lineType" },
  { key: "billingCurrency", label: "月账单币种" },
  { key: "billingAmount", label: "月账单总额（含税）", type: "money" },
  { key: "prepaymentCurrency", label: "预付款币种" },
  { key: "prepaymentAmount", label: "预付款核销金额（含税）", type: "money" },
  { key: "serviceFeeAmount", label: "月度服务费（含税）", type: "money" },
  { key: "serviceFeeAmountExcludingTax", label: "月度服务费（未税）", type: "money" },
  { key: "prepaymentContractNos", label: "预付款合同号" },
  { key: "sourceNote", label: "来源说明" },
  { key: "createdAt", label: "创建日期", type: "date" },
  { key: "updatedAt", label: "更新日期", type: "date" },
];
const tableColumns = columns.map((column) => ({ ...column, sortable: true, filterable: true }));

const emptySummary: Summary = {
  billingTotal: 0,
  prepaymentTotal: 0,
  serviceFeeTotal: 0,
  serviceFeeTotalExcludingTax: 0,
  instanceServiceFeeTotal: 0,
  feeServiceFeeTotal: 0,
};

export function ServiceFeesPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [summary, setSummary] = useState<Summary>(emptySummary);
  const [keyword, setKeyword] = useState("");
  const [startMonth, setStartMonth] = useState("");
  const [endMonth, setEndMonth] = useState("");
  const [countryCode, setCountryCode] = useState("");
  const [batchName, setBatchName] = useState("");
  const [lineType, setLineType] = useState("");
  const [requestType, setRequestType] = useState("");
  const [snapshotNo, setSnapshotNo] = useState("");
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [total, setTotal] = useState(0);
  const [sortField, setSortField] = useState("");
  const [sortOrder, setSortOrder] = useState<TableSortOrder>("");
  const [columnFilters, setColumnFilters] = useState<Record<string, string[]>>({});
  const pageSizeRef = useRef(pageSize);
  const skipNextPageChangeRef = useRef(false);
  const beginRequest = useRequestGuard();

  const params = useMemo(() => {
    const next = buildParams({ keyword, startMonth, endMonth, countryCode, batchName, lineType, requestType });
    if (sortField && sortOrder) { next.set("sortField", sortField); next.set("sortOrder", sortOrder); }
    for (const [key, values] of Object.entries(columnFilters)) values.forEach((value) => next.append(`filter.${key}`, value));
    return next;
  }, [
    keyword,
    startMonth,
    endMonth,
    countryCode,
    batchName,
    lineType,
    requestType,
    sortField,
    sortOrder,
    columnFilters,
  ]);

  async function fetchData(nextPage: number, nextPageSize: number, exportAll = false, includeSummary = true): Promise<ListResponse> {
    const requestParams = new URLSearchParams(params);
    requestParams.set("page", String(nextPage));
    requestParams.set("pageSize", String(nextPageSize));
    if (exportAll) requestParams.set("export", "1");
    if (!includeSummary) {
      requestParams.set("includeSummary", "0");
      requestParams.set("knownTotal", String(total));
    }
    const response = await fetch(`/api/service-fees/calculate?${requestParams.toString()}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "服务费数据加载失败");
    return data as ListResponse;
  }

  async function loadData(nextPage = page, nextPageSize = pageSizeRef.current, includeSummary = true) {
    const isCurrentRequest = beginRequest();
    setLoading(true);
    try {
      const data = await fetchData(nextPage, nextPageSize, false, includeSummary);
      if (!isCurrentRequest()) return;
      setRows(data.rows ?? []);
      if (includeSummary) {
        setSummary(data.summary ?? emptySummary);
        setTotal(Number(data.total ?? 0));
      }
      if (data.page !== nextPage) setPage(data.page);
    } catch (error) {
      if (!isCurrentRequest()) return;
      setRows([]);
      setSummary(emptySummary);
      setTotal(0);
      alert(error instanceof Error ? error.message : "服务费数据加载失败");
    } finally {
      if (isCurrentRequest()) setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  async function createStatementDraft() {
    if (!countryCode.trim()) {
      alert("生成服务费对账单前请选择国家");
      return;
    }
    if (!startMonth || !endMonth) {
      alert("请在上方选择起始月份和结束月份");
      return;
    }
    if (startMonth !== endMonth) {
      alert("服务费对账单仅能按单一核销月份生成，请将起始月份与结束月份选为同一个月");
      return;
    }
    setConfirming(true);
    const response = await fetch("/api/service-fees/snapshots", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        snapshotNo: snapshotNo.trim() || undefined,
        filters: { startMonth, endMonth, countryCode: countryCode.trim() },
      }),
    });
    const data = await response.json();
    setConfirming(false);
    if (!response.ok) {
      alert(data.error ?? "服务费对账单草稿生成失败");
      return;
    }
    setSnapshotNo(data.snapshotNo ?? "");
    alert(`已生成服务费对账单草稿：${data.snapshotNo}`);
  }

  async function exportCsv() {
    let exportRows: Row[];
    try {
      const data = await fetchData(1, pageSizeRef.current, true);
      exportRows = data.rows;
    } catch (error) {
      alert(error instanceof Error ? error.message : "服务费导出失败");
      return;
    }
    const header = columns.map((column) => column.label);
    const body = exportRows.map((row) =>
      columns.map((column) => `"${String(formatValue(row[column.key], column.type)).replaceAll('"', '""')}"`).join(","),
    );
    const blob = new Blob([`\uFEFF${[header.join(","), ...body].join("\n")}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "service-fees.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  async function loadColumnOptions(field: string, optionKeyword: string): Promise<TableFilterOption[]> {
    const optionParams = new URLSearchParams({ field });
    if (optionKeyword.trim()) optionParams.set("keyword", optionKeyword.trim());
    if (startMonth) optionParams.set("startMonth", startMonth);
    if (endMonth) optionParams.set("endMonth", endMonth);
    if (countryCode.trim()) optionParams.set("countryCode", countryCode.trim());
    if (batchName.trim()) optionParams.set("batchName", batchName.trim());
    if (lineType.trim()) optionParams.set("lineType", lineType.trim());
    if (requestType.trim()) optionParams.set("requestType", requestType.trim());
    for (const [key, values] of Object.entries(columnFilters)) {
      if (key === field) continue;
      for (const value of values) optionParams.append(`filter.${key}`, value);
    }
    const response = await fetch(`/api/service-fees/calculate?${optionParams}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "筛选候选值加载失败");
    return (data.options ?? []) as TableFilterOption[];
  }

  function renderHeader(column: (typeof tableColumns)[number]) {
    return <TableColumnMenu column={column} filterValues={columnFilters[column.key] ?? []} loadOptions={(keyword) => loadColumnOptions(column.key, keyword)} onFilter={(values) => { setColumnFilters((current) => ({ ...current, [column.key]: values })); setPage(1); }} onSort={(order) => { setSortField(order ? column.key : ""); setSortOrder(order); setPage(1); }} sortOrder={sortField === column.key ? sortOrder : ""} />;
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-medium text-[#303133]">服务费核算</h1>
        <p className="mt-1 text-sm text-[#909399]">按月度月账单核销总额减预付款核销金额生成服务费核算结果，非实例预付款费用的月账单金额按0显示。</p>
      </div>

      <Panel>
        <div className="flex flex-wrap items-center gap-2 border-b border-[#ebeef5] p-4">
          <Input placeholder="国家/批次/需求单/PO/实例编码" value={keyword} onChange={(event) => setKeyword(event.target.value)} />
          <label className="text-xs text-[#606266]">起始月份<Input className="ml-2" type="month" value={startMonth} onChange={(event) => setStartMonth(event.target.value)} /></label>
          <label className="text-xs text-[#606266]">结束月份<Input className="ml-2" type="month" value={endMonth} onChange={(event) => setEndMonth(event.target.value)} /></label>
          <Input placeholder="国家" value={countryCode} onChange={(event) => setCountryCode(event.target.value)} />
          <Input placeholder="批次" value={batchName} onChange={(event) => setBatchName(event.target.value)} />
          <select
            className="h-9 rounded border border-[#dcdfe6] bg-white px-3 text-sm outline-none focus:border-[#1890ff]"
            value={lineType}
            onChange={(event) => setLineType(event.target.value)}
          >
            <option value="">全部类型</option>
            <option value="instance">实例</option>
            <option value="fee">非实例费用</option>
          </select>
          <select
            className="h-9 rounded border border-[#dcdfe6] bg-white px-3 text-sm outline-none focus:border-[#1890ff]"
            value={requestType}
            onChange={(event) => setRequestType(event.target.value)}
          >
            <option value="">全部类型</option>
            <option value="整机">整机</option>
            <option value="备件">备件</option>
          </select>
          <Button tone="primary" onClick={() => { setPage(1); void loadData(1, pageSizeRef.current); }}>
            <Search size={15} />
            查询
          </Button>
          <Button onClick={() => void loadData()}>
            <RefreshCw size={15} />
            刷新
          </Button>
          <Button tone="warning" onClick={() => void exportCsv()}>
            <FileDown size={15} />
            导出
          </Button>
        </div>

        <div className="grid gap-3 border-b border-[#ebeef5] bg-[#fafafa] p-4 md:grid-cols-5">
          <SummaryItem label="月账单合计" value={summary.billingTotal} />
          <SummaryItem label="预付款合计" value={summary.prepaymentTotal} />
          <SummaryItem label="服务费合计" value={summary.serviceFeeTotal} />
          <SummaryItem label="服务费未税合计" value={summary.serviceFeeTotalExcludingTax} />
          <SummaryItem label="实例服务费" value={summary.instanceServiceFeeTotal} />
          <SummaryItem label="非实例费用" value={summary.feeServiceFeeTotal} />
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-[#ebeef5] p-4">
          <Input placeholder="对账单号，不填自动生成" value={snapshotNo} onChange={(event) => setSnapshotNo(event.target.value)} />
          <Button tone="success" disabled={confirming || loading} onClick={() => void createStatementDraft()}>
            <CheckCircle2 size={15} />
            {confirming ? "生成中" : "生成对账单草稿"}
          </Button>
          <span className="text-sm text-[#909399]">请在上方将起始月份与结束月份选为同一个月；对账单将汇总所选国家当月的全部批次。</span>
        </div>

        <StickyTable className="table-scroll overflow-auto" tableKey="service-fees">
          <table className="min-w-full border-collapse text-sm">
            <thead className="bg-[#f5f7fa] text-[#303133]">
              <tr>
                {tableColumns.map((column) => (
                  <th className="whitespace-nowrap border-b border-r border-[#ebeef5] px-3 py-3 text-left font-medium" key={column.key}>
                    {renderHeader(column)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr className="hover:bg-[#fafafa]" key={String(row.id)}>
                  {columns.map((column) => (
                    <td className="whitespace-nowrap border-b border-r border-[#ebeef5] px-3 py-3" key={column.key}>
                      {formatValue(row[column.key], column.type)}
                    </td>
                  ))}
                </tr>
              ))}
              {!rows.length ? (
                <tr>
                  <td className="py-12 text-center text-[#909399]" colSpan={tableColumns.length}>
                    {loading ? "加载中..." : "暂无服务费核算明细"}
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
      void loadData(nextPage, pageSizeRef.current, false);
          }}
          onPageSizeChange={(nextPageSize) => {
            pageSizeRef.current = nextPageSize;
            skipNextPageChangeRef.current = true;
            setPageSize(nextPageSize);
            setPage(1);
            void loadData(1, nextPageSize, false);
          }}
        />
      </Panel>
    </div>
  );
}

function SummaryItem({ label, value }: { label: string; value: number }) {
  return (
    <div className="border border-[#ebeef5] bg-white px-4 py-3">
      <div className="text-xs text-[#909399]">{label}</div>
      <div className="mt-1 text-lg font-medium text-[#303133]">{formatValue(value, "money")}</div>
    </div>
  );
}

function buildParams(values: Record<string, string>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value.trim()) params.set(key, value.trim());
  }
  return params;
}

function formatValue(value: unknown, type?: string) {
  return formatDisplayValue(value as string | number | boolean | null | undefined, type);
}
