"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, Plus, RefreshCw, Save, Search, Trash2 } from "lucide-react";
import { formatDisplayValue } from "@/lib/display-format";
import { buildDetailRoute, getReturnTo } from "@/lib/client-list-navigation";
import {
  mergePrepaymentAdjustmentSelection,
  type PrepaymentMonthlyWriteOffForAdjustment,
} from "@/lib/prepayment-adjustment-workflow";
import { Button, Input, Panel, Textarea } from "./ui";
import { PaginationBar } from "./pagination-bar";
import { StickyTable } from "./sticky-table";
import { DEFAULT_PAGE_SIZE } from "@/lib/pagination";

type Row = Record<string, string | number | boolean | null>;

const availableColumns: Array<{ key: string; label: string; type?: string }> = [
  { key: "writeOffMonth", label: "核销月份", type: "date" },
  { key: "contractNo", label: "预付款合同号" },
  { key: "countryCode", label: "国家" },
  { key: "batchName", label: "批次号" },
  { key: "requestNo", label: "需求单号" },
  { key: "poNo", label: "PO单号" },
  { key: "deviceCode", label: "实例编码" },
  { key: "modelCode", label: "机型" },
  { key: "nameEn", label: "英文名称" },
  { key: "quantity", label: "数量", type: "number" },
  { key: "currency", label: "币种" },
  { key: "monthlyAmount", label: "原月核销金额", type: "number" },
  { key: "sourceType", label: "来源" },
  { key: "adjustmentNo", label: "原调整单号" },
];

const confirmedColumns: Array<{ key: string; label: string; type?: string }> = [
  { key: "writeOffMonth", label: "核销月份", type: "date" },
  { key: "contractNo", label: "预付款合同号" },
  { key: "countryCode", label: "国家" },
  { key: "batchName", label: "批次号" },
  { key: "requestNo", label: "需求单号" },
  { key: "poNo", label: "PO单号" },
  { key: "deviceCode", label: "实例编码" },
  { key: "modelCode", label: "机型" },
  { key: "nameEn", label: "英文名称" },
  { key: "quantity", label: "数量", type: "number" },
  { key: "currency", label: "币种" },
  { key: "originalMonthlyAmount", label: "原月核销金额", type: "number" },
  { key: "adjustedMonthlyAmount", label: "调整后月核销金额", type: "number" },
  { key: "differenceAmount", label: "差额", type: "number" },
  { key: "createdAt", label: "创建日期", type: "date" },
  { key: "updatedAt", label: "更新日期", type: "date" },
];

