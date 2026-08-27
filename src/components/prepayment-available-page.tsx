"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FilePlus2, RefreshCw, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { formatDateInputValue, formatDisplayValue } from "@/lib/display-format";
import { fetchAllEntityRows } from "@/lib/client-entity-fetch";
import { DEFAULT_PAGE_SIZE } from "@/lib/pagination";
import { fetchTableFilterOptions } from "@/lib/table-query-client";
import { PaginationBar } from "./pagination-bar";
import { StickyTable } from "./sticky-table";
import { TableColumnMenu, type TableSortOrder } from "./table-column-menu";
import { useRequestGuard } from "@/lib/table-query-client";
import { Button, Input, Panel } from "./ui";

type Row = {
  id: string;
  countryCode: string;
  batchName: string;
  requestNo: string;
  poNo: string;
  deviceCode: string;
  requestType: string;
  modelCode: string;
  nameEn: string;
  quantity: number;
  currency: string;
  actualUnitPrice: number;
  actualTotalAmount: number;
};

type Country = {
  code: string;
  nameZh: string;
};

const columns = [
  { key: "countryCode", label: "国家" },
  { key: "batchName", label: "批次号" },
  { key: "requestNo", label: "需求单号" },
  { key: "poNo", label: "PO单号" },
  { key: "deviceCode", label: "实例编码" },
  { key: "requestType", label: "类型" },
  { key: "modelCode", label: "机型" },
  { key: "nameEn", label: "英文名称" },
  { key: "quantity", label: "数量" },
  { key: "currency", label: "币种" },
  { key: "actualUnitPrice", label: "实际单价" },
  { key: "actualTotalAmount", label: "实际总价" },
] as const;

