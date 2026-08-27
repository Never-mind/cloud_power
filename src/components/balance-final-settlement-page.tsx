"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Download, ListChecks, RefreshCw, Search, XCircle } from "lucide-react";
import { exportRowsToXlsx } from "@/lib/client-xlsx-export";
import { fetchAllEntityRows } from "@/lib/client-entity-fetch";
import { fetchTableFilterOptions } from "@/lib/table-query-client";
import { DEFAULT_PAGE_SIZE } from "@/lib/pagination";
import { PaginationBar } from "./pagination-bar";
import { StickyTable } from "./sticky-table";
import { TableColumnMenu, type TableSortOrder } from "./table-column-menu";
import { Button, Input, Panel, Textarea } from "./ui";

type Row = Record<string, unknown>;
type Country = { code: string; nameZh?: string; nameEn?: string };
type Source = Row & { settlementNo: string };
type FinalSettlement = Row & { finalSettlementNo: string; status?: string };
type FinalDetail = { master: FinalSettlement; sources: Source[] };

const DRAFT = "草稿";
const CONFIRMED = "已确认";
const VOIDED = "已作废";
const CURRENCIES = ["USD", "CNY", "BRL", "MXN", "CLP"];

function text(value: unknown) {
  return String(value ?? "").trim();
}

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: unknown) {
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(numberValue(value));
}

function dateValue(value: unknown) {
  return text(value).slice(0, 10);
}

function isNegative(value: unknown) {
  return numberValue(value) < 0;
}

function statusClass(status: unknown) {
  if (status === CONFIRMED) return "bg-[#f0f9eb] text-[#67c23a]";
  if (status === VOIDED) return "bg-[#f4f4f5] text-[#909399]";
  return "bg-[#ecf5ff] text-[#409eff]";
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? "请求失败");
  return payload as T;
}