export function PrepaymentWriteOffAdjustmentDetailPage({ adjustmentNo: routeAdjustmentNo }: { adjustmentNo: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = getReturnTo(searchParams.get("returnTo"), "/finance/prepayment-writeoff-adjustments");
  const isNew = routeAdjustmentNo === "new";
  const [adjustmentNo, setAdjustmentNo] = useState(isNew ? buildAdjustmentNo() : routeAdjustmentNo);
  const [status, setStatus] = useState("草稿");
  const [reason, setReason] = useState("");
  const [searchRows, setSearchRows] = useState<Row[]>([]);
  const [selectedRows, setSelectedRows] = useState<Row[]>([]);
  const [confirmedItems, setConfirmedItems] = useState<Row[]>([]);
  const [adjustedAmounts, setAdjustedAmounts] = useState<Record<string, string>>({});
  const [keyword, setKeyword] = useState("");
  const [startMonth, setStartMonth] = useState("");
  const [endMonth, setEndMonth] = useState("");
  const [countryCode, setCountryCode] = useState("");
  const [batchName, setBatchName] = useState("");
  const [contractNo, setContractNo] = useState("");
  const [deviceCode, setDeviceCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [searchPage, setSearchPage] = useState(1);
  const [searchPageSize, setSearchPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [searchTotal, setSearchTotal] = useState(0);
  const searchPageSizeRef = useRef(searchPageSize);
  const [saving, setSaving] = useState(false);
  const confirmed = status === "已确认";

  async function loadSearchRows(nextPage = searchPage, nextPageSize = searchPageSizeRef.current) {
    setLoading(true);
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries({ keyword, startMonth, endMonth, countryCode, batchName, contractNo, deviceCode })) {
      if (value.trim()) params.set(key, value.trim());
    }
    params.set("page", String(nextPage));
    params.set("pageSize", String(nextPageSize));
    const response = await fetch(`/api/prepayment-adjustments/available?${params.toString()}`);
    const data = await response.json();
    setSearchRows(data.rows ?? []);
    setSearchTotal(Number(data.total ?? 0));
    setSearchPage(Number(data.page ?? nextPage));
    setLoading(false);
  }

  async function loadAdjustment() {
    if (isNew) return;
    const response = await fetch(`/api/prepayment-adjustments/${encodeURIComponent(routeAdjustmentNo)}`);
    const data = await response.json();
    if (!response.ok) return;
    const adjustment = data.adjustment ?? {};
    const items: Row[] = data.items ?? [];
    setAdjustmentNo(String(adjustment.adjustmentNo ?? routeAdjustmentNo));
    setStatus(String(adjustment.status ?? "草稿"));
    setReason(String(adjustment.reason ?? ""));
    setConfirmedItems(items);
    setSelectedRows(
      items.map((item) => ({
        ...item,
        id: String(item.monthlyWriteOffId ?? ""),
        monthlyAmount: Number(item.originalMonthlyAmount ?? 0),
        sourceType: "",
      })),
    );
    setAdjustedAmounts(
      Object.fromEntries(items.map((item) => [String(item.monthlyWriteOffId ?? ""), String(item.adjustedMonthlyAmount ?? "")])),
    );
  }

  useEffect(() => {
    void loadAdjustment();
  }, []);

  const selectedSummary = useMemo(() => {
    return selectedRows.reduce<{ count: number; originalTotal: number; adjustedTotal: number; differenceTotal: number }>(
      (summary, row) => {
        const id = String(row.id);
        const originalAmount = Number(row.monthlyAmount ?? 0);
        const adjustedAmount = Number(adjustedAmounts[id] || originalAmount);
        return {
          count: summary.count + 1,
          originalTotal: roundMoney(summary.originalTotal + originalAmount),
          adjustedTotal: roundMoney(summary.adjustedTotal + adjustedAmount),
          differenceTotal: roundMoney(summary.differenceTotal + adjustedAmount - originalAmount),
        };
      },
      { count: 0, originalTotal: 0, adjustedTotal: 0, differenceTotal: 0 },
    );
  }, [adjustedAmounts, selectedRows]);

  function addRow(row: Row) {
    const id = String(row.id);
    setSelectedRows((current) =>
      mergePrepaymentAdjustmentSelection({
        currentRows: current as unknown as PrepaymentMonthlyWriteOffForAdjustment[],
        rowsToAdd: [row as unknown as PrepaymentMonthlyWriteOffForAdjustment],
      }) as unknown as Row[],
    );
    setAdjustedAmounts((amounts) => ({ ...amounts, [id]: amounts[id] ?? String(row.monthlyAmount ?? 0) }));
  }

  function removeRow(id: string) {
    setSelectedRows((current) => current.filter((row) => String(row.id) !== id));
    setAdjustedAmounts((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  }

  async function saveDraft() {
    if (saving) return false;
    const ids = selectedRows.map((row) => String(row.id));
    if (!adjustmentNo.trim()) {
      alert("请填写调整单号");
      return false;
    }
    if (!ids.length) {
      alert("请先通过搜索添加需要调整的明细");
      return false;
    }
    setSaving(true);
    const response = await fetch(`/api/prepayment-adjustments${isNew ? "" : `/${encodeURIComponent(adjustmentNo)}`}`, {
      method: isNew ? "POST" : "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        adjustmentNo,
        reason,
        monthlyWriteOffIds: ids,
        adjustedAmounts,
      }),
    });
    const data = await response.json();
    setSaving(false);
    if (!response.ok) {
      alert(data.error ?? "保存失败");
      return false;
    }
    if (isNew) {
      router.replace(buildDetailRoute(`/finance/prepayment-writeoff-adjustments/${encodeURIComponent(adjustmentNo)}`, returnTo), { scroll: false });
      router.refresh();
      alert("预付款核销调整单草稿已保存");
      return true;
    }
    await loadAdjustment();
    alert("预付款核销调整单草稿已保存");
    return true;
  }

  async function confirmAdjustment() {
    const saved = await saveDraft();
    if (!saved) return;
    const response = await fetch(`/api/prepayment-adjustments/${encodeURIComponent(adjustmentNo)}/confirm`, {
      method: "POST",
    });
    const data = await response.json();
    if (!response.ok) {
      alert(data.error ?? "确认失败");
      return;
    }
    setStatus("已确认");
    setConfirmedItems(data.items ?? []);
    alert("预付款核销调整单已确认");
    router.push(returnTo);
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-medium text-[#303133]">预付款核销调整单明细</h1>
        <p className="mt-1 text-sm text-[#909399]">先搜索特定实例或月份，添加到下方调整明细后再填写调整金额。</p>
      </div>

      <Panel>
        <div className="grid gap-4 border-b border-[#ebeef5] p-4 md:grid-cols-4">
          <label>
            <span className="mb-1 block text-sm font-medium text-[#606266]">调整单号</span>
            <Input className="w-full" disabled={!isNew || confirmed} value={adjustmentNo} onChange={(event) => setAdjustmentNo(event.target.value)} />
          </label>
          <label>
            <span className="mb-1 block text-sm font-medium text-[#606266]">状态</span>
            <Input className="w-full" disabled value={status} />
          </label>
          <label className="md:col-span-2">
            <span className="mb-1 block text-sm font-medium text-[#606266]">调整原因</span>
            <Textarea className="w-full" disabled={confirmed} value={reason} onChange={(event) => setReason(event.target.value)} />
          </label>
        </div>

        {!confirmed ? (
          <>
            <div className="flex flex-wrap items-center gap-2 border-b border-[#ebeef5] p-4">
              <Input placeholder="搜索合同/批次/需求单/PO/实例" value={keyword} onChange={(event) => setKeyword(event.target.value)} />
              <Input type="date" value={startMonth} onChange={(event) => setStartMonth(event.target.value)} />
              <Input type="date" value={endMonth} onChange={(event) => setEndMonth(event.target.value)} />
              <Input placeholder="国家" value={countryCode} onChange={(event) => setCountryCode(event.target.value)} />
              <Input placeholder="批次" value={batchName} onChange={(event) => setBatchName(event.target.value)} />
              <Input placeholder="预付款合同号" value={contractNo} onChange={(event) => setContractNo(event.target.value)} />
              <Input placeholder="实例编码" value={deviceCode} onChange={(event) => setDeviceCode(event.target.value)} />
              <Button tone="primary" onClick={() => { setSearchPage(1); void loadSearchRows(1, searchPageSizeRef.current); }}>
                <Search size={15} />
                查询
              </Button>
              <Button onClick={() => void loadSearchRows()}>
                <RefreshCw size={15} />
                刷新
              </Button>
            </div>

            <div className="border-b border-[#ebeef5] bg-white px-4 py-3 text-sm font-medium text-[#303133]">搜索结果</div>
            <div className="table-scroll max-h-[320px] overflow-auto border-b border-[#ebeef5]">
              <table className="min-w-full border-collapse text-sm">
                <thead className="bg-[#f5f7fa] text-[#303133]">
                  <tr>
                    {availableColumns.map((column) => (
                      <th className="whitespace-nowrap border-b border-r border-[#ebeef5] px-3 py-3 text-left font-medium" key={column.key}>
                        {column.label}
                      </th>
                    ))}
                    <th className="sticky right-0 border-b border-[#ebeef5] bg-[#f5f7fa] px-3 py-3 text-left font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {searchRows.map((row) => {
                    const id = String(row.id);
                    const added = selectedRows.some((selected) => String(selected.id) === id);
                    return (
                      <tr className="hover:bg-[#fafafa]" key={id}>
                        {availableColumns.map((column) => (
                          <td className="whitespace-nowrap border-b border-r border-[#ebeef5] px-3 py-3" key={column.key}>
                            {formatValue(row[column.key], column.type)}
                          </td>
                        ))}
                        <td className="sticky right-0 whitespace-nowrap border-b border-[#ebeef5] bg-white px-3 py-3">
                          <Button disabled={added} tone="primary" onClick={() => addRow(row)}>
                            <Plus size={15} />
                            {added ? "已添加" : "添加"}
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                  {!searchRows.length ? (
                    <tr>
                      <td className="py-10 text-center text-[#909399]" colSpan={availableColumns.length + 1}>
                        {loading ? "加载中..." : "请先搜索需要调整的实例或月份"}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <PaginationBar
              page={searchPage}
              pageSize={searchPageSize}
              total={searchTotal}
              onPageChange={(next) => { setSearchPage(next); void loadSearchRows(next, searchPageSizeRef.current); }}
              onPageSizeChange={(next) => { searchPageSizeRef.current = next; setSearchPageSize(next); setSearchPage(1); void loadSearchRows(1, next); }}
            />

            <div className="flex flex-wrap items-center gap-4 border-b border-[#ebeef5] bg-[#fafafa] p-4 text-sm text-[#606266]">
              <span>已添加 {selectedSummary.count} 条</span>
              <span>原金额合计 {formatValue(selectedSummary.originalTotal, "number")}</span>
              <span>调整后合计 {formatValue(selectedSummary.adjustedTotal, "number")}</span>
              <span>差额合计 {formatValue(selectedSummary.differenceTotal, "number")}</span>
              <div className="ml-auto flex gap-2">
                <Button disabled={saving} tone="primary" onClick={() => void saveDraft()}>
                  <Save size={15} />
                  {saving ? "保存中" : "保存草稿"}
                </Button>
                <Button disabled={saving} tone="success" onClick={() => void confirmAdjustment()}>
                  <CheckCircle2 size={15} />
                  确认调整
                </Button>
              </div>
            </div>

            <div className="border-b border-[#ebeef5] bg-white px-4 py-3 text-sm font-medium text-[#303133]">已添加调整明细</div>
            <AdjustmentTable
              adjustedAmounts={adjustedAmounts}
              rows={selectedRows}
              onAmountChange={(id, value) => setAdjustedAmounts((current) => ({ ...current, [id]: value }))}
              onRemove={removeRow}
            />
          </>
        ) : (
          <ConfirmedTable rows={confirmedItems} />
        )}
      </Panel>
    </div>
  );
}

function AdjustmentTable({
  adjustedAmounts,
  onAmountChange,
  onRemove,
  rows,
}: {
  adjustedAmounts: Record<string, string>;
  rows: Row[];
  onAmountChange: (id: string, value: string) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <StickyTable className="table-scroll overflow-auto" tableKey="prepayment-writeoff-adjustment-detail-selected">
      <table className="min-w-full border-collapse text-sm">
        <thead className="bg-[#f5f7fa] text-[#303133]">
          <tr>
            {availableColumns.map((column) => (
              <th className="whitespace-nowrap border-b border-r border-[#ebeef5] px-3 py-3 text-left font-medium" key={column.key}>
                {column.label}
              </th>
            ))}
            <th className="border-b border-r border-[#ebeef5] px-3 py-3 text-left font-medium">调整后月核销金额</th>
            <th className="sticky right-0 border-b border-[#ebeef5] bg-[#f5f7fa] px-3 py-3 text-left font-medium">操作</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const id = String(row.id);
            return (
              <tr className="hover:bg-[#fafafa]" key={id}>
                {availableColumns.map((column) => (
                  <td className="whitespace-nowrap border-b border-r border-[#ebeef5] px-3 py-3" key={column.key}>
                    {formatValue(row[column.key], column.type)}
                  </td>
                ))}
                <td className="whitespace-nowrap border-b border-r border-[#ebeef5] px-3 py-3">
                  <Input
                    className="min-w-[120px]"
                    type="number"
                    step="0.0001"
                    value={adjustedAmounts[id] ?? ""}
                    onChange={(event) => onAmountChange(id, event.target.value)}
                  />
                </td>
                <td className="sticky right-0 whitespace-nowrap border-b border-[#ebeef5] bg-white px-3 py-3">
                  <Button tone="danger" onClick={() => onRemove(id)}>
                    <Trash2 size={15} />
                    移除
                  </Button>
                </td>
              </tr>
            );
          })}
          {!rows.length ? (
            <tr>
              <td className="py-12 text-center text-[#909399]" colSpan={availableColumns.length + 2}>
                暂无已添加明细，请从搜索结果中添加
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </StickyTable>
  );
}

function ConfirmedTable({ rows }: { rows: Row[] }) {
  return (
    <StickyTable className="table-scroll overflow-auto" tableKey="prepayment-writeoff-adjustment-detail-confirmed">
      <table className="min-w-full border-collapse text-sm">
        <thead className="bg-[#f5f7fa] text-[#303133]">
          <tr>
            {confirmedColumns.map((column) => (
              <th className="whitespace-nowrap border-b border-r border-[#ebeef5] px-3 py-3 text-left font-medium" key={column.key}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr className="hover:bg-[#fafafa]" key={String(row.id)}>
              {confirmedColumns.map((column) => (
                <td className="whitespace-nowrap border-b border-r border-[#ebeef5] px-3 py-3" key={column.key}>
                  {formatValue(row[column.key], column.type)}
                </td>
              ))}
            </tr>
          ))}
          {!rows.length ? (
            <tr>
              <td className="py-12 text-center text-[#909399]" colSpan={confirmedColumns.length}>
                暂无调整明细
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </StickyTable>
  );
}

function buildAdjustmentNo() {
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
  ].join("");
  return `PWA-${stamp}`;
}

function formatValue(value: unknown, type?: string) {
  return formatDisplayValue(value as string | number | boolean | null | undefined, type);
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
