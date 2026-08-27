"use client";

import { useEffect, useMemo, useState } from "react";
import { Calculator, CheckCircle2, Download, Plus, RefreshCw, Search, XCircle } from "lucide-react";
import { exportRowsToXlsx } from "@/lib/client-xlsx-export";
import { fetchAllEntityRows } from "@/lib/client-entity-fetch";
import { fetchTableFilterOptions } from "@/lib/table-query-client";
import { PaginationBar } from "./pagination-bar";
import { StickyTable } from "./sticky-table";
import { TableColumnMenu, type TableSortOrder } from "./table-column-menu";
import { Button, Input, Panel } from "./ui";

type Value = string | number | boolean | null | undefined;
type Row = Record<string, Value | string[]>;
type Country = { code: string; nameZh?: string; nameEn?: string };
type PricingVersion = { versionId: string; versionNo: string; countryCode: string; effectiveDate?: string };
type Candidate = Row & {
  id: string;
  countryCode?: string;
  batchName?: string;
  requestNo?: string;
  poNo?: string;
  deviceCode?: string;
  modelCode?: string;
  nameEn?: string;
  quantity?: Value;
  procurementCurrency?: string;
  capexUnitPrice?: Value;
  opexUnitPrice?: Value;
  settlementRate?: Value;
  anchorCapexUnitPrice?: Value;
  anchorOpexUnitPrice?: Value;
  pricingVersionNo?: string;
  missingReasons?: string[];
};
type Settlement = Row & { settlementNo: string; status?: string; countryCode?: string; title?: string };
type SettlementDetail = { master: Settlement; items: Row[] };

const DRAFT = "草稿";
const CONFIRMED = "已确认";
const VOIDED = "已作废";
const RATE_REASON = "请填写采购币种兑USD的结差汇率";
const SETTLEMENT_EXPORT_COLUMNS = [
  ["settlementNo", "结差来源单号"], ["title", "结差单名称"], ["itemTypes", "来源类型"], ["countryCode", "国家"], ["pricingVersionNo", "锚定价格版本"],
  ["currency", "结差币种"], ["status", "状态"], ["itemCount", "明细数量"], ["capexDifferenceTotal", "CAPEX结差总额"],
  ["opexDifferenceTotal", "OPEX结差总额"], ["differenceTotal", "结差合计"], ["confirmedAt", "确认日期"], ["createdAt", "创建日期"], ["updatedAt", "更新日期"],
] as const;
const DETAIL_EXPORT_COLUMNS = [
  ["lineNo", "序号"], ["itemType", "结差类型"], ["countryCode", "国家"], ["batchName", "批次"], ["requestNo", "需求单号"], ["poNo", "PO单号"],
  ["deviceCode", "实例编码"], ["modelCode", "机型"], ["nameEn", "英文名称"], ["quantity", "数量"], ["procurementCurrency", "采购币种"],
  ["supplierCode", "供应商"], ["undertakingUnitCode", "承接单位"], ["customerCode", "客户"],
  ["purchaseCapexUnitPrice", "采购CAPEX单价"], ["purchaseOpexUnitPrice", "采购OPEX单价"], ["settlementCurrency", "结差币种"], ["settlementRate", "结差汇率"],
  ["settlementCapexUnitPrice", "结差CAPEX单价"], ["settlementOpexUnitPrice", "结差OPEX单价"], ["anchorVersionNo", "锚定版本"],
  ["anchorCapexUnitPrice", "CAPEX锚定单价"], ["anchorOpexUnitPrice", "OPEX锚定单价"], ["capexDifferenceUnitPrice", "CAPEX结差单价"],
  ["capexDifferenceTotal", "CAPEX结差总额"], ["opexDifferenceUnitPrice", "OPEX结差单价"], ["opexDifferenceTotal", "OPEX结差总额"],
  ["differenceTotal", "结差合计"], ["expenseType", "非实例费用类型"], ["differenceNature", "结差性质"], ["expenseCategory", "费用类别"], ["expenseName", "费用名称"],
  ["expenseDate", "费用日期"], ["documentNo", "单据号"], ["deviceNodeQuantity", "设备节点数量"], ["deliveryQuantity", "交付数量"], ["settlementQuantity", "结算数量"],
  ["taxExcludedUnitPriceUsd", "设备不含税单价 USD"], ["priceConfirmation", "单价确认"], ["paymentExchangeRate", "支付时汇率（CNY/USD）"],
  ["taxExcludedTotalUsd", "不含税总价 USD"], ["taxExcludedTotalCny", "不含税总价 CNY"], ["equipmentTotalUsd", "设备/计税基数 USD"], ["localTaxRate", "当地/金融税率（%）"],
  ["calculatedTaxAmountUsd", "理论清关税费 USD"], ["feeCurrency", "费用币种"], ["feeAmount", "原币/实际费用金额"], ["expenseProvider", "服务商"],
  ["usdExchangeRate", "兑 USD 汇率"], ["settlementAmountUsd", "实际结算 USD"], ["issRate", "ISS 税率（%）"], ["issExcludedAmountUsd", "扣除 ISS 后 USD"],
  ["confirmationResult", "确认结果"], ["sourceReference", "来源凭证"], ["receiptDate", "签收日期"], ["paymentDate", "付款日期"], ["notes", "备注"],
] as const;
const DETAIL_TABLE_COLUMNS = [
  ["lineNo", "序号", "number"], ["itemType", "类型"], ["countryCode", "国家"], ["batchName", "批次"], ["requestNo", "需求单号"], ["poNo", "PO单号"],
  ["deviceCode", "实例编码"], ["modelCode", "机型"], ["nameEn", "英文名称"], ["quantity", "数量", "number"], ["procurementCurrency", "采购币种"],
  ["supplierCode", "供应商"], ["undertakingUnitCode", "承接单位"], ["customerCode", "客户"],
  ["purchaseCapexUnitPrice", "采购CAPEX单价", "money"], ["purchaseOpexUnitPrice", "采购OPEX单价", "money"], ["settlementCurrency", "结差币种"], ["settlementRate", "结差汇率", "money"],
  ["settlementCapexUnitPrice", "结差CAPEX单价", "money"], ["settlementOpexUnitPrice", "结差OPEX单价", "money"], ["anchorVersionNo", "锚定版本"],
  ["anchorCapexUnitPrice", "CAPEX锚定单价", "money"], ["anchorOpexUnitPrice", "OPEX锚定单价", "money"], ["capexDifferenceTotal", "CAPEX结差总额", "money"],
  ["opexDifferenceTotal", "OPEX结差总额", "money"], ["differenceTotal", "结差合计", "money"],
] as const;
const NON_INSTANCE_DETAIL_TABLE_COLUMNS = [
  ["expenseType", "非实例费用类型"], ["differenceNature", "结差性质"], ["expenseCategory", "费用类别"], ["expenseName", "费用名称"], ["expenseDate", "费用日期", "date"],
  ["documentNo", "单据号"], ["deviceNodeQuantity", "设备节点数量", "number"], ["deliveryQuantity", "交付数量", "number"], ["settlementQuantity", "结算数量", "number"],
  ["taxExcludedUnitPriceUsd", "设备不含税单价 USD", "money"], ["priceConfirmation", "单价确认"], ["paymentExchangeRate", "支付时汇率（CNY/USD）", "money"],
  ["taxExcludedTotalUsd", "不含税总价 USD", "money"], ["taxExcludedTotalCny", "不含税总价 CNY", "money"], ["equipmentTotalUsd", "设备/计税基数 USD", "money"],
  ["localTaxRate", "当地/金融税率（%）", "number"], ["calculatedTaxAmountUsd", "理论清关税费 USD", "money"], ["feeCurrency", "费用币种"], ["feeAmount", "原币/实际费用金额", "money"],
  ["expenseProvider", "服务商"], ["usdExchangeRate", "兑 USD 汇率", "money"], ["settlementAmountUsd", "实际结算 USD", "money"], ["issRate", "ISS 税率（%）", "number"],
  ["issExcludedAmountUsd", "扣除 ISS 后 USD", "money"], ["confirmationResult", "确认结果"], ["sourceReference", "来源凭证"], ["notes", "备注"],
] as const;