export function BalanceFinalSettlementPage() {
  const [countries, setCountries] = useState<Country[]>([]);
  const [countryCode, setCountryCode] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [sources, setSources] = useState<Source[]>([]);
  const [selectedNos, setSelectedNos] = useState<string[]>([]);
  const [selectedSourcesByNo, setSelectedSourcesByNo] = useState<Record<string, Source>>({});
  const [finals, setFinals] = useState<FinalSettlement[]>([]);
  const [detail, setDetail] = useState<FinalDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sourcePage, setSourcePage] = useState(1); const [sourcePageSize, setSourcePageSize] = useState(DEFAULT_PAGE_SIZE); const [sourceTotal, setSourceTotal] = useState(0);
  const [finalPage, setFinalPage] = useState(1); const [finalPageSize, setFinalPageSize] = useState(DEFAULT_PAGE_SIZE); const [finalTotal, setFinalTotal] = useState(0);
  const [sourceSortField, setSourceSortField] = useState(""); const [sourceSortOrder, setSourceSortOrder] = useState<TableSortOrder>(""); const [sourceFilters, setSourceFilters] = useState<Record<string, string[]>>({});
  const [finalSortField, setFinalSortField] = useState(""); const [finalSortOrder, setFinalSortOrder] = useState<TableSortOrder>(""); const [finalFilters, setFinalFilters] = useState<Record<string, string[]>>({});

  const selectedSources = useMemo(
    () => Object.values(selectedSourcesByNo),
    [selectedSourcesByNo],
  );
  const selectedTotals = useMemo(() => selectedSources.reduce((total, source) => ({
    count: total.count + numberValue(source.itemCount),
    capex: total.capex + numberValue(source.capexDifferenceTotal),
    opex: total.opex + numberValue(source.opexDifferenceTotal),
    all: total.all + numberValue(source.differenceTotal),
  }), { count: 0, capex: 0, opex: 0, all: 0 }), [selectedSources]);

  async function loadFinals(page = finalPage, pageSize = finalPageSize, queryState = { sortField: finalSortField, sortOrder: finalSortOrder, filters: finalFilters }) {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (queryState.sortField && queryState.sortOrder) { params.set("sortField", queryState.sortField); params.set("sortOrder", queryState.sortOrder); }
    for (const [field, values] of Object.entries(queryState.filters)) for (const value of values) params.append(`filter.${field}`, value);
    const data = await fetchJson<{ rows: FinalSettlement[]; total: number; page: number; pageSize: number }>(`/api/balance-settlements/finals?${params}`);
    setFinals(data.rows ?? []);
    setFinalTotal(Number(data.total ?? 0)); setFinalPage(Number(data.page ?? page)); setFinalPageSize(Number(data.pageSize ?? pageSize));
  }

  useEffect(() => {
    void Promise.all([fetchAllEntityRows<Country>("countries"), loadFinals()])
      .then(([countryRows]) => setCountries(countryRows))
      .catch((error) => alert(error instanceof Error ? error.message : "结差结算单加载失败"));
  }, []);

  async function searchSources(page = sourcePage, pageSize = sourcePageSize, queryState = { sortField: sourceSortField, sortOrder: sourceSortOrder, filters: sourceFilters }) {
    if (!countryCode || !periodStart || !periodEnd) {
      alert("请先选择国家和完整的结差期间");
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams({ countryCode, currency, periodStart, periodEnd, page: String(page), pageSize: String(pageSize) });
      if (queryState.sortField && queryState.sortOrder) { params.set("sortField", queryState.sortField); params.set("sortOrder", queryState.sortOrder); }
      for (const [field, values] of Object.entries(queryState.filters)) for (const value of values) params.append(`filter.${field}`, value);
      const data = await fetchJson<{ rows: Source[]; total: number; page: number; pageSize: number }>(`/api/balance-settlements/finals/available?${params}`);
      setSources(data.rows ?? []);
      setSourceTotal(Number(data.total ?? 0)); setSourcePage(Number(data.page ?? page)); setSourcePageSize(Number(data.pageSize ?? pageSize));
      setSelectedSourcesByNo((current) => Object.assign({}, current, Object.fromEntries((data.rows ?? []).filter((row) => selectedNos.includes(text(row.settlementNo))).map((row) => [text(row.settlementNo), row]))));
    } catch (error) {
      alert(error instanceof Error ? error.message : "可汇总来源单加载失败");
    } finally {
      setLoading(false);
    }
  }

  function updateSourceQuery(key: string, next: { order?: TableSortOrder; values?: string[] }) { const state = { sortField: next.order !== undefined ? (next.order ? key : "") : sourceSortField, sortOrder: next.order ?? sourceSortOrder, filters: next.values ? { ...sourceFilters, [key]: next.values } : sourceFilters }; setSourceSortField(state.sortField); setSourceSortOrder(state.sortOrder); setSourceFilters(state.filters); setSourcePage(1); void searchSources(1, sourcePageSize, state); }
  function updateFinalQuery(key: string, next: { order?: TableSortOrder; values?: string[] }) { const state = { sortField: next.order !== undefined ? (next.order ? key : "") : finalSortField, sortOrder: next.order ?? finalSortOrder, filters: next.values ? { ...finalFilters, [key]: next.values } : finalFilters }; setFinalSortField(state.sortField); setFinalSortOrder(state.sortOrder); setFinalFilters(state.filters); setFinalPage(1); void loadFinals(1, finalPageSize, state); }

  async function createDraft() {
    if (!selectedNos.length) return alert("请至少选择一张结差来源单");
    setSaving(true);
    try {
      const data = await fetchJson<FinalDetail>("/api/balance-settlements/finals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, countryCode, currency, periodStart, periodEnd, notes, sourceSettlementNos: selectedNos }),
      });
      setDetail(data);
      setTitle("");
      setNotes("");
      setSources([]);
      setSelectedNos([]);
      setSelectedSourcesByNo({});
      await loadFinals(1);
      alert("结差结算草稿已生成，来源单已被保留");
    } catch (error) {
      alert(error instanceof Error ? error.message : "结差结算草稿生成失败");
    } finally {
      setSaving(false);
    }
  }

  async function openFinal(finalSettlementNo: string) {
    try {
      setDetail(await fetchJson<FinalDetail>(`/api/balance-settlements/finals/${encodeURIComponent(finalSettlementNo)}`));
    } catch (error) {
      alert(error instanceof Error ? error.message : "结差结算单明细加载失败");
    }
  }

  async function confirmFinal() {
    if (!detail || detail.master.status !== DRAFT) return;
    if (!confirm(`确认结差结算单 ${detail.master.finalSettlementNo} 吗？确认后将锁定来源快照。`)) return;
    setSaving(true);
    try {
      setDetail(await fetchJson<FinalDetail>(`/api/balance-settlements/finals/${encodeURIComponent(detail.master.finalSettlementNo)}/confirm`, { method: "POST" }));
      await loadFinals();
    } catch (error) {
      alert(error instanceof Error ? error.message : "确认失败");
    } finally {
      setSaving(false);
    }
  }

  async function voidFinal() {
    if (!detail || detail.master.status !== DRAFT) return;
    if (!confirm(`作废草稿 ${detail.master.finalSettlementNo} 吗？来源单会重新回到可汇总列表。`)) return;
    setSaving(true);
    try {
      setDetail(await fetchJson<FinalDetail>(`/api/balance-settlements/finals/${encodeURIComponent(detail.master.finalSettlementNo)}/void`, { method: "POST" }));
      await loadFinals();
      await searchSources();
    } catch (error) {
      alert(error instanceof Error ? error.message : "作废失败");
    } finally {
      setSaving(false);
    }
  }

  function exportFinals() {
    exportRowsToXlsx({
      fileName: "结差结算单.xlsx",
      sheetName: "结差结算单",
      columns: [
        ["finalSettlementNo", "结差结算单号"], ["title", "结算单名称"], ["countryCode", "国家"], ["currency", "结算币种"],
        ["periodStart", "结差期间开始"], ["periodEnd", "结差期间结束"], ["status", "状态"], ["sourceCount", "来源单数"],
        ["itemCount", "明细数量"], ["capexDifferenceTotal", "CAPEX结差总额"], ["opexDifferenceTotal", "OPEX结差总额"],
        ["differenceTotal", "结差合计"], ["notes", "备注"], ["confirmedAt", "确认日期"], ["createdAt", "创建日期"], ["updatedAt", "更新日期"],
      ].map(([key, label]) => ({ key, label, format: (value) => key.endsWith("At") || key.startsWith("period") ? dateValue(value) : value as string | number })),
      rows: finals,
    });
  }

  return <div className="space-y-4">
    <Panel className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#ebeef5] p-4">
        <div><h1 className="font-medium text-[#303133]">结差结算单</h1><p className="mt-1 text-sm text-[#909399]">汇集同国家、同结差期间、同币种的已确认实例结差与非实例费用结差。</p></div>
        <Button onClick={() => void loadFinals()}><RefreshCw size={15} />刷新列表</Button>
      </div>
      <div className="grid gap-3 border-b border-[#ebeef5] p-4 md:grid-cols-2 xl:grid-cols-4">
        <Input placeholder="结算单名称（可选）" value={title} onChange={(event) => setTitle(event.target.value)} />
        <select className="h-9 rounded border border-[#dcdfe6] bg-white px-2 text-sm" value={countryCode} onChange={(event) => { setCountryCode(event.target.value); setSources([]); setSelectedNos([]); }}><option value="">选择国家</option>{countries.map((country) => <option key={country.code} value={country.code}>{country.code} {country.nameZh ? `- ${country.nameZh}` : ""}</option>)}</select>
        <select className="h-9 rounded border border-[#dcdfe6] bg-white px-2 text-sm" value={currency} onChange={(event) => { setCurrency(event.target.value); setSources([]); setSelectedNos([]); }}>{CURRENCIES.map((item) => <option key={item} value={item}>{item}</option>)}</select>
        <Button tone="primary" onClick={() => { setSourcePage(1); void searchSources(1); }}><Search size={15} />查询可汇总来源单</Button>
        <label className="grid gap-1 text-xs text-[#606266]"><span>结差期间开始</span><Input type="date" value={periodStart} onChange={(event) => { setPeriodStart(event.target.value); setSources([]); }} /></label>
        <label className="grid gap-1 text-xs text-[#606266]"><span>结差期间结束</span><Input type="date" value={periodEnd} onChange={(event) => { setPeriodEnd(event.target.value); setSources([]); }} /></label>
        <Textarea className="min-h-9 xl:col-span-2" placeholder="备注（可选）" value={notes} onChange={(event) => setNotes(event.target.value)} />
      </div>
      <StickyTable className="table-scroll overflow-auto" tableKey="balance-final-sources">
        <table className="w-full min-w-[1400px] border-collapse text-sm"><thead className="bg-[#f5f7fa]"><tr>{[["", ""], ["settlementNo", "来源结差单号"], ["title", "名称"], ["itemTypes", "结差类型"], ["countryCode", "国家"], ["currency", "币种"], ["periodStart", "结差开始"], ["periodEnd", "结差结束"], ["itemCount", "明细数"], ["capexDifferenceTotal", "CAPEX结差"], ["opexDifferenceTotal", "OPEX结差"], ["differenceTotal", "结差合计"]].map(([key, label]) => <th className="whitespace-nowrap border-b border-r border-[#ebeef5] px-3 py-3 text-left font-medium" key={key || "select"}>{key ? <TableColumnMenu column={{ key, label, sortable: true, filterable: true }} sortOrder={sourceSortField === key ? sourceSortOrder : ""} filterValues={sourceFilters[key] ?? []} loadOptions={(keyword) => fetchTableFilterOptions("/api/balance-settlements/finals/available", key, keyword, { countryCode, currency, periodStart, periodEnd }, sourceFilters)} onSort={(order) => updateSourceQuery(key, { order })} onFilter={(values) => updateSourceQuery(key, { values })} /> : label}</th>)}</tr></thead><tbody>
          {sources.map((source) => <tr key={source.settlementNo} className="hover:bg-[#fafafa]"><td className="border-b border-r border-[#ebeef5] px-3 py-3"><input type="checkbox" checked={selectedNos.includes(source.settlementNo)} onChange={() => { const sourceNo = text(source.settlementNo); setSelectedNos((current) => current.includes(sourceNo) ? current.filter((value) => value !== sourceNo) : [...current, sourceNo]); setSelectedSourcesByNo((current) => { if (current[sourceNo]) { const { [sourceNo]: _removed, ...next } = current; return next; } return { ...current, [sourceNo]: source }; }); }} /></td><td className="whitespace-nowrap border-b border-r border-[#ebeef5] px-3 py-3 text-[#1890ff]">{source.settlementNo}</td><td className="max-w-[240px] truncate border-b border-r border-[#ebeef5] px-3 py-3">{text(source.title) || "-"}</td><td className="border-b border-r border-[#ebeef5] px-3 py-3">{text(source.itemTypes) || "-"}</td><td className="border-b border-r border-[#ebeef5] px-3 py-3">{text(source.countryCode)}</td><td className="border-b border-r border-[#ebeef5] px-3 py-3">{text(source.currency)}</td><td className="whitespace-nowrap border-b border-r border-[#ebeef5] px-3 py-3">{dateValue(source.periodStart)} 至 {dateValue(source.periodEnd)}</td><td className="border-b border-r border-[#ebeef5] px-3 py-3">{numberValue(source.itemCount)}</td>{["capexDifferenceTotal", "opexDifferenceTotal", "differenceTotal"].map((key) => <td className={`border-b border-r border-[#ebeef5] px-3 py-3 text-right ${isNegative(source[key]) ? "text-[#f56c6c]" : ""}`} key={key}>{money(source[key])}</td>)}</tr>)}
          {!sources.length && <tr><td colSpan={11} className="py-12 text-center text-[#909399]">{loading ? "加载中..." : "请先按国家、期间和币种查询可汇总的已确认来源单"}</td></tr>}
        </tbody></table>
      </StickyTable>
      <PaginationBar page={sourcePage} pageSize={sourcePageSize} total={sourceTotal} onPageChange={(next) => void searchSources(next)} onPageSizeChange={(next) => { setSourcePageSize(next); void searchSources(1, next); }} />
      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-[#ebeef5] p-4"><div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-[#606266]"><span>已选来源单：<b className="text-[#303133]">{selectedSources.length}</b></span><span>明细数量：<b className="text-[#303133]">{selectedTotals.count}</b></span><span>CAPEX：<b className={isNegative(selectedTotals.capex) ? "text-[#f56c6c]" : "text-[#303133]"}>{money(selectedTotals.capex)}</b></span><span>OPEX：<b className={isNegative(selectedTotals.opex) ? "text-[#f56c6c]" : "text-[#303133]"}>{money(selectedTotals.opex)}</b></span><span>合计：<b className={isNegative(selectedTotals.all) ? "text-[#f56c6c]" : "text-[#303133]"}>{money(selectedTotals.all)} {currency}</b></span></div><Button tone="primary" disabled={saving || !selectedNos.length} onClick={() => void createDraft()}><ListChecks size={15} />生成结算草稿</Button></div>
    </Panel>

    <Panel className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-[#ebeef5] p-4"><div><h2 className="font-medium text-[#303133]">结差结算单列表</h2><p className="mt-1 text-sm text-[#909399]">已确认结算单为最终汇总口径；草稿作废后会释放已占用的来源单。</p></div><Button onClick={exportFinals}><Download size={15} />导出</Button></div>
      <StickyTable className="table-scroll overflow-auto" tableKey="balance-final-settlements"><table className="w-full min-w-[1550px] border-collapse text-sm"><thead className="bg-[#f5f7fa]"><tr>{[["finalSettlementNo", "结算单号"], ["title", "名称"], ["countryCode", "国家"], ["currency", "币种"], ["periodStart", "结差开始"], ["periodEnd", "结差结束"], ["status", "状态"], ["sourceCount", "来源单数"], ["itemCount", "明细数"], ["capexDifferenceTotal", "CAPEX结差"], ["opexDifferenceTotal", "OPEX结差"], ["differenceTotal", "结差合计"], ["confirmedAt", "确认日期"], ["createdAt", "创建日期"], ["updatedAt", "更新日期"]].map(([key, label]) => <th className="whitespace-nowrap border-b border-r border-[#ebeef5] px-3 py-3 text-left font-medium" key={key}><TableColumnMenu column={{ key, label, sortable: true, filterable: true }} sortOrder={finalSortField === key ? finalSortOrder : ""} filterValues={finalFilters[key] ?? []} loadOptions={(keyword) => fetchTableFilterOptions("/api/balance-settlements/finals", key, keyword, {}, finalFilters)} onSort={(order) => updateFinalQuery(key, { order })} onFilter={(values) => updateFinalQuery(key, { values })} /></th>)}</tr></thead><tbody>{finals.map((row) => <tr key={row.finalSettlementNo} className="hover:bg-[#fafafa]"><td className="whitespace-nowrap border-b border-r border-[#ebeef5] px-3 py-3"><button className="text-[#1890ff] hover:underline" onClick={() => void openFinal(row.finalSettlementNo)}>{row.finalSettlementNo}</button></td><td className="max-w-[240px] truncate border-b border-r border-[#ebeef5] px-3 py-3">{text(row.title) || "-"}</td><td className="border-b border-r border-[#ebeef5] px-3 py-3">{text(row.countryCode)}</td><td className="border-b border-r border-[#ebeef5] px-3 py-3">{text(row.currency)}</td><td className="whitespace-nowrap border-b border-r border-[#ebeef5] px-3 py-3">{dateValue(row.periodStart)}</td><td className="whitespace-nowrap border-b border-r border-[#ebeef5] px-3 py-3">{dateValue(row.periodEnd)}</td><td className="border-b border-r border-[#ebeef5] px-3 py-3"><span className={`rounded px-2 py-1 text-xs ${statusClass(row.status)}`}>{text(row.status)}</span></td><td className="border-b border-r border-[#ebeef5] px-3 py-3">{numberValue(row.sourceCount)}</td><td className="border-b border-r border-[#ebeef5] px-3 py-3">{numberValue(row.itemCount)}</td>{["capexDifferenceTotal", "opexDifferenceTotal", "differenceTotal"].map((key) => <td className={`border-b border-r border-[#ebeef5] px-3 py-3 text-right ${isNegative(row[key]) ? "text-[#f56c6c]" : ""}`} key={key}>{money(row[key])}</td>)}<td className="whitespace-nowrap border-b border-r border-[#ebeef5] px-3 py-3">{dateValue(row.confirmedAt)}</td><td className="whitespace-nowrap border-b border-r border-[#ebeef5] px-3 py-3">{dateValue(row.createdAt)}</td><td className="whitespace-nowrap border-b border-r border-[#ebeef5] px-3 py-3">{dateValue(row.updatedAt)}</td></tr>)}{!finals.length && <tr><td colSpan={15} className="py-12 text-center text-[#909399]">暂无结差结算单</td></tr>}</tbody></table></StickyTable><PaginationBar page={finalPage} pageSize={finalPageSize} total={finalTotal} onPageChange={(next) => void loadFinals(next)} onPageSizeChange={(next) => { setFinalPageSize(next); void loadFinals(1, next); }} />
    </Panel>

    {detail && <FinalDetailPanel detail={detail} saving={saving} onClose={() => setDetail(null)} onConfirm={() => void confirmFinal()} onVoid={() => void voidFinal()} />}
  </div>;
}

function FinalDetailPanel({ detail, saving, onClose, onConfirm, onVoid }: { detail: FinalDetail; saving: boolean; onClose: () => void; onConfirm: () => void; onVoid: () => void }) {
  const master = detail.master;
  return <Panel className="overflow-hidden"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#ebeef5] p-4"><div><div className="flex items-center gap-2"><h2 className="font-medium text-[#303133]">结差结算单：{master.finalSettlementNo}</h2><span className={`rounded px-2 py-1 text-xs ${statusClass(master.status)}`}>{text(master.status)}</span></div><p className="mt-1 text-sm text-[#909399]">{text(master.countryCode)} · {dateValue(master.periodStart)} 至 {dateValue(master.periodEnd)} · {text(master.currency)}</p></div><div className="flex flex-wrap gap-2">{master.status === DRAFT && <Button tone="danger" disabled={saving} onClick={onVoid}><XCircle size={15} />作废草稿</Button>}{master.status === DRAFT && <Button tone="success" disabled={saving} onClick={onConfirm}><CheckCircle2 size={15} />确认结算单</Button>}<Button onClick={onClose}>关闭</Button></div></div><div className="grid gap-px border-b border-[#ebeef5] bg-[#ebeef5] sm:grid-cols-4"><Metric label="来源单数" value={numberValue(master.sourceCount)} /><Metric label="CAPEX结差总额" value={money(master.capexDifferenceTotal)} negative={isNegative(master.capexDifferenceTotal)} /><Metric label="OPEX结差总额" value={money(master.opexDifferenceTotal)} negative={isNegative(master.opexDifferenceTotal)} /><Metric label="结差合计" value={money(master.differenceTotal)} negative={isNegative(master.differenceTotal)} /></div><StickyTable className="table-scroll overflow-auto" tableKey={`balance-final-detail-${master.finalSettlementNo}`}><table className="w-full min-w-[1260px] border-collapse text-sm"><thead className="bg-[#f5f7fa]"><tr>{["来源结差单号", "名称", "结差类型", "国家", "币种", "期间", "明细数", "CAPEX结差", "OPEX结差", "结差合计"].map((label) => <th className="whitespace-nowrap border-b border-r border-[#ebeef5] px-3 py-3 text-left font-medium" key={label}>{label}</th>)}</tr></thead><tbody>{detail.sources.map((source) => <tr key={text(source.id)}><td className="whitespace-nowrap border-b border-r border-[#ebeef5] px-3 py-3 text-[#1890ff]">{text(source.sourceSettlementNo)}</td><td className="max-w-[240px] truncate border-b border-r border-[#ebeef5] px-3 py-3">{text(source.sourceTitle) || "-"}</td><td className="border-b border-r border-[#ebeef5] px-3 py-3">{text(source.sourceItemTypes) || "-"}</td><td className="border-b border-r border-[#ebeef5] px-3 py-3">{text(source.countryCode)}</td><td className="border-b border-r border-[#ebeef5] px-3 py-3">{text(source.currency)}</td><td className="whitespace-nowrap border-b border-r border-[#ebeef5] px-3 py-3">{dateValue(source.periodStart)} 至 {dateValue(source.periodEnd)}</td><td className="border-b border-r border-[#ebeef5] px-3 py-3">{numberValue(source.itemCount)}</td>{["capexDifferenceTotal", "opexDifferenceTotal", "differenceTotal"].map((key) => <td className={`border-b border-r border-[#ebeef5] px-3 py-3 text-right ${isNegative(source[key]) ? "text-[#f56c6c]" : ""}`} key={key}>{money(source[key])}</td>)}</tr>)}</tbody></table></StickyTable></Panel>;
}

function Metric({ label, value, negative = false }: { label: string; value: string | number; negative?: boolean }) {
  return <div className="bg-white px-4 py-3"><div className="text-xs text-[#909399]">{label}</div><div className={`mt-1 text-base font-medium ${negative ? "text-[#f56c6c]" : "text-[#303133]"}`}>{value}</div></div>;
}