export function PrepaymentAvailablePage() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedRowsById, setSelectedRowsById] = useState<Record<string, Row>>({});
  const [keyword, setKeyword] = useState("");
  const [countryCode, setCountryCode] = useState("");
  const [requestType, setRequestType] = useState("");
  const [appliedKeyword, setAppliedKeyword] = useState("");
  const [appliedCountryCode, setAppliedCountryCode] = useState("");
  const [appliedRequestType, setAppliedRequestType] = useState("");
  const [countries, setCountries] = useState<Country[]>([]);
  const [contractNo, setContractNo] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [total, setTotal] = useState(0);
  const pageSizeRef = useRef(pageSize);
  const [sortField, setSortField] = useState("");
  const [sortOrder, setSortOrder] = useState<TableSortOrder>("");
  const [columnFilters, setColumnFilters] = useState<Record<string, string[]>>({});
  const beginRequest = useRequestGuard();

  useEffect(() => {
    const today = formatDateInputValue(new Date());
    setContractNo((current) => current || `PPC-${today.replaceAll("-", "")}`);
    setEffectiveDate((current) => current || today);
    void fetchAllEntityRows<Country>("countries").then(setCountries).catch(() => setCountries([]));
  }, []);

  async function loadData(
    nextPage = page,
    nextPageSize = pageSizeRef.current,
    nextKeyword = appliedKeyword,
    nextCountryCode = appliedCountryCode,
    nextRequestType = appliedRequestType,
    queryState = { sortField, sortOrder, columnFilters },
  ) {
    const isCurrentRequest = beginRequest();
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(nextPage), pageSize: String(nextPageSize) });
      if (nextKeyword.trim()) params.set("keyword", nextKeyword.trim());
      if (nextCountryCode.trim()) params.set("countryCode", nextCountryCode.trim());
      if (nextRequestType.trim()) params.set("requestType", nextRequestType.trim());
      if (queryState.sortField && queryState.sortOrder) {
        params.set("sortField", queryState.sortField);
        params.set("sortOrder", queryState.sortOrder);
      }
      for (const [field, values] of Object.entries(queryState.columnFilters)) {
        for (const value of values) params.append(`filter.${field}`, value);
      }
      const response = await fetch(`/api/prepayments/available?${params}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "待生成预付款实例加载失败");
      if (!isCurrentRequest()) return;
      setRows(data.rows ?? []);
      setTotal(Number(data.total ?? 0));
      setPage(Number(data.page ?? nextPage));
      setSelectedRowsById((current) => {
        const next = { ...current };
        for (const row of data.rows ?? []) if (selectedIds.includes(row.id)) next[row.id] = row;
        return next;
      });
    } catch (error) {
      if (!isCurrentRequest()) return;
      alert(error instanceof Error ? error.message : "待生成预付款实例加载失败");
    } finally {
      if (isCurrentRequest()) setLoading(false);
    }
  }

  function refreshTableQuery(next: { sortField?: string; sortOrder?: TableSortOrder; columnFilters?: Record<string, string[]> }) {
    const queryState = {
      sortField: next.sortField ?? sortField,
      sortOrder: next.sortOrder ?? sortOrder,
      columnFilters: next.columnFilters ?? columnFilters,
    };
    setSortField(queryState.sortField);
    setSortOrder(queryState.sortOrder);
    setColumnFilters(queryState.columnFilters);
    setPage(1);
    void loadData(1, pageSizeRef.current, appliedKeyword, appliedCountryCode, appliedRequestType, queryState);
  }

  useEffect(() => {
    void loadData();
  }, []);

  const selectedRows = useMemo(
    () => Object.values(selectedRowsById),
    [selectedRowsById],
  );
  const summary = useMemo(
    () => ({
      selectedRows: selectedRows.length,
      totalQuantity: selectedRows.reduce((total, row) => total + Number(row.quantity ?? 0), 0),
      actualTotalAmount: roundMoney(selectedRows.reduce((total, row) => total + Number(row.actualTotalAmount ?? 0), 0)),
    }),
    [selectedRows],
  );
  const allVisibleSelected = rows.length > 0 && rows.every((row) => selectedIds.includes(row.id));

  function toggleSelected(row: Row) {
    const id = row.id;
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
    setSelectedRowsById((current) => {
      if (current[id]) { const { [id]: _removed, ...next } = current; return next; }
      return { ...current, [id]: row };
    });
  }

  function toggleAllVisible() {
    const visibleIds = rows.map((row) => row.id);
    setSelectedIds((current) => {
      if (visibleIds.every((id) => current.includes(id))) {
        return current.filter((id) => !visibleIds.includes(id));
      }
      return Array.from(new Set([...current, ...visibleIds]));
    });
    setSelectedRowsById((current) => {
      if (visibleIds.every((id) => current[id])) {
        const next = { ...current };
        for (const id of visibleIds) delete next[id];
        return next;
      }
      return Object.assign({}, current, Object.fromEntries(rows.map((row) => [row.id, row])));
    });
  }

  async function createDraft() {
    setCreating(true);
    const response = await fetch("/api/prepayments/drafts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contractNo, effectiveDate, purchaseOrderItemIds: selectedIds }),
    });
    const data = await response.json();
    setCreating(false);
    if (response.ok) {
      router.push(`/finance/prepayment-contracts/${encodeURIComponent(String(data.contractNo))}`);
    } else {
      alert(data.error ?? "生成失败");
    }
  }

  return (
    <div className="space-y-5 pb-24">
      <div>
        <h1 className="text-xl font-medium text-[#303133]">待生成预付款实例</h1>
        <p className="mt-1 text-sm text-[#909399]">
          仅展示已确认采购、且需求单已下单、尚未被预付款草稿或合同占用的实例。
        </p>
      </div>

      <Panel>
        <div className="flex flex-wrap items-center gap-2 border-b border-[#ebeef5] p-4">
          <Input
            placeholder="搜索批次/需求单/PO/实例编码/机型"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
          <select
            className="h-9 min-w-32 rounded border border-[#dcdfe6] bg-white px-3 text-sm outline-none focus:border-[#1890ff]"
            value={countryCode}
            onChange={(event) => setCountryCode(event.target.value)}
          >
            <option value="">全部国家</option>
            {countries
              .filter((country) => country.code)
              .sort((left, right) => left.code.localeCompare(right.code))
              .map((country) => (
                <option key={country.code} value={country.code}>
                  {country.nameZh ? `${country.code} - ${country.nameZh}` : country.code}
                </option>
              ))}
          </select>
          <select
            className="h-9 min-w-28 rounded border border-[#dcdfe6] bg-white px-3 text-sm outline-none focus:border-[#1890ff]"
            value={requestType}
            onChange={(event) => setRequestType(event.target.value)}
          >
            <option value="">全部类型</option>
            <option value="整机">整机</option>
            <option value="备件">备件</option>
          </select>
          <Button
            tone="primary"
            onClick={() => {
              setAppliedKeyword(keyword);
              setAppliedCountryCode(countryCode);
              setAppliedRequestType(requestType);
              setPage(1);
              void loadData(1, pageSizeRef.current, keyword, countryCode, requestType);
            }}
          >
            <Search size={15} />
            查询
          </Button>
          <Button onClick={() => void loadData(page, pageSizeRef.current)}>
            <RefreshCw size={15} />
            刷新
          </Button>
          <div className="ml-auto flex max-w-[520px] flex-wrap items-end gap-3">
            <label className="min-w-[220px] flex-1">
              <span className="mb-1 block text-xs font-medium text-[#606266]">预付款合同号</span>
          <Input
            className="w-full"
            placeholder="预付款合同号"
            value={contractNo}
            onChange={(event) => setContractNo(event.target.value)}
          />
            </label>
            <label className="min-w-[160px]">
              <span className="mb-1 block text-xs font-medium text-[#606266]">合同生效日期</span>
          <Input
            type="date"
            value={effectiveDate}
            onChange={(event) => setEffectiveDate(event.target.value)}
          />
            </label>
            <p className="w-full text-xs text-[#909399]">
              勾选实例后，系统会按这里填写的合同号和生效日期生成预付款合同草稿。
            </p>
          </div>
        </div>

        <StickyTable className="table-scroll overflow-auto" tableKey="prepayment-available">
          <table className="min-w-full border-collapse text-sm">
            <thead className="bg-[#f5f7fa] text-[#303133]">
              <tr>
                <th className="w-12 border-b border-r border-[#ebeef5] px-3 py-3 text-left">
                  <input checked={allVisibleSelected} type="checkbox" onChange={toggleAllVisible} />
                </th>
                {columns.map((column) => (
                  <th className="whitespace-nowrap border-b border-r border-[#ebeef5] px-3 py-3 text-left font-medium" key={column.key}>
                    <TableColumnMenu
                      column={{ key: column.key, label: column.label, sortable: true, filterable: true }}
                      sortOrder={sortField === column.key ? sortOrder : ""}
                      filterValues={columnFilters[column.key] ?? []}
                      loadOptions={(keyword) => fetchTableFilterOptions("/api/prepayments/available", column.key, keyword, {}, columnFilters)}
                      onSort={(order) => refreshTableQuery({ sortField: order ? column.key : "", sortOrder: order })}
                      onFilter={(values) => refreshTableQuery({ columnFilters: { ...columnFilters, [column.key]: values } })}
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr className="hover:bg-[#fafafa]" key={row.id}>
                  <td className="border-b border-r border-[#ebeef5] px-3 py-3">
                    <input checked={selectedIds.includes(row.id)} type="checkbox" onChange={() => toggleSelected(row)} />
                  </td>
                  {columns.map((column) => (
                    <td className="whitespace-nowrap border-b border-r border-[#ebeef5] px-3 py-3" key={column.key}>
                      {formatValue(row[column.key])}
                    </td>
                  ))}
                </tr>
              ))}
              {!rows.length ? (
                <tr>
                  <td className="py-12 text-center text-[#909399]" colSpan={columns.length + 1}>
                    {loading ? "加载中..." : "暂无可生成预付款合同的实例"}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </StickyTable>
        <PaginationBar page={page} pageSize={pageSize} total={total} onPageChange={(next) => { setPage(next); void loadData(next, pageSizeRef.current); }} onPageSizeChange={(next) => { pageSizeRef.current = next; setPageSize(next); setPage(1); void loadData(1, next); }} />
      </Panel>

      {selectedIds.length ? (
        <div className="fixed bottom-5 left-[230px] right-5 z-20 border border-[#1890ff] bg-white p-4 shadow-lg">
          <div className="flex flex-wrap items-center gap-5 text-sm text-[#606266]">
            <span>已选实例：<b className="text-[#303133]">{summary.selectedRows}</b></span>
            <span>已选数量：<b className="text-[#303133]">{summary.totalQuantity}</b></span>
            <span>实际总价：<b className="text-[#303133]">{formatValue(summary.actualTotalAmount, "money")}</b></span>
            <span>预付款合同总价金额：<b className="text-[#303133]">{formatValue(summary.actualTotalAmount, "money")}</b></span>
            <Button className="ml-auto" disabled={creating || !contractNo || !selectedIds.length} tone="primary" onClick={() => void createDraft()}>
              <FilePlus2 size={15} />
              生成预付款合同草稿
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function formatValue(value: unknown, type?: string) {
  return formatDisplayValue(value as string | number | boolean | null | undefined, type);
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