function asText(value: unknown) {
  return String(value ?? "").trim();
}

function asNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatMoney(value: unknown) {
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(asNumber(value));
}

function formatDate(value: unknown) {
  return asText(value).slice(0, 10);
}

function isNegative(value: unknown) {
  return asNumber(value) < 0;
}

function formatValue(value: unknown, kind?: "money" | "date" | "number") {
  if (kind === "money") return formatMoney(value);
  if (kind === "date") return formatDate(value);
  if (kind === "number") return asNumber(value);
  return asText(value);
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? "请求失败");
  return payload as T;
}

function exportRows(columns: readonly (readonly [string, string])[], rows: Row[], fileName: string, sheetName: string) {
  exportRowsToXlsx({
    fileName,
    sheetName,
    columns: columns.map(([key, label]) => ({
      key,
      label,
      format: (value) => key.endsWith("At") || key.endsWith("Date") ? formatDate(value) : value as string | number,
    })),
    rows,
  });
}

function statusClass(status: unknown) {
  if (status === CONFIRMED) return "bg-[#f0f9eb] text-[#67c23a]";
  if (status === VOIDED) return "bg-[#f4f4f5] text-[#909399]";
  return "bg-[#ecf5ff] text-[#409eff]";
}

function previewDifference(candidate: Candidate, inputRate: unknown) {
  const rate = asText(candidate.procurementCurrency).toUpperCase() === "USD" ? 1 : asNumber(inputRate);
  if (rate <= 0) return null;
  const quantity = asNumber(candidate.quantity, 1);
  const capexDifference = asNumber(candidate.capexUnitPrice) / rate - asNumber(candidate.anchorCapexUnitPrice);
  const opexDifference = asNumber(candidate.opexUnitPrice) / rate - asNumber(candidate.anchorOpexUnitPrice);
  return {
    capexDifferenceTotal: capexDifference * quantity,
    opexDifferenceTotal: opexDifference * quantity,
    differenceTotal: (capexDifference + opexDifference) * quantity,
  };
}

export function BalanceSettlementPage() {
  const [tab, setTab] = useState<"available" | "settlements">("available");
  const [countries, setCountries] = useState<Country[]>([]);
  const [versions, setVersions] = useState<PricingVersion[]>([]);
  const [candidatePage, setCandidatePage] = useState(1);
  const [candidatePageSize, setCandidatePageSize] = useState(20);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [candidateTotal, setCandidateTotal] = useState(0);
  const [candidateCountry, setCandidateCountry] = useState("");
  const [candidateKeyword, setCandidateKeyword] = useState("");
  const [pricingVersionId, setPricingVersionId] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedCandidateRows, setSelectedCandidateRows] = useState<Record<string, Candidate>>({});
  const [settlementRates, setSettlementRates] = useState<Record<string, string>>({});
  const [draftTitle, setDraftTitle] = useState("");
  const [draftNotes, setDraftNotes] = useState("");
  const [draftPeriodStart, setDraftPeriodStart] = useState("");
  const [draftPeriodEnd, setDraftPeriodEnd] = useState("");
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [settlementPage, setSettlementPage] = useState(1);
  const [settlementPageSize, setSettlementPageSize] = useState(20);
  const [settlementTotal, setSettlementTotal] = useState(0);
  const [settlementCountry, setSettlementCountry] = useState("");
  const [settlementStatus, setSettlementStatus] = useState("");
  const [settlementKeyword, setSettlementKeyword] = useState("");
  const [detail, setDetail] = useState<SettlementDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showFormula, setShowFormula] = useState(false);
  const [candidateSortField, setCandidateSortField] = useState("");
  const [candidateSortOrder, setCandidateSortOrder] = useState<TableSortOrder>("");
  const [candidateFilters, setCandidateFilters] = useState<Record<string, string[]>>({});
  const [settlementSortField, setSettlementSortField] = useState("");
  const [settlementSortOrder, setSettlementSortOrder] = useState<TableSortOrder>("");
  const [settlementFilters, setSettlementFilters] = useState<Record<string, string[]>>({});

  const versionOptions = useMemo(
    () => versions.filter((version) => !candidateCountry || version.countryCode === candidateCountry),
    [versions, candidateCountry],
  );
  const selectedRows = useMemo(() => Object.values(selectedCandidateRows), [selectedCandidateRows]);
  const selectedPreviewTotal = useMemo(
    () => selectedRows.reduce((total, row) => total + (previewDifference(row, settlementRates[row.id])?.differenceTotal ?? 0), 0),
    [selectedRows, settlementRates],
  );

  async function loadReferenceData() {
    try {
      const [countryRows, versionData] = await Promise.all([
        fetchAllEntityRows<Country>("countries"),
        fetchJson<{ rows: PricingVersion[] }>("/api/balance-settlements/pricing-versions"),
      ]);
      setCountries(countryRows);
      setVersions(versionData.rows ?? []);
    } catch (error) {
      alert(error instanceof Error ? error.message : "基础数据加载失败");
    }
  }

  async function loadCandidates(page = candidatePage, pageSize = candidatePageSize, queryState = { sortField: candidateSortField, sortOrder: candidateSortOrder, filters: candidateFilters }) {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (candidateCountry) params.set("countryCode", candidateCountry);
      if (pricingVersionId) params.set("pricingVersionId", pricingVersionId);
      if (candidateKeyword.trim()) params.set("keyword", candidateKeyword.trim());
      if (queryState.sortField && queryState.sortOrder) { params.set("sortField", queryState.sortField); params.set("sortOrder", queryState.sortOrder); }
      for (const [field, values] of Object.entries(queryState.filters)) for (const value of values) params.append(`filter.${field}`, value);
      const data = await fetchJson<{ rows: Candidate[]; total: number; page: number; pageSize: number }>(`/api/balance-settlements/available?${params}`);
      setCandidates(data.rows ?? []);
      setSelectedCandidateRows((current) => {
        const next = { ...current };
        for (const row of data.rows ?? []) {
          if (selectedIds.includes(row.id)) next[row.id] = row;
        }
        return next;
      });
      setCandidateTotal(Number(data.total ?? 0));
      setCandidatePage(Number(data.page ?? page));
      setCandidatePageSize(Number(data.pageSize ?? pageSize));
    } catch (error) {
      alert(error instanceof Error ? error.message : "待生成实例结差加载失败");
    } finally {
      setLoading(false);
    }
  }

  async function loadSettlements(page = settlementPage, pageSize = settlementPageSize, queryState = { sortField: settlementSortField, sortOrder: settlementSortOrder, filters: settlementFilters }) {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (settlementCountry) params.set("countryCode", settlementCountry);
      if (settlementStatus) params.set("status", settlementStatus);
      if (settlementKeyword.trim()) params.set("keyword", settlementKeyword.trim());
      if (queryState.sortField && queryState.sortOrder) { params.set("sortField", queryState.sortField); params.set("sortOrder", queryState.sortOrder); }
      for (const [field, values] of Object.entries(queryState.filters)) for (const value of values) params.append(`filter.${field}`, value);
      const data = await fetchJson<{ rows: Settlement[]; total: number; page: number; pageSize: number }>(`/api/balance-settlements?${params}`);
      setSettlements(data.rows ?? []);
      setSettlementTotal(Number(data.total ?? 0));
      setSettlementPage(Number(data.page ?? page));
      setSettlementPageSize(Number(data.pageSize ?? pageSize));
    } catch (error) {
      alert(error instanceof Error ? error.message : "结差单加载失败");
    } finally {
      setLoading(false);
    }
  }

  function updateCandidateQuery(key: string, next: { order?: TableSortOrder; values?: string[] }) {
    const state = { sortField: next.order !== undefined ? (next.order ? key : "") : candidateSortField, sortOrder: next.order ?? candidateSortOrder, filters: next.values ? { ...candidateFilters, [key]: next.values } : candidateFilters };
    setCandidateSortField(state.sortField); setCandidateSortOrder(state.sortOrder); setCandidateFilters(state.filters); setCandidatePage(1); void loadCandidates(1, candidatePageSize, state);
  }

  function updateSettlementQuery(key: string, next: { order?: TableSortOrder; values?: string[] }) {
    const state = { sortField: next.order !== undefined ? (next.order ? key : "") : settlementSortField, sortOrder: next.order ?? settlementSortOrder, filters: next.values ? { ...settlementFilters, [key]: next.values } : settlementFilters };
    setSettlementSortField(state.sortField); setSettlementSortOrder(state.sortOrder); setSettlementFilters(state.filters); setSettlementPage(1); void loadSettlements(1, settlementPageSize, state);
  }

  function columnMenu(key: string, label: string, state: { sortField: string; sortOrder: TableSortOrder; filters: Record<string, string[]> }, endpoint: string, update: (key: string, next: { order?: TableSortOrder; values?: string[] }) => void, extraParams: Record<string, string> = {}) {
    return <TableColumnMenu column={{ key, label, sortable: true, filterable: true }} sortOrder={state.sortField === key ? state.sortOrder : ""} filterValues={state.filters[key] ?? []} loadOptions={(keyword) => fetchTableFilterOptions(endpoint, key, keyword, extraParams, state.filters)} onSort={(order) => update(key, { order })} onFilter={(values) => update(key, { values })} />;
  }

  useEffect(() => { void loadReferenceData(); }, []);
  useEffect(() => { void loadCandidates(1, candidatePageSize); }, [pricingVersionId]);
  useEffect(() => { if (tab === "settlements") void loadSettlements(); }, [tab]);

  function selectVersion(value: string) {
    setPricingVersionId(value);
    setSelectedIds([]);
    setSelectedCandidateRows({});
    setSettlementRates({});
    const version = versions.find((row) => row.versionId === value);
    if (version?.countryCode) setCandidateCountry(version.countryCode);
  }

  function candidateCanGenerate(row: Candidate) {
    const reasons = (row.missingReasons ?? []).filter((reason) => reason !== RATE_REASON);
    const rate = asText(row.procurementCurrency).toUpperCase() === "USD" ? 1 : asNumber(settlementRates[row.id]);
    return !reasons.length && rate > 0;
  }

  function toggleCandidate(row: Candidate) {
    setSelectedIds((current) => current.includes(row.id) ? current.filter((value) => value !== row.id) : [...current, row.id]);
    setSelectedCandidateRows((current) => {
      if (current[row.id]) {
        const { [row.id]: _removed, ...next } = current;
        return next;
      }
      return { ...current, [row.id]: row };
    });
  }

  function toggleAllCandidates() {
    setSelectedIds((current) => allSelected ? current.filter((id) => !allSelectable.some((row) => row.id === id)) : Array.from(new Set([...current, ...allSelectable.map((row) => row.id)])));
    setSelectedCandidateRows((current) => {
      if (allSelected) {
        const next = { ...current };
        for (const row of allSelectable) delete next[row.id];
        return next;
      }
      return Object.assign({}, current, Object.fromEntries(allSelectable.map((row) => [row.id, row])));
    });
  }

  async function createInstanceDraft() {
    if (!pricingVersionId) return alert("请先选择已确认的CAPEX/OPEX锚定价格版本");
    if (!selectedIds.length) return alert("请至少勾选一条实例结差明细");
    const invalid = selectedRows.filter((row) => !candidateCanGenerate(row));
    if (invalid.length) return alert("已选明细中存在缺失CAPEX/OPEX、锚定价或结差汇率的数据");
    setSaving(true);
    try {
      const data = await fetchJson<SettlementDetail>("/api/balance-settlements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pricingVersionId, purchaseOrderItemIds: selectedIds, settlementRates, title: draftTitle, notes: draftNotes, periodStart: draftPeriodStart, periodEnd: draftPeriodEnd }),
      });
      setDetail(data);
      setTab("settlements");
      await Promise.all([loadCandidates(1), loadSettlements()]);
      setDraftTitle("");
      setDraftNotes("");
      setDraftPeriodStart("");
      setDraftPeriodEnd("");
      setSelectedIds([]);
      setSelectedCandidateRows({});
      setSettlementRates({});
      alert("结差草稿已生成");
    } catch (error) {
      alert(error instanceof Error ? error.message : "生成结差草稿失败");
    } finally {
      setSaving(false);
    }
  }

  async function openSettlement(settlementNo: string) {
    try {
      setDetail(await fetchJson<SettlementDetail>(`/api/balance-settlements/${encodeURIComponent(settlementNo)}`));
    } catch (error) {
      alert(error instanceof Error ? error.message : "结差单明细加载失败");
    }
  }

  async function confirmSettlement() {
    if (!detail || detail.master.status !== DRAFT) return;
    if (!confirm(`确认结差单 ${detail.master.settlementNo} 吗？确认后将锁定采购价格、锚定版本、汇率和计算结果。`)) return;
    setSaving(true);
    try {
      const data = await fetchJson<SettlementDetail>(`/api/balance-settlements/${encodeURIComponent(detail.master.settlementNo)}/confirm`, { method: "POST" });
      setDetail(data);
      await loadSettlements();
    } catch (error) {
      alert(error instanceof Error ? error.message : "确认结差单失败");
    } finally {
      setSaving(false);
    }
  }

  async function voidSettlement() {
    if (!detail || detail.master.status !== DRAFT) return;
    if (!confirm(`作废结差草稿 ${detail.master.settlementNo} 吗？对应采购明细将重新回到待生成列表。`)) return;
    setSaving(true);
    try {
      const data = await fetchJson<SettlementDetail>(`/api/balance-settlements/${encodeURIComponent(detail.master.settlementNo)}/void`, { method: "POST" });
      setDetail(data);
      await Promise.all([loadSettlements(), loadCandidates(1)]);
    } catch (error) {
      alert(error instanceof Error ? error.message : "作废结差草稿失败");
    } finally {
      setSaving(false);
    }
  }

  const allSelectable = candidates.filter(candidateCanGenerate);
  const allSelected = allSelectable.length > 0 && allSelectable.every((row) => selectedIds.includes(row.id));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-medium text-[#303133]">实例结差</h1>
          <p className="mt-1 text-sm text-[#909399]">以采购 CAPEX/OPEX、结差汇率和已确认锚定价格版本生成实例结差来源单。</p>
        </div>
        <Button onClick={() => setShowFormula(true)}><Calculator size={15} />计算逻辑</Button>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-[#dcdfe6]">
        {[["available", "待生成实例结差"], ["settlements", "结差来源单"]].map(([key, label]) => (
          <button
            className={`border-b-2 px-4 py-2 text-sm ${tab === key ? "border-[#1890ff] text-[#1890ff]" : "border-transparent text-[#606266] hover:text-[#1890ff]"}`}
            key={key}
            onClick={() => setTab(key as typeof tab)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "available" && (
        <>
          <Panel>
            <div className="flex flex-wrap items-center gap-2 border-b border-[#ebeef5] p-4">
              <select className="h-9 min-w-[130px] rounded border border-[#dcdfe6] bg-white px-2 text-sm" value={candidateCountry} onChange={(event) => { setCandidateCountry(event.target.value); setPricingVersionId(""); }}>
                <option value="">全部国家</option>
                {countries.map((country) => <option key={country.code} value={country.code}>{country.code}{country.nameZh ? ` - ${country.nameZh}` : ""}</option>)}
              </select>
              <select className="h-9 min-w-[240px] rounded border border-[#dcdfe6] bg-white px-2 text-sm" value={pricingVersionId} onChange={(event) => selectVersion(event.target.value)}>
                <option value="">选择已确认CAPEX/OPEX锚定价格版本</option>
                {versionOptions.map((version) => <option key={version.versionId} value={version.versionId}>{version.countryCode} / {version.versionNo} / {formatDate(version.effectiveDate)}</option>)}
              </select>
              <Input className="min-w-[240px]" placeholder="搜索批次、需求单、PO、实例编码或英文名称" value={candidateKeyword} onChange={(event) => setCandidateKeyword(event.target.value)} />
              <Button tone="primary" onClick={() => void loadCandidates(1)}><Search size={15} />查询</Button>
              <Button onClick={() => void loadCandidates(1)}><RefreshCw size={15} />刷新</Button>
            </div>
            <StickyTable className="table-scroll overflow-auto" tableKey="balance-settlement-available">
              <table className="w-full min-w-[2060px] border-collapse text-sm">
                <thead className="bg-[#f5f7fa] text-[#303133]"><tr>
                  <th className="w-12 border-b border-r border-[#ebeef5] px-3 py-3"><input type="checkbox" checked={allSelected} onChange={toggleAllCandidates} /></th>
                  {[ ["countryCode", "国家"], ["batchName", "批次"], ["requestNo", "需求单号"], ["poNo", "PO单号"], ["deviceCode", "实例编码"], ["modelCode", "机型"], ["nameEn", "英文名称"], ["undertakingUnitCode", "承接单位"], ["supplierCode", "供应商"], ["customerCode", "客户"], ["quantity", "数量"], ["procurementCurrency", "采购币种"], ["capexUnitPrice", "采购CAPEX单价"], ["opexUnitPrice", "采购OPEX单价"], ["settlementRate", "结差汇率"], ["anchorCapexUnitPrice", "CAPEX锚定单价"], ["anchorOpexUnitPrice", "OPEX锚定单价"], ["capexDifferenceTotal", "CAPEX结差总额"], ["opexDifferenceTotal", "OPEX结差总额"], ["differenceTotal", "结差合计"], ["canGenerate", "校验结果"]].map(([key, label]) => <th className="whitespace-nowrap border-b border-r border-[#ebeef5] px-3 py-3 text-left font-medium" key={key}>{["countryCode", "batchName", "requestNo", "poNo", "deviceCode", "modelCode", "nameEn", "undertakingUnitCode", "supplierCode", "customerCode", "quantity", "procurementCurrency", "capexUnitPrice", "opexUnitPrice", "anchorCapexUnitPrice", "anchorOpexUnitPrice"].includes(key) ? columnMenu(key, label, { sortField: candidateSortField, sortOrder: candidateSortOrder, filters: candidateFilters }, "/api/balance-settlements/available", updateCandidateQuery, { pricingVersionId, countryCode: candidateCountry }) : label}</th>)}
                </tr></thead>
                <tbody>
                  {candidates.map((row) => {
                    const preview = previewDifference(row, settlementRates[row.id]);
                    const canGenerate = candidateCanGenerate(row);
                    const missing = row.missingReasons ?? [];
                    return <tr className="hover:bg-[#fafafa]" key={row.id}>
                      <td className="border-b border-r border-[#ebeef5] px-3 py-3"><input type="checkbox" disabled={!canGenerate} checked={selectedIds.includes(row.id)} onChange={() => toggleCandidate(row)} /></td>
                      {[["countryCode"], ["batchName"], ["requestNo"], ["poNo"], ["deviceCode"], ["modelCode"], ["nameEn"], ["undertakingUnitCode"], ["supplierCode"], ["customerCode"], ["quantity", "number"], ["procurementCurrency"], ["capexUnitPrice", "money"], ["opexUnitPrice", "money"]].map(([key, kind]) => <td className="whitespace-nowrap border-b border-r border-[#ebeef5] px-3 py-3" key={key}>{formatValue(row[key], kind as "money" | "number")}</td>)}
                      <td className="border-b border-r border-[#ebeef5] px-3 py-2">
                        {asText(row.procurementCurrency).toUpperCase() === "USD" ? <span>1.000000</span> : <input className="h-8 w-28 rounded border border-[#dcdfe6] px-2 text-sm" type="number" min="0" step="0.000001" value={settlementRates[row.id] ?? ""} onChange={(event) => setSettlementRates((current) => ({ ...current, [row.id]: event.target.value }))} />}
                      </td>
                      <td className="whitespace-nowrap border-b border-r border-[#ebeef5] px-3 py-3">{formatMoney(row.anchorCapexUnitPrice)}</td>
                      <td className="whitespace-nowrap border-b border-r border-[#ebeef5] px-3 py-3">{formatMoney(row.anchorOpexUnitPrice)}</td>
                      {[[preview?.capexDifferenceTotal, "capex"], [preview?.opexDifferenceTotal, "opex"], [preview?.differenceTotal, "total"]].map(([value, key]) => <td className={`whitespace-nowrap border-b border-r border-[#ebeef5] px-3 py-3 ${isNegative(value) ? "text-[#f56c6c]" : ""}`} key={key}>{preview ? formatMoney(value) : "-"}</td>)}
                      <td className={`border-b border-r border-[#ebeef5] px-3 py-3 text-xs ${canGenerate ? "text-[#67c23a]" : "text-[#e6a23c]"}`}>{canGenerate ? "可生成" : missing.join("；")}</td>
                    </tr>;
                  })}
                  {!candidates.length && <tr><td className="py-12 text-center text-[#909399]" colSpan={18}>{loading ? "加载中..." : "暂无可生成的实例结差数据"}</td></tr>}
                </tbody>
              </table>
            </StickyTable>
            <PaginationBar page={candidatePage} pageSize={candidatePageSize} total={candidateTotal} onPageChange={(next) => void loadCandidates(next)} onPageSizeChange={(next) => void loadCandidates(1, next)} />
          </Panel>

          <div className="sticky bottom-4 z-10 border border-[#c6e2ff] bg-[#ecf5ff] px-4 py-3 shadow-sm">
            <div className="flex flex-wrap items-center gap-3 text-sm text-[#303133]">
              <span>已选择 <b>{selectedRows.length}</b> 条</span><span>预计结差合计 <b className={isNegative(selectedPreviewTotal) ? "text-[#f56c6c]" : ""}>{formatMoney(selectedPreviewTotal)} USD</b></span>
              <Input className="min-w-[220px]" placeholder="结差单名称（可选）" value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} />
              <label className="grid gap-1 text-xs text-[#606266]"><span>结差期间开始</span><Input className="min-w-[150px]" type="date" value={draftPeriodStart} onChange={(event) => setDraftPeriodStart(event.target.value)} /></label>
              <label className="grid gap-1 text-xs text-[#606266]"><span>结差期间结束</span><Input className="min-w-[150px]" type="date" value={draftPeriodEnd} onChange={(event) => setDraftPeriodEnd(event.target.value)} /></label>
              <Input className="min-w-[220px]" placeholder="备注（可选）" value={draftNotes} onChange={(event) => setDraftNotes(event.target.value)} />
              <Button tone="primary" disabled={saving || !selectedRows.length} onClick={() => void createInstanceDraft()}><Plus size={15} />生成结差草稿</Button>
            </div>
          </div>
        </>
      )}

      {tab === "settlements" && (
        <>
          <Panel>
            <div className="flex flex-wrap items-center gap-2 border-b border-[#ebeef5] p-4">
              <select className="h-9 min-w-[130px] rounded border border-[#dcdfe6] bg-white px-2 text-sm" value={settlementCountry} onChange={(event) => setSettlementCountry(event.target.value)}><option value="">全部国家</option>{countries.map((country) => <option key={country.code} value={country.code}>{country.code}</option>)}</select>
              <select className="h-9 min-w-[120px] rounded border border-[#dcdfe6] bg-white px-2 text-sm" value={settlementStatus} onChange={(event) => setSettlementStatus(event.target.value)}><option value="">全部状态</option>{[DRAFT, CONFIRMED, VOIDED].map((status) => <option key={status} value={status}>{status}</option>)}</select>
              <Input placeholder="搜索结差来源单号、名称或锚定版本" value={settlementKeyword} onChange={(event) => setSettlementKeyword(event.target.value)} />
              <Button tone="primary" onClick={() => void loadSettlements()}><Search size={15} />查询</Button><Button onClick={() => void loadSettlements()}><RefreshCw size={15} />刷新</Button>
              <Button onClick={() => exportRows(SETTLEMENT_EXPORT_COLUMNS, settlements, "结差来源单.xlsx", "结差来源单")}><Download size={15} />导出</Button>
            </div>
            <StickyTable className="table-scroll overflow-auto" tableKey="balance-settlements"><table className="w-full min-w-[1460px] border-collapse text-sm"><thead className="bg-[#f5f7fa] text-[#303133]"><tr>{[["settlementNo", "结差来源单号"], ["title", "结差单名称"], ["itemTypes", "来源类型"], ["countryCode", "国家"], ["pricingVersionNo", "锚定价格版本"], ["currency", "币种"], ["status", "状态"], ["itemCount", "明细数量"], ["capexDifferenceTotal", "CAPEX结差总额"], ["opexDifferenceTotal", "OPEX结差总额"], ["differenceTotal", "结差合计"], ["confirmedAt", "确认日期"], ["createdAt", "创建日期"], ["updatedAt", "更新日期"]].map(([key, label]) => <th className="whitespace-nowrap border-b border-r border-[#ebeef5] px-3 py-3 text-left font-medium" key={key}>{columnMenu(key, label, { sortField: settlementSortField, sortOrder: settlementSortOrder, filters: settlementFilters }, "/api/balance-settlements", updateSettlementQuery)}</th>)}</tr></thead><tbody>
              {settlements.map((row) => <tr className="hover:bg-[#fafafa]" key={row.settlementNo}>
                <td className="whitespace-nowrap border-b border-r border-[#ebeef5] px-3 py-3"><button className="text-[#1890ff] hover:underline" onClick={() => void openSettlement(row.settlementNo)}>{row.settlementNo}</button></td>
                {[["title"], ["itemTypes"], ["countryCode"], ["pricingVersionNo"], ["currency"]].map(([key]) => <td className="whitespace-nowrap border-b border-r border-[#ebeef5] px-3 py-3" key={key}>{asText(row[key]) || "-"}</td>)}
                <td className="border-b border-r border-[#ebeef5] px-3 py-3"><span className={`rounded px-2 py-1 text-xs ${statusClass(row.status)}`}>{asText(row.status)}</span></td>
                <td className="border-b border-r border-[#ebeef5] px-3 py-3">{asNumber(row.itemCount)}</td>
                {[["capexDifferenceTotal"], ["opexDifferenceTotal"], ["differenceTotal"]].map(([key]) => <td className={`whitespace-nowrap border-b border-r border-[#ebeef5] px-3 py-3 ${isNegative(row[key]) ? "text-[#f56c6c]" : ""}`} key={key}>{formatMoney(row[key])}</td>)}
                <td className="whitespace-nowrap border-b border-r border-[#ebeef5] px-3 py-3">{formatDate(row.confirmedAt)}</td><td className="whitespace-nowrap border-b border-r border-[#ebeef5] px-3 py-3">{formatDate(row.createdAt)}</td><td className="whitespace-nowrap border-b border-r border-[#ebeef5] px-3 py-3">{formatDate(row.updatedAt)}</td>
              </tr>)}
              {!settlements.length && <tr><td className="py-12 text-center text-[#909399]" colSpan={15}>{loading ? "加载中..." : "暂无结差来源单"}</td></tr>}
            </tbody></table></StickyTable>
            <PaginationBar page={settlementPage} pageSize={settlementPageSize} total={settlementTotal} onPageChange={(next) => void loadSettlements(next)} onPageSizeChange={(next) => void loadSettlements(1, next)} />
          </Panel>
          {detail && <SettlementDetailPanel detail={detail} saving={saving} onClose={() => setDetail(null)} onConfirm={() => void confirmSettlement()} onVoid={() => void voidSettlement()} />}
        </>
      )}

      {showFormula && <InstanceFormulaDialog onClose={() => setShowFormula(false)} />}
    </div>
  );
}

function SettlementDetailPanel({ detail, saving, onClose, onConfirm, onVoid }: { detail: SettlementDetail; saving: boolean; onClose: () => void; onConfirm: () => void; onVoid: () => void }) {
  const hasNonInstanceItems = detail.items.some((item) => asText(item.itemType) === "非实例费用");
  const columns = hasNonInstanceItems ? [...DETAIL_TABLE_COLUMNS, ...NON_INSTANCE_DETAIL_TABLE_COLUMNS] : DETAIL_TABLE_COLUMNS;
  return <Panel className="overflow-hidden"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#ebeef5] p-4"><div><div className="flex items-center gap-2"><h2 className="font-medium text-[#303133]">结差单：{detail.master.settlementNo}</h2><span className={`rounded px-2 py-1 text-xs ${statusClass(detail.master.status)}`}>{asText(detail.master.status)}</span></div><p className="mt-1 text-sm text-[#909399]">{asText(detail.master.title)} · 锚定版本：{asText(detail.master.pricingVersionNo) || "手工结差"} · 创建日期：{formatDate(detail.master.createdAt)}</p></div><div className="flex flex-wrap gap-2"><Button onClick={() => exportRows(DETAIL_EXPORT_COLUMNS, detail.items, `${detail.master.settlementNo}-明细.xlsx`, "结差明细")}><Download size={15} />导出明细</Button>{detail.master.status === DRAFT && <Button tone="danger" disabled={saving} onClick={onVoid}><XCircle size={15} />作废草稿</Button>}{detail.master.status === DRAFT && <Button tone="success" disabled={saving} onClick={onConfirm}><CheckCircle2 size={15} />确认结差单</Button>}<Button onClick={onClose}>关闭</Button></div></div><div className="grid gap-px border-b border-[#ebeef5] bg-[#ebeef5] sm:grid-cols-4"><Metric label="明细数量" value={asNumber(detail.master.itemCount)} /><Metric label="CAPEX结差总额" value={formatMoney(detail.master.capexDifferenceTotal)} negative={isNegative(detail.master.capexDifferenceTotal)} /><Metric label="OPEX结差总额" value={formatMoney(detail.master.opexDifferenceTotal)} negative={isNegative(detail.master.opexDifferenceTotal)} /><Metric label="结差合计" value={formatMoney(detail.master.differenceTotal)} negative={isNegative(detail.master.differenceTotal)} /></div><StickyTable className="table-scroll overflow-auto" tableKey={`balance-settlement-detail-${detail.master.settlementNo}`}><table className={`w-full min-w-[${hasNonInstanceItems ? "3600" : "2360"}px] border-collapse text-sm`}><thead className="bg-[#f5f7fa]"><tr>{columns.map(([key, label]) => <th className="whitespace-nowrap border-b border-r border-[#ebeef5] px-3 py-3 text-left font-medium" key={key}>{label}</th>)}</tr></thead><tbody>{detail.items.map((item) => <tr key={asText(item.id)}>{columns.map(([key, , kind]) => <td className={`whitespace-nowrap border-b border-r border-[#ebeef5] px-3 py-3 ${key.toLowerCase().includes("difference") && isNegative(item[key]) ? "text-[#f56c6c]" : ""}`} key={key}>{formatValue(item[key], kind as "money" | "date" | "number")}</td>)}</tr>)}</tbody></table></StickyTable></Panel>;
}

function InstanceFormulaDialog({ onClose }: { onClose: () => void }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4" role="dialog" aria-modal="true"><div className="max-h-[85vh] w-full max-w-2xl overflow-auto border border-[#dcdfe6] bg-white shadow-xl"><div className="flex items-center justify-between border-b border-[#ebeef5] p-4"><h2 className="font-medium text-[#303133]">实例结差计算逻辑</h2><button className="text-[#909399] hover:text-[#303133]" onClick={onClose} title="关闭"><XCircle size={20} /></button></div><div className="space-y-4 p-5 text-sm leading-7 text-[#606266]"><section><h3 className="font-medium text-[#303133]">实例 CAPEX/OPEX 结差</h3><pre className="mt-2 overflow-auto border border-[#ebeef5] bg-[#f8fafc] p-3 font-mono text-xs text-[#303133]">结差 CAPEX 单价 = 采购 CAPEX 单价 / 结差汇率 - CAPEX 锚定单价{`\n`}结差 CAPEX 总额 = 结差 CAPEX 单价 × 数量{`\n`}{`\n`}结差 OPEX 单价 = 采购 OPEX 单价 / 结差汇率 - OPEX 锚定单价{`\n`}结差 OPEX 总额 = 结差 OPEX 单价 × 数量{`\n`}{`\n`}结差合计 = 结差 CAPEX 总额 + 结差 OPEX 总额</pre><p className="mt-2">结差汇率定义为“采购币种 / USD”。采购币种为 USD 时系统固定使用 1；其他币种必须在生成草稿前录入汇率。OPEX 为 0 是有效采购数据。</p></section><section><h3 className="font-medium text-[#303133]">快照与来源确认</h3><p>生成草稿时，系统写入采购价格、锚定版本、锚定单价、汇率及计算结果快照。实例、备件和非实例费用的草稿均在“结差来源单”中统一确认；已确认来源单再由“结差结算单”汇总。</p></section><section><h3 className="font-medium text-[#303133]">非实例费用入口</h3><p>备件、清关费、跨境业务金融税、人力及行政成本和其他 OPEX 请在“非实例费用结差”模块中录入。</p></section></div><div className="flex justify-end border-t border-[#ebeef5] p-4"><Button tone="primary" onClick={onClose}>知道了</Button></div></div></div>;
}

function Metric({ label, value, negative = false }: { label: string; value: string | number; negative?: boolean }) { return <div className="bg-white px-4 py-3"><div className="text-xs text-[#909399]">{label}</div><div className={`mt-1 text-base font-medium ${negative ? "text-[#f56c6c]" : "text-[#303133]"}`}>{value}</div></div>; }

function FormulaDialog({ onClose }: { onClose: () => void }) { return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4" role="dialog" aria-modal="true"><div className="max-h-[85vh] w-full max-w-2xl overflow-auto border border-[#dcdfe6] bg-white shadow-xl"><div className="flex items-center justify-between border-b border-[#ebeef5] p-4"><h2 className="font-medium text-[#303133]">结差计算逻辑</h2><button className="text-[#909399] hover:text-[#303133]" onClick={onClose} title="关闭"><XCircle size={20} /></button></div><div className="space-y-4 p-5 text-sm leading-7 text-[#606266]"><section><h3 className="font-medium text-[#303133]">实例 CAPEX/OPEX 结差</h3><pre className="mt-2 overflow-auto border border-[#ebeef5] bg-[#f8fafc] p-3 font-mono text-xs text-[#303133]">结差 CAPEX 单价 = 采购 CAPEX 单价 / 结差汇率 - CAPEX 锚定单价{`\n`}结差 CAPEX 总额 = 结差 CAPEX 单价 × 数量{`\n`}{`\n`}结差 OPEX 单价 = 采购 OPEX 单价 / 结差汇率 - OPEX 锚定单价{`\n`}结差 OPEX 总额 = 结差 OPEX 单价 × 数量{`\n`}{`\n`}结差合计 = 结差 CAPEX 总额 + 结差 OPEX 总额</pre><p className="mt-2">结差汇率定义为“采购币种 / USD”。采购币种为 USD 时系统固定使用 1；其他币种必须在生成草稿前录入汇率。OPEX 为 0 是有效采购数据。</p></section><section><h3 className="font-medium text-[#303133]">快照与锁定</h3><p>生成草稿时，系统写入采购价格、锚定版本、锚定单价、汇率及全部计算结果快照。确认后不再跟随采购订单或锚定价格版本修改；草稿作废后对应采购明细会释放回待生成清单。</p></section><section><h3 className="font-medium text-[#303133]">备件与非实例费用</h3><p>可手工录入或导入历史 Excel。未设置锚定价时，锚定单价按 0 计算，因此结差等于换算后的采购金额；若存在对比锚定价，可在模板中一起填写。</p></section></div><div className="flex justify-end border-t border-[#ebeef5] p-4"><Button tone="primary" onClick={onClose}>知道了</Button></div></div></div>; }
