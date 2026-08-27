"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { CheckCircle2, ChevronLeft, Download, FileUp, Plus, RefreshCw, Search, X } from "lucide-react";
import { exportRowsToXlsx } from "@/lib/client-xlsx-export";
import { fetchAllEntityRows } from "@/lib/client-entity-fetch";
import { formatDisplayValue } from "@/lib/display-format";
import { fetchTableFilterOptions } from "@/lib/table-query-client";
import { PaginationBar } from "./pagination-bar";
import { StickyTable } from "./sticky-table";
import { TableColumnMenu, type TableSortOrder } from "./table-column-menu";
import { Button, Input, Panel, Textarea } from "./ui";

type Country = { code: string; nameZh?: string; nameEn?: string };
type InstanceModel = { deviceCode: string; modelCode?: string; nameZh?: string; nameEn?: string; b6Type?: string };
type B6Rule = {
  b6Type: string;
  alias?: string;
  scope?: string;
  fundingCostIncluded?: boolean;
  spareCostIncluded?: boolean;
  defaultFundingMonths?: number | null;
  defaultSpareOccupancyMonths?: number | null;
  overseasSpareServiceAvailable?: boolean | null;
  defaultSpareRate?: number | null;
  spareSettlementMethod?: string;
  slPricingInstruction?: string;
  notes?: string;
};
type PricingVersion = Record<string, unknown> & {
  versionId: string;
  versionNo: string;
  countryCode: string;
  effectiveDate: string;
  status: string;
  sourceFileName?: string;
  notes?: string;
  itemCount?: number;
  createdAt?: string;
  updatedAt?: string;
};
type PricingItem = Record<string, unknown> & { id: string; lineNo: number; deviceCode: string; b6Type: string };
type PricingDetail = { version: PricingVersion; rows: PricingItem[]; total: number; page: number; pageSize: number; totalPages: number };
type CalculationData = { item: PricingItem & { countryCode: string; versionNo: string; effectiveDate: string }; history: PricingItem[] };
type Defaults = {
  priceCurrency: string;
  contractCurrency: string;
  exchangeRate: number;
  deviceVatRate: number;
  serviceVatRate: number;
  brazilServiceTaxRate: number;
  onsiteRmaRate: number;
  fundingAnnualRate: number;
  fundingMonths: number;
  transportClearanceRate: number;
  handlingRate: number;
  otherTaxRate: number;
  spareOccupancyMonths: number | null;
  overseasSpareServiceAvailable: boolean | null;
  spareRate: number | null;
  spareSettlementMethod: string;
  requiresFundingMonthsInput: boolean;
  b6Rule: B6Rule;
};
type EditableLine = {
  id?: string;
  deviceCode: string;
  b6Type: string;
  priceCurrency: string;
  contractCurrency: string;
  baseCapexPrice: number | string;
  exchangeRate: number | string;
  deviceVatRate: number | string;
  serviceVatRate: number | string;
  brazilServiceTaxRate: number | string;
  onsiteRmaRate: number | string;
  fundingAnnualRate: number | string;
  fundingMonths: number | string;
  transportClearanceRate: number | string;
  handlingRate: number | string;
  otherTaxRate: number | string;
  spareOccupancyMonths: number | string;
  overseasSpareServiceAvailable: boolean | "";
  spareRate: number | string;
  spareSettlementMethod: string;
};
type EditorState = {
  versionId?: string;
  versionNo: string;
  countryCode: string;
  effectiveDate: string;
  sourceFileName: string;
  notes: string;
  lines: EditableLine[];
};

const CURRENCIES = ["CNY", "USD", "MXN", "CLP", "BRL"];
const DETAIL_PAGE_SIZE = 20;
const CAPEX_PRICING_TEMPLATE_COLUMNS = [
  ["deviceCode", "设备编码"], ["b6Type", "B6类型"], ["baseCapexPrice", "整机价格（不含VAT）"],
  ["priceCurrency", "整机价格币种"], ["contractCurrency", "SL合同币种"], ["exchangeRate", "整机价转合同汇率"],
  ["deviceVatRate", "当地设备VAT（%）"], ["serviceVatRate", "当地服务VAT（%）"], ["onsiteRmaRate", "Onsite+RMA费率（%）"],
  ["fundingAnnualRate", "资金占用年利率（%）"], ["fundingMonths", "资金占用月数"], ["transportClearanceRate", "运保清关费率（%）"],
  ["handlingRate", "总代过手费率（%）"], ["otherTaxRate", "其他税费率（%）"], ["brazilServiceTaxRate", "巴西服务税率（%）"],
] as const;
const detailColumns = [
  ["lineNo", "序号", "number"], ["deviceCode", "设备编码"], ["modelCode", "机型"], ["nameEn", "实例型号（英文）"],
  ["b6Type", "B6类型"], ["fundingMonths", "资金占用月数", "number"], ["spareOccupancyMonths", "备件占用月数", "number"],
  ["overseasSpareServiceAvailable", "海外备件服务", "boolean"], ["spareRate", "备件费率（%）", "percentage"], ["spareSettlementMethod", "备件结算方式"],
  ["baseCapexPrice", "整机价格（不含VAT）", "money"], ["priceCurrency", "整机价格币种"], ["exchangeRate", "整机价转合同汇率", "number"],
  ["deviceVatRate", "当地设备VAT（%）", "percentage"], ["serviceVatRate", "当地服务VAT（%）", "percentage"],
  ["onsiteRmaRate", "Onsite/RMA费率（%）", "percentage"], ["fundingAnnualRate", "资金占用年利率（%）", "percentage"],
  ["transportClearanceRate", "运保清关费率（%）", "percentage"], ["handlingRate", "总代过手费率（%）", "percentage"],
  ["otherTaxRate", "其他税费率（%）", "percentage"], ["brazilServiceTaxRate", "巴西服务税率（%）", "percentage"],
  ["contractCurrency", "SL合同币种"], ["capexAnchorUsd", "CAPEX锚定（USD）", "money"], ["opexAnchorUsd", "OPEX锚定（USD）", "money"],
] as const;

function formatDate(value: unknown) {
  return String(value ?? "").slice(0, 10);
}

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function blankLine(defaults?: Partial<Defaults>): EditableLine {
  return {
    deviceCode: "",
    b6Type: "B62-A7",
    priceCurrency: defaults?.priceCurrency ?? "CNY",
    contractCurrency: defaults?.contractCurrency ?? "USD",
    baseCapexPrice: "",
    exchangeRate: defaults?.exchangeRate ?? 0.1476642241,
    deviceVatRate: defaults?.deviceVatRate ?? 0,
    serviceVatRate: defaults?.serviceVatRate ?? 0,
    brazilServiceTaxRate: defaults?.brazilServiceTaxRate ?? 0,
    onsiteRmaRate: defaults?.onsiteRmaRate ?? 0,
    fundingAnnualRate: defaults?.fundingAnnualRate ?? 0.04,
    fundingMonths: defaults?.requiresFundingMonthsInput ? "" : defaults?.fundingMonths ?? 0,
    transportClearanceRate: defaults?.transportClearanceRate ?? 0.02,
    handlingRate: defaults?.handlingRate ?? 0,
    otherTaxRate: defaults?.otherTaxRate ?? 0,
    spareOccupancyMonths: defaults?.spareOccupancyMonths ?? "",
    overseasSpareServiceAvailable: defaults?.overseasSpareServiceAvailable ?? "",
    spareRate: defaults?.spareRate ?? "",
    spareSettlementMethod: defaults?.spareSettlementMethod ?? "",
  };
}

function lineFromItem(item: PricingItem): EditableLine {
  return {
    id: item.id,
    deviceCode: String(item.deviceCode ?? ""), b6Type: String(item.b6Type ?? "B62-A7"),
    priceCurrency: String(item.priceCurrency ?? "CNY"), contractCurrency: String(item.contractCurrency ?? "USD"),
    baseCapexPrice: numberValue(item.baseCapexPrice), exchangeRate: numberValue(item.exchangeRate),
    deviceVatRate: numberValue(item.deviceVatRate), serviceVatRate: numberValue(item.serviceVatRate),
    brazilServiceTaxRate: numberValue(item.brazilServiceTaxRate), onsiteRmaRate: numberValue(item.onsiteRmaRate),
    fundingAnnualRate: numberValue(item.fundingAnnualRate), fundingMonths: numberValue(item.fundingMonths),
    transportClearanceRate: numberValue(item.transportClearanceRate), handlingRate: numberValue(item.handlingRate), otherTaxRate: numberValue(item.otherTaxRate),
    spareOccupancyMonths: item.spareOccupancyMonths === null || item.spareOccupancyMonths === undefined ? "" : numberValue(item.spareOccupancyMonths),
    overseasSpareServiceAvailable: item.overseasSpareServiceAvailable === null || item.overseasSpareServiceAvailable === undefined ? "" : Boolean(item.overseasSpareServiceAvailable),
    spareRate: item.spareRate === null || item.spareRate === undefined ? "" : numberValue(item.spareRate),
    spareSettlementMethod: String(item.spareSettlementMethod ?? ""),
  };
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? "请求失败");
  return payload as T;
}

function percentageInput(value: number | string) {
  if (value === "") return "";
  const percentage = Number(value) * 100;
  return String(Math.round(percentage * 1000000) / 1000000);
}

function parsePercentage(value: string) {
  if (!value.trim()) return "";
  return numberValue(value) / 100;
}

function optionalImportedPercentage(row: Record<string, unknown>, currentLabel: string, previousLabel: string, key: string) {
  if (Object.prototype.hasOwnProperty.call(row, currentLabel)) {
    const percentage = optionalImportedNumber(row[currentLabel] ?? row[key]);
    return percentage === "" ? "" : Number(percentage) / 100;
  }
  return optionalImportedNumber(row[previousLabel] ?? row[key]);
}

function optionalImportedNumber(value: unknown) {
  return String(value ?? "").trim() === "" ? "" : numberValue(value);
}

export function CapexPricingPage() {
  const importRef = useRef<HTMLInputElement>(null);
  const [versions, setVersions] = useState<PricingVersion[]>([]);
  const [countries, setCountries] = useState<Country[]>([]);
  const [models, setModels] = useState<InstanceModel[]>([]);
  const [b6Rules, setB6Rules] = useState<B6Rule[]>([]);
  const [detail, setDetail] = useState<PricingDetail | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [calculation, setCalculation] = useState<CalculationData | null>(null);
  const [keyword, setKeyword] = useState("");
  const [countryFilter, setCountryFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [detailKeyword, setDetailKeyword] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [versionPage, setVersionPage] = useState(1);
  const [versionPageSize, setVersionPageSize] = useState(20);
  const [versionTotal, setVersionTotal] = useState(0);
  const versionPageSizeRef = useRef(versionPageSize);
  const [versionSortField, setVersionSortField] = useState("");
  const [versionSortOrder, setVersionSortOrder] = useState<TableSortOrder>("");
  const [versionFilters, setVersionFilters] = useState<Record<string, string[]>>({});

  const countryOptions = useMemo(() => {
    const fallback: Country[] = ["BR", "MX", "CL"].map((code) => ({ code }));
    return countries.length ? countries : fallback;
  }, [countries]);

  async function loadVersions(nextPage = versionPage, nextPageSize = versionPageSizeRef.current, queryState = { sortField: versionSortField, sortOrder: versionSortOrder, filters: versionFilters }) {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (keyword.trim()) params.set("keyword", keyword.trim());
      if (countryFilter) params.set("countryCode", countryFilter);
      if (statusFilter) params.set("status", statusFilter);
      params.set("page", String(nextPage));
      params.set("pageSize", String(nextPageSize));
      if (queryState.sortField && queryState.sortOrder) { params.set("sortField", queryState.sortField); params.set("sortOrder", queryState.sortOrder); }
      for (const [field, values] of Object.entries(queryState.filters)) for (const value of values) params.append(`filter.${field}`, value);
      const data = await fetchJson<{ rows: PricingVersion[]; total: number; page: number }>(`/api/capex-pricing/versions?${params.toString()}`);
      setVersions(data.rows ?? []);
      setVersionTotal(Number(data.total ?? 0));
      setVersionPage(Number(data.page ?? nextPage));
    } catch (error) {
      alert(error instanceof Error ? error.message : "价格版本加载失败");
    } finally {
      setLoading(false);
    }
  }

  function updateVersionQuery(key: string, next: { order?: TableSortOrder; values?: string[] }) {
    const state = { sortField: next.order !== undefined ? (next.order ? key : "") : versionSortField, sortOrder: next.order ?? versionSortOrder, filters: next.values ? { ...versionFilters, [key]: next.values } : versionFilters };
    setVersionSortField(state.sortField); setVersionSortOrder(state.sortOrder); setVersionFilters(state.filters); setVersionPage(1); void loadVersions(1, versionPageSizeRef.current, state);
  }

  function versionMenu(key: string, label: string, type?: string) {
    return <TableColumnMenu
      column={{ key, label, type, sortable: true, filterable: true }}
      sortOrder={versionSortField === key ? versionSortOrder : ""}
      filterValues={versionFilters[key] ?? []}
      loadOptions={(optionKeyword) => fetchTableFilterOptions("/api/capex-pricing/versions", key, optionKeyword, {}, versionFilters)}
      onSort={(order) => updateVersionQuery(key, { order })}
      onFilter={(values) => updateVersionQuery(key, { values })}
    />;
  }

  async function loadDetail(versionId: string, page = 1, pageSize = DETAIL_PAGE_SIZE, nextKeyword = detailKeyword) {
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (nextKeyword.trim()) params.set("keyword", nextKeyword.trim());
      const data = await fetchJson<PricingDetail>(`/api/capex-pricing/versions/${encodeURIComponent(versionId)}?${params.toString()}`);
      setDetail(data);
      setEditor(null);
    } catch (error) {
      alert(error instanceof Error ? error.message : "价格版本明细加载失败");
    }
  }

  useEffect(() => {
    void Promise.all([
      loadVersions(),
      fetchAllEntityRows<Country>("countries").then(setCountries),
      fetchAllEntityRows<InstanceModel>("instance-models").then(setModels),
      fetchJson<{ rows: B6Rule[] }>("/api/capex-pricing/b6-types").then((data) => setB6Rules(data.rows ?? [])),
    ]);
  }, []);

  async function getDefaults(countryCode: string, b6Type: string) {
    return fetchJson<Defaults>(`/api/capex-pricing/defaults?countryCode=${encodeURIComponent(countryCode)}&b6Type=${encodeURIComponent(b6Type)}`);
  }

  async function startCreate() {
    const countryCode = countryOptions[0]?.code ?? "BR";
    try {
      const defaults = await getDefaults(countryCode, "B62-A7");
      setEditor({
        versionNo: `${new Date().getFullYear()}.${String(new Date().getMonth() + 1).padStart(2, "0")} 刷价 V1`,
        countryCode,
        effectiveDate: new Date().toISOString().slice(0, 10),
        sourceFileName: "",
        notes: "",
        lines: [blankLine(defaults)],
      });
      setDetail(null);
    } catch (error) {
      alert(error instanceof Error ? error.message : "默认参数加载失败");
    }
  }

  function startEdit() {
    if (!detail) return;
    setEditor({
      versionId: detail.version.versionId,
      versionNo: String(detail.version.versionNo ?? ""),
      countryCode: String(detail.version.countryCode ?? ""),
      effectiveDate: formatDate(detail.version.effectiveDate),
      sourceFileName: String(detail.version.sourceFileName ?? ""),
      notes: String(detail.version.notes ?? ""),
      lines: detail.rows.map(lineFromItem),
    });
  }

  function updateEditor(field: keyof Omit<EditorState, "lines" | "versionId">, value: string) {
    setEditor((current) => current ? { ...current, [field]: value } : current);
  }

  function updateLine(index: number, field: keyof EditableLine, value: string | number | boolean) {
    setEditor((current) => {
      if (!current) return current;
      const lines = current.lines.map((line, lineIndex) => lineIndex === index ? { ...line, [field]: value } : line);
      return { ...current, lines };
    });
  }

  async function updateDeviceCode(index: number, deviceCode: string) {
    updateLine(index, "deviceCode", deviceCode);
    const b6Type = models.find((model) => model.deviceCode.trim() === deviceCode.trim())?.b6Type?.trim();
    if (b6Type) await applyDefaults(index, b6Type, deviceCode);
  }

  async function addLine() {
    if (!editor) return;
    try {
      const defaults = await getDefaults(editor.countryCode, "B62-A7");
      setEditor((current) => current ? { ...current, lines: [...current.lines, blankLine(defaults)] } : current);
    } catch (error) {
      alert(error instanceof Error ? error.message : "默认参数加载失败");
    }
  }

  async function applyDefaults(index: number, requestedB6Type?: string, selectedDeviceCode?: string) {
    if (!editor) return;
    const line = editor.lines[index];
    try {
      const defaults = await getDefaults(editor.countryCode, requestedB6Type || line.b6Type || b6Rules[0]?.b6Type || "B62-A7");
      setEditor((current) => {
        if (!current) return current;
        const lines = current.lines.map((currentLine, lineIndex) => lineIndex === index ? {
          ...currentLine,
          deviceCode: selectedDeviceCode ?? currentLine.deviceCode,
          b6Type: defaults.b6Rule.b6Type,
          onsiteRmaRate: defaults.onsiteRmaRate,
          fundingAnnualRate: defaults.fundingAnnualRate,
          fundingMonths: defaults.requiresFundingMonthsInput ? "" : defaults.fundingMonths,
          spareOccupancyMonths: defaults.spareOccupancyMonths ?? "",
          overseasSpareServiceAvailable: defaults.overseasSpareServiceAvailable === null ? "" as const : defaults.overseasSpareServiceAvailable,
          spareRate: defaults.spareRate ?? "",
          spareSettlementMethod: defaults.spareSettlementMethod,
        } : currentLine);
        return { ...current, lines };
      });
    } catch (error) {
      alert(error instanceof Error ? error.message : "默认参数加载失败");
    }
  }

  function removeLine(index: number) {
    setEditor((current) => current ? { ...current, lines: current.lines.filter((_, lineIndex) => lineIndex !== index) } : current);
  }

  async function saveEditor(confirmAfterSave = false) {
    if (!editor) return;
    setSaving(true);
    try {
      const endpoint = editor.versionId ? `/api/capex-pricing/versions/${encodeURIComponent(editor.versionId)}` : "/api/capex-pricing/versions";
      const data = await fetchJson<PricingDetail>(endpoint, {
        method: editor.versionId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...editor, items: editor.lines }),
      });
      const versionId = String(data.version.versionId);
      if (confirmAfterSave) {
        await fetchJson(`/api/capex-pricing/versions/${encodeURIComponent(versionId)}/confirm`, { method: "POST" });
      }
      await Promise.all([loadVersions(), loadDetail(versionId)]);
      setEditor(null);
    } catch (error) {
      alert(error instanceof Error ? error.message : "保存价格版本失败");
    } finally {
      setSaving(false);
    }
  }

  async function confirmDetail() {
    if (!detail || detail.version.status !== "草稿") return;
    if (!confirm("确认后该价格版本与计算参数将锁定，是否确认？")) return;
    setSaving(true);
    try {
      await fetchJson(`/api/capex-pricing/versions/${encodeURIComponent(detail.version.versionId)}/confirm`, { method: "POST" });
      await Promise.all([loadVersions(), loadDetail(detail.version.versionId, detail.page, detail.pageSize)]);
    } catch (error) {
      alert(error instanceof Error ? error.message : "确认价格版本失败");
    } finally {
      setSaving(false);
    }
  }

  async function cloneDetail() {
    if (!detail) return;
    const versionNo = window.prompt("新价格版本号", `${String(detail.version.versionNo)} 副本`);
    if (!versionNo?.trim()) return;
    const effectiveDate = window.prompt("新版本生效日期", formatDate(detail.version.effectiveDate));
    if (!effectiveDate?.trim()) return;
    try {
      const data = await fetchJson<PricingDetail>(`/api/capex-pricing/versions/${encodeURIComponent(detail.version.versionId)}/clone`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ versionNo, effectiveDate }),
      });
      await loadVersions();
      setDetail(data);
      startEditFromDetail(data);
    } catch (error) {
      alert(error instanceof Error ? error.message : "复制价格版本失败");
    }
  }

  function startEditFromDetail(nextDetail: PricingDetail) {
    setEditor({
      versionId: nextDetail.version.versionId,
      versionNo: String(nextDetail.version.versionNo ?? ""),
      countryCode: String(nextDetail.version.countryCode ?? ""),
      effectiveDate: formatDate(nextDetail.version.effectiveDate),
      sourceFileName: String(nextDetail.version.sourceFileName ?? ""),
      notes: String(nextDetail.version.notes ?? ""),
      lines: nextDetail.rows.map(lineFromItem),
    });
  }

  async function openCalculation(item: PricingItem) {
    if (!detail) return;
    try {
      const data = await fetchJson<CalculationData>(`/api/capex-pricing/versions/${encodeURIComponent(detail.version.versionId)}/calculation/${encodeURIComponent(item.id)}`);
      setCalculation(data);
    } catch (error) {
      alert(error instanceof Error ? error.message : "计算逻辑加载失败");
    }
  }

  async function exportCurrentVersion() {
    if (!detail) return;
    try {
      const rows: PricingItem[] = [];
      for (let page = 1; page <= detail.totalPages; page += 1) {
        const data = await fetchJson<PricingDetail>(`/api/capex-pricing/versions/${encodeURIComponent(detail.version.versionId)}?page=${page}&pageSize=100&keyword=${encodeURIComponent(detailKeyword)}`);
        rows.push(...data.rows);
      }
      exportRowsToXlsx({
        fileName: `${detail.version.versionNo}-${detail.version.countryCode}-CAPEX-OPEX锚定价格.xlsx`,
        sheetName: "价格明细",
        columns: [
          ...detailColumns.map(([key, label, type]) => ({ key, label, format: (value: unknown) => formatDisplayValue(value as string | number | null, type) })),
          { key: "capexTotal", label: "CAPEX合计" }, { key: "ddpPrice", label: "DDP价格" },
          { key: "opexAmount", label: "OPEX金额" }, { key: "rawCapexAnchorUsd", label: "原始CAPEX锚定（USD）" }, { key: "rawOpexAnchorUsd", label: "原始OPEX锚定（USD）" },
        ],
        rows,
      });
    } catch (error) {
      alert(error instanceof Error ? error.message : "导出失败");
    }
  }

  function downloadTemplate() {
    const columns = CAPEX_PRICING_TEMPLATE_COLUMNS.map(([key, label]) => ({ key, label }));
    exportRowsToXlsx({
      fileName: "CAPEX-OPEX锚定价格明细导入模板.xlsx",
      sheetName: "价格明细",
      columns,
      rows: [{ deviceCode: "", b6Type: "B62-A7", baseCapexPrice: "", priceCurrency: "CNY", contractCurrency: "USD", exchangeRate: 0.1476642241, deviceVatRate: "", serviceVatRate: "", onsiteRmaRate: 0, fundingAnnualRate: 4, fundingMonths: 0, transportClearanceRate: 2, handlingRate: 0, otherTaxRate: 0, brazilServiceTaxRate: 0 }],
    });
  }

  async function importLines(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !editor) return;
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const sourceRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
      const imported = sourceRows.map((row) => ({
        deviceCode: String(row["设备编码"] ?? row.deviceCode ?? "").trim(),
        b6Type: String(row["B6类型"] ?? row.b6Type ?? "").trim(),
        baseCapexPrice: optionalImportedNumber(row["整机价格（不含VAT）"] ?? row.baseCapexPrice),
        priceCurrency: String(row["整机价格币种"] ?? row.priceCurrency ?? "CNY").trim(),
        contractCurrency: String(row["SL合同币种"] ?? row.contractCurrency ?? "USD").trim(),
        exchangeRate: optionalImportedNumber(row["整机价转合同汇率"] ?? row.exchangeRate),
        deviceVatRate: optionalImportedPercentage(row, "当地设备VAT（%）", "当地设备VAT", "deviceVatRate"),
        serviceVatRate: optionalImportedPercentage(row, "当地服务VAT（%）", "当地服务VAT", "serviceVatRate"),
        onsiteRmaRate: optionalImportedPercentage(row, "Onsite+RMA费率（%）", "Onsite+RMA费率", "onsiteRmaRate"),
        fundingAnnualRate: optionalImportedPercentage(row, "资金占用年利率（%）", "资金占用年利率", "fundingAnnualRate"),
        fundingMonths: optionalImportedNumber(row["资金占用月数"] ?? row.fundingMonths),
        transportClearanceRate: optionalImportedPercentage(row, "运保清关费率（%）", "运保清关费率", "transportClearanceRate"),
        handlingRate: optionalImportedPercentage(row, "总代过手费率（%）", "总代过手费率", "handlingRate"),
        otherTaxRate: optionalImportedPercentage(row, "其他税费率（%）", "其他税费率", "otherTaxRate"),
        brazilServiceTaxRate: optionalImportedPercentage(row, "巴西服务税率（%）", "巴西服务税率", "brazilServiceTaxRate"),
      })).filter((line) => line.deviceCode);
      if (!imported.length) throw new Error("导入文件未找到有效的设备编码");
      const lines = imported.map((line) => ({
        ...line,
        b6Type: line.b6Type || models.find((model) => model.deviceCode.trim() === line.deviceCode)?.b6Type?.trim() || "",
        spareOccupancyMonths: "",
        overseasSpareServiceAvailable: "" as const,
        spareRate: "",
        spareSettlementMethod: "",
      }));
      const missingB6Types = lines.filter((line) => !line.b6Type).map((line) => line.deviceCode);
      if (missingB6Types.length) throw new Error(`以下设备未填写B6类型，且实例型号未维护默认B6类型：${missingB6Types.slice(0, 10).join("、")}`);
      setEditor((current) => current ? { ...current, lines } : current);
      alert(`已读取 ${imported.length} 条明细，请检查后保存草稿。`);
    } catch (error) {
      alert(error instanceof Error ? error.message : "导入失败");
    } finally {
      event.target.value = "";
    }
  }

  const visibleTitle = editor ? (editor.versionId ? "编辑价格版本" : "新建价格版本") : detail ? "版本详情" : "价格版本";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-medium text-[#303133]">CAPEX/OPEX锚定价格</h1>
          <p className="mt-1 text-sm text-[#909399]">按国家和价格版本维护锚定价格，确认后锁定完整计算参数与结果。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!editor ? <Button onClick={downloadTemplate}><Download size={15} />下载导入模板</Button> : null}
          {!editor ? <Button tone="primary" onClick={() => void startCreate()}><Plus size={15} />新建价格版本</Button> : null}
        </div>
      </div>

      {editor ? (
        <PricingEditor
          countries={countryOptions}
          b6Rules={b6Rules}
          editor={editor}
          importRef={importRef}
          models={models}
          saving={saving}
          onAddLine={() => void addLine()}
          onApplyDefaults={(index, b6Type) => void applyDefaults(index, b6Type)}
          onCancel={() => { setEditor(null); }}
          onChange={updateEditor}
          onConfirm={() => void saveEditor(true)}
          onImport={() => importRef.current?.click()}
          onRemoveLine={removeLine}
          onSave={() => void saveEditor()}
          onUpdateLine={updateLine}
          onUpdateDeviceCode={(index, deviceCode) => void updateDeviceCode(index, deviceCode)}
          onUpload={importLines}
        />
      ) : detail ? (
        <PricingDetailView
          detail={detail}
          detailKeyword={detailKeyword}
          saving={saving}
          onBack={() => { setDetail(null); setDetailKeyword(""); }}
          onClone={() => void cloneDetail()}
          onConfirm={() => void confirmDetail()}
          onEdit={startEdit}
          onExport={() => void exportCurrentVersion()}
          onOpenCalculation={(item) => void openCalculation(item)}
          onPageChange={(page) => void loadDetail(detail.version.versionId, page, detail.pageSize)}
          onPageSizeChange={(pageSize) => void loadDetail(detail.version.versionId, 1, pageSize)}
          onSearch={(value) => { setDetailKeyword(value); void loadDetail(detail.version.versionId, 1, detail.pageSize, value); }}
        />
      ) : (
        <Panel>
          <div className="flex flex-wrap items-end gap-2 border-b border-[#ebeef5] p-4">
            <label className="grid gap-1 text-xs text-[#606266]">国家<select className="h-9 min-w-[130px] rounded border border-[#dcdfe6] bg-white px-3 text-sm" value={countryFilter} onChange={(event) => setCountryFilter(event.target.value)}><option value="">全部</option>{countryOptions.map((country) => <option key={country.code} value={country.code}>{country.code} {country.nameZh ? `- ${country.nameZh}` : ""}</option>)}</select></label>
            <label className="grid gap-1 text-xs text-[#606266]">状态<select className="h-9 min-w-[110px] rounded border border-[#dcdfe6] bg-white px-3 text-sm" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">全部</option><option value="草稿">草稿</option><option value="已确认">已确认</option><option value="已废止">已废止</option></select></label>
            <Input placeholder="搜索版本号或来源文件" value={keyword} onChange={(event) => setKeyword(event.target.value)} />
            <Button tone="primary" onClick={() => void loadVersions()}><Search size={15} />查询</Button>
            <Button onClick={() => void loadVersions()}><RefreshCw size={15} />刷新</Button>
          </div>
          <StickyTable className="table-scroll overflow-auto" tableKey="capex-pricing-versions"><table className="min-w-[1280px] border-collapse text-sm"><thead className="bg-[#f5f7fa] text-[#303133]"><tr>{[["versionNo", "价格版本"], ["countryCode", "国家"], ["effectiveDate", "生效日期", "date"], ["status", "状态"], ["itemCount", "明细数量", "number"], ["sourceFileName", "来源文件"], ["confirmedAt", "确认日期", "date"], ["createdAt", "创建日期", "date"], ["updatedAt", "更新日期", "date"]].map(([key, label, type]) => <th className="whitespace-nowrap border-b border-r border-[#ebeef5] px-3 py-3 text-left font-medium" key={key}>{versionMenu(key, label, type)}</th>)}<th className="border-b border-[#ebeef5] px-3 py-3 text-left font-medium">操作</th></tr></thead><tbody>{versions.map((version) => <tr className="hover:bg-[#fafafa]" key={version.versionId}><td className="border-b border-r border-[#ebeef5] px-3 py-3">{version.versionNo}</td><td className="border-b border-r border-[#ebeef5] px-3 py-3">{version.countryCode}</td><td className="border-b border-r border-[#ebeef5] px-3 py-3">{formatDate(version.effectiveDate)}</td><td className="border-b border-r border-[#ebeef5] px-3 py-3"><StatusTag status={String(version.status ?? "")} /></td><td className="border-b border-r border-[#ebeef5] px-3 py-3 text-right">{formatDisplayValue(version.itemCount as number, "number")}</td><td className="border-b border-r border-[#ebeef5] px-3 py-3">{String(version.sourceFileName ?? "-")}</td><td className="border-b border-r border-[#ebeef5] px-3 py-3">{formatDate(version.confirmedAt)}</td><td className="border-b border-r border-[#ebeef5] px-3 py-3">{formatDate(version.createdAt)}</td><td className="border-b border-r border-[#ebeef5] px-3 py-3">{formatDate(version.updatedAt)}</td><td className="border-b border-[#ebeef5] px-3 py-3"><button className="text-[#1890ff] hover:underline" type="button" onClick={() => void loadDetail(version.versionId)}>查看明细</button></td></tr>)}{!versions.length ? <tr><td className="py-12 text-center text-[#909399]" colSpan={10}>{loading ? "加载中..." : "无数据"}</td></tr> : null}</tbody></table></StickyTable>
        </Panel>
      )}

      {!editor && !detail ? <PaginationBar page={versionPage} pageSize={versionPageSize} total={versionTotal} onPageChange={(next) => { setVersionPage(next); void loadVersions(next, versionPageSizeRef.current); }} onPageSizeChange={(next) => { versionPageSizeRef.current = next; setVersionPageSize(next); setVersionPage(1); void loadVersions(1, next); }} /> : null}
      {calculation ? <CalculationDialog data={calculation} onClose={() => setCalculation(null)} /> : null}
      <div className="text-sm text-[#909399]">当前视图：{visibleTitle}</div>
    </div>
  );
}

function StatusTag({ status }: { status: string }) {
  const colors: Record<string, string> = { 草稿: "bg-[#fff7e6] text-[#e6a23c]", 已确认: "bg-[#f0f9eb] text-[#67c23a]", 已废止: "bg-[#fef0f0] text-[#f56c6c]" };
  return <span className={`rounded px-2 py-1 text-xs ${colors[status] ?? "bg-[#f4f4f5] text-[#909399]"}`}>{status || "-"}</span>;
}

function PricingEditor({
  editor, countries, models, b6Rules, saving, importRef, onChange, onUpdateLine, onUpdateDeviceCode, onAddLine, onRemoveLine, onApplyDefaults, onImport, onUpload, onSave, onConfirm, onCancel,
}: {
  editor: EditorState; countries: Country[]; models: InstanceModel[]; b6Rules: B6Rule[]; saving: boolean; importRef: React.RefObject<HTMLInputElement | null>;
  onChange: (field: keyof Omit<EditorState, "lines" | "versionId">, value: string) => void; onUpdateLine: (index: number, field: keyof EditableLine, value: string | number | boolean) => void; onUpdateDeviceCode: (index: number, deviceCode: string) => void;
  onAddLine: () => void; onRemoveLine: (index: number) => void; onApplyDefaults: (index: number, b6Type?: string) => void; onImport: () => void; onUpload: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onSave: () => void; onConfirm: () => void; onCancel: () => void;
}) {
  return <Panel><div className="border-b border-[#ebeef5] p-4"><div className="mb-4 flex flex-wrap items-center justify-between gap-2"><div className="font-medium text-[#303133]">{editor.versionId ? "编辑价格版本草稿" : "新建价格版本"}</div><div className="flex gap-2"><Button onClick={onCancel}>取消</Button><Button disabled={saving} onClick={onSave}>保存草稿</Button><Button disabled={saving} tone="success" onClick={onConfirm}><CheckCircle2 size={15} />保存并确认</Button></div></div><div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4"><EditorField label="价格版本号"><Input value={editor.versionNo} onChange={(event) => onChange("versionNo", event.target.value)} /></EditorField><EditorField label="国家"><select className="h-9 rounded border border-[#dcdfe6] bg-white px-3 text-sm" value={editor.countryCode} onChange={(event) => onChange("countryCode", event.target.value)}>{countries.map((country) => <option key={country.code} value={country.code}>{country.code} {country.nameZh ? `- ${country.nameZh}` : ""}</option>)}</select></EditorField><EditorField label="生效日期"><Input type="date" value={editor.effectiveDate} onChange={(event) => onChange("effectiveDate", event.target.value)} /></EditorField><EditorField label="来源文件"><Input value={editor.sourceFileName} onChange={(event) => onChange("sourceFileName", event.target.value)} /></EditorField></div><div className="mt-3"><EditorField label="备注"><Textarea className="w-full" value={editor.notes} onChange={(event) => onChange("notes", event.target.value)} /></EditorField></div></div><div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#ebeef5] p-4"><div className="text-sm text-[#606266]">价格明细：{editor.lines.length} 条</div><div className="flex flex-wrap gap-2"><input accept=".xlsx,.xls" className="hidden" ref={importRef} type="file" onChange={onUpload} /><Button onClick={onImport}><FileUp size={15} />导入明细</Button><Button tone="primary" onClick={onAddLine}><Plus size={15} />新增明细</Button></div></div><StickyTable className="table-scroll overflow-auto" tableKey="capex-pricing-editor-lines"><table className="min-w-[2700px] border-collapse text-sm"><thead className="bg-[#f5f7fa]"><tr>{["设备编码", "B6类型", "整机价格（不含VAT）", "整机价格币种", "合同币种", "换算汇率", "设备VAT（%）", "服务VAT（%）", "Onsite/RMA（%）", "资金年利率（%）", "资金月数", "备件占用月数", "海外备件服务", "备件费率（%）", "备件结算方式", "运保清关（%）", "总代过手（%）", "其他税费（%）", "巴西服务税（%）", "操作"].map((label) => <th className="whitespace-nowrap border-b border-r border-[#ebeef5] px-3 py-3 text-left font-medium" key={label}>{label}</th>)}</tr></thead><tbody>{editor.lines.map((line, index) => <PricingEditorRow key={`${line.id ?? "new"}-${index}`} line={line} index={index} models={models} b6Rules={b6Rules} onUpdateLine={onUpdateLine} onUpdateDeviceCode={onUpdateDeviceCode} onApplyDefaults={onApplyDefaults} onRemoveLine={onRemoveLine} />)}{!editor.lines.length ? <tr><td className="py-10 text-center text-[#909399]" colSpan={20}>请新增或导入价格明细</td></tr> : null}</tbody></table><datalist id="capex-pricing-device-codes">{models.map((model) => <option key={model.deviceCode} value={model.deviceCode}>{model.modelCode} / {model.nameEn}{model.b6Type ? ` / ${model.b6Type}` : ""}</option>)}</datalist><datalist id="capex-pricing-b6-types">{b6Rules.map((rule) => <option key={rule.b6Type} value={rule.b6Type}>{rule.alias ? `${rule.alias} / ${rule.scope ?? ""}` : rule.scope}</option>)}</datalist></StickyTable></Panel>;
}

function PricingEditorRow({ line, index, models, b6Rules, onUpdateLine, onUpdateDeviceCode, onApplyDefaults, onRemoveLine }: { line: EditableLine; index: number; models: InstanceModel[]; b6Rules: B6Rule[]; onUpdateLine: (index: number, field: keyof EditableLine, value: string | number | boolean) => void; onUpdateDeviceCode: (index: number, deviceCode: string) => void; onApplyDefaults: (index: number, b6Type?: string) => void; onRemoveLine: (index: number) => void }) {
  const rule = b6Rules.find((item) => item.b6Type === line.b6Type || item.alias === line.b6Type);
  const manualAdjusted = Boolean(rule && ((rule.defaultFundingMonths ?? 0) !== Number(line.fundingMonths || 0) || (rule.defaultSpareOccupancyMonths ?? "") !== line.spareOccupancyMonths || (rule.defaultSpareRate ?? "") !== line.spareRate || (rule.spareSettlementMethod ?? "") !== line.spareSettlementMethod));
  return <tr><td className="border-b border-r border-[#ebeef5] p-2"><Input className="min-w-[170px]" list="capex-pricing-device-codes" placeholder="输入或搜索编码" value={line.deviceCode} onChange={(event) => onUpdateDeviceCode(index, event.target.value)} /></td><td className="border-b border-r border-[#ebeef5] p-2"><div><Input className="min-w-[140px]" list="capex-pricing-b6-types" placeholder="选择或搜索B6类型" value={line.b6Type} onChange={(event) => onUpdateLine(index, "b6Type", event.target.value)} onBlur={() => { if (line.b6Type.trim()) onApplyDefaults(index, line.b6Type); }} />{rule ? <div className="mt-1 max-w-[180px] truncate text-xs text-[#909399]" title={`${rule.scope ?? ""} ${rule.notes ?? ""}`}>{manualAdjusted ? "人工调整" : rule.scope || "规则已套用"}</div> : <div className="mt-1 text-xs text-[#f56c6c]">未匹配规则</div>}</div></td><td className="border-b border-r border-[#ebeef5] p-2"><NumericInput value={line.baseCapexPrice} onChange={(value) => onUpdateLine(index, "baseCapexPrice", value)} /></td><td className="border-b border-r border-[#ebeef5] p-2"><CurrencySelect value={line.priceCurrency} onChange={(value) => onUpdateLine(index, "priceCurrency", value)} /></td><td className="border-b border-r border-[#ebeef5] p-2"><CurrencySelect value={line.contractCurrency} onChange={(value) => onUpdateLine(index, "contractCurrency", value)} /></td><td className="border-b border-r border-[#ebeef5] p-2"><NumericInput value={line.exchangeRate} onChange={(value) => onUpdateLine(index, "exchangeRate", value)} /></td><td className="border-b border-r border-[#ebeef5] p-2"><PercentageInput value={line.deviceVatRate} onChange={(value) => onUpdateLine(index, "deviceVatRate", value)} /></td><td className="border-b border-r border-[#ebeef5] p-2"><PercentageInput value={line.serviceVatRate} onChange={(value) => onUpdateLine(index, "serviceVatRate", value)} /></td><td className="border-b border-r border-[#ebeef5] p-2"><PercentageInput value={line.onsiteRmaRate} onChange={(value) => onUpdateLine(index, "onsiteRmaRate", value)} /></td><td className="border-b border-r border-[#ebeef5] p-2"><PercentageInput value={line.fundingAnnualRate} onChange={(value) => onUpdateLine(index, "fundingAnnualRate", value)} /></td><td className="border-b border-r border-[#ebeef5] p-2"><NumericInput value={line.fundingMonths} onChange={(value) => onUpdateLine(index, "fundingMonths", value)} /></td><td className="border-b border-r border-[#ebeef5] p-2"><NumericInput value={line.spareOccupancyMonths} onChange={(value) => onUpdateLine(index, "spareOccupancyMonths", value)} /></td><td className="border-b border-r border-[#ebeef5] p-2"><select className="h-9 min-w-[106px] rounded border border-[#dcdfe6] bg-white px-2 text-sm" value={line.overseasSpareServiceAvailable === "" ? "" : line.overseasSpareServiceAvailable ? "1" : "0"} onChange={(event) => onUpdateLine(index, "overseasSpareServiceAvailable", event.target.value === "" ? "" : event.target.value === "1")}><option value="">待确认</option><option value="1">提供</option><option value="0">不提供</option></select></td><td className="border-b border-r border-[#ebeef5] p-2"><PercentageInput value={line.spareRate} onChange={(value) => onUpdateLine(index, "spareRate", value)} /></td><td className="border-b border-r border-[#ebeef5] p-2"><Input className="min-w-[130px]" value={line.spareSettlementMethod} onChange={(event) => onUpdateLine(index, "spareSettlementMethod", event.target.value)} /></td><td className="border-b border-r border-[#ebeef5] p-2"><PercentageInput value={line.transportClearanceRate} onChange={(value) => onUpdateLine(index, "transportClearanceRate", value)} /></td><td className="border-b border-r border-[#ebeef5] p-2"><PercentageInput value={line.handlingRate} onChange={(value) => onUpdateLine(index, "handlingRate", value)} /></td><td className="border-b border-r border-[#ebeef5] p-2"><PercentageInput value={line.otherTaxRate} onChange={(value) => onUpdateLine(index, "otherTaxRate", value)} /></td><td className="border-b border-r border-[#ebeef5] p-2"><PercentageInput value={line.brazilServiceTaxRate} onChange={(value) => onUpdateLine(index, "brazilServiceTaxRate", value)} /></td><td className="border-b border-[#ebeef5] p-2"><div className="flex gap-2"><button className="text-[#1890ff] hover:underline" type="button" onClick={() => onApplyDefaults(index, line.b6Type)}>套用规则</button><button className="text-[#f56c6c] hover:underline" type="button" onClick={() => onRemoveLine(index)}>删除</button></div></td></tr>;
}

function PricingDetailView({ detail, detailKeyword, saving, onBack, onEdit, onConfirm, onClone, onExport, onOpenCalculation, onPageChange, onPageSizeChange, onSearch }: { detail: PricingDetail; detailKeyword: string; saving: boolean; onBack: () => void; onEdit: () => void; onConfirm: () => void; onClone: () => void; onExport: () => void; onOpenCalculation: (item: PricingItem) => void; onPageChange: (page: number) => void; onPageSizeChange: (pageSize: number) => void; onSearch: (value: string) => void }) {
  const editable = detail.version.status === "草稿";
  return <><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><button className="text-[#606266] hover:text-[#1890ff]" title="返回价格版本" type="button" onClick={onBack}><ChevronLeft size={21} /></button><div><div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-medium text-[#303133]">{detail.version.versionNo} · {detail.version.countryCode}</h2><StatusTag status={String(detail.version.status ?? "")} /></div><p className="mt-1 text-sm text-[#909399]">生效日期 {formatDate(detail.version.effectiveDate)} · 共 {detail.total} 条明细 · 确认后锁定</p></div></div><div className="flex flex-wrap gap-2"><Button onClick={onExport}><Download size={15} />导出全部明细</Button><Button onClick={onClone}>复制为新版本</Button>{editable ? <Button onClick={onEdit}>编辑草稿</Button> : null}{editable ? <Button disabled={saving} tone="success" onClick={onConfirm}><CheckCircle2 size={15} />确认版本</Button> : null}</div></div><Panel><div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#ebeef5] p-4"><span className="text-sm text-[#606266]">设备锚定价格明细</span><Input placeholder="搜索设备编码、机型、英文名称或B6类型" value={detailKeyword} onChange={(event) => onSearch(event.target.value)} /></div><StickyTable className="table-scroll overflow-auto" tableKey={`capex-pricing-detail-${detail.version.versionId}`}><table className="min-w-[1380px] border-collapse text-sm"><thead className="bg-[#f5f7fa] text-[#303133]"><tr>{detailColumns.map(([key, label]) => <th className="whitespace-nowrap border-b border-r border-[#ebeef5] px-3 py-3 text-left font-medium" key={key}>{label}</th>)}<th className="border-b border-[#ebeef5] px-3 py-3 text-left font-medium">操作</th></tr></thead><tbody>{detail.rows.map((row) => <tr className="hover:bg-[#fafafa]" key={row.id}>{detailColumns.map(([key, , type]) => <td className={`whitespace-nowrap border-b border-r border-[#ebeef5] px-3 py-3 ${type === "money" || type === "number" ? "text-right" : ""}`} key={key}>{formatDisplayValue(row[key] as string | number | null, type)}</td>)}<td className="border-b border-[#ebeef5] px-3 py-3"><button className="whitespace-nowrap text-[#1890ff] hover:underline" type="button" onClick={() => onOpenCalculation(row)}>查看计算逻辑</button></td></tr>)}{!detail.rows.length ? <tr><td className="py-12 text-center text-[#909399]" colSpan={detailColumns.length + 1}>无数据</td></tr> : null}</tbody></table></StickyTable><PaginationBar page={detail.page} pageSize={detail.pageSize} total={detail.total} onPageChange={onPageChange} onPageSizeChange={onPageSizeChange} /></Panel></>;
}

function CalculationDialog({ data, onClose }: { data: CalculationData; onClose: () => void }) {
  const item = data.item;
  const row = (label: string, formula: string, value: string | number, type: "money" | "percentage" | "number" = "money") => <tr key={label}><td className="border-b border-r border-[#ebeef5] px-3 py-3 font-medium">{label}</td><td className="border-b border-r border-[#ebeef5] px-3 py-3 font-mono text-xs text-[#606266]">{formula}</td><td className="border-b border-[#ebeef5] px-3 py-3 text-right">{typeof value === "string" ? value : formatDisplayValue(value, type)}</td></tr>;
  return <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-5" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="my-6 w-full max-w-5xl bg-white shadow-xl"><div className="flex items-center justify-between border-b border-[#ebeef5] px-5 py-4"><div><h2 className="text-lg font-medium text-[#303133]">计算逻辑 · {String(item.deviceCode ?? "")}</h2><p className="mt-1 text-sm text-[#909399]">{String(item.versionNo ?? "")} · {String(item.countryCode ?? "")} · {String(item.b6Type ?? "")} · {String(item.nameEn ?? "")}</p></div><button className="text-[#909399] hover:text-[#303133]" title="关闭" type="button" onClick={onClose}><X size={20} /></button></div><div className="grid gap-4 p-5 xl:grid-cols-3"><div className="xl:col-span-2"><div className="mb-2 text-sm font-medium text-[#303133]">参数与计算过程</div><div className="table-scroll overflow-auto"><table className="w-full min-w-[760px] border-collapse text-sm"><tbody>{row("整机价格", "手工录入", `${formatDisplayValue(item.baseCapexPrice as number, "money")} ${String(item.priceCurrency ?? "")}`, "money")}{row("资金占用比例", "资金占用年利率 × 资金占用月数 ÷ 12", numberValue(item.fundingRatio), "percentage")}{row("资金占用金额", "整机价格 × 资金占用比例", numberValue(item.fundingAmount))}{row("CAPEX 合计", "整机价格 × (1 + 资金占用比例 + Onsite/RMA费率)", numberValue(item.capexTotal))}{row("DDP价格", "CAPEX合计 × (1 + 运保清关费率) × (1 + 总代过手费率 + 其他税费率)", numberValue(item.ddpPrice))}{row("OPEX金额", "DDP价格 - CAPEX合计", numberValue(item.opexAmount))}{row("原始 CAPEX 锚定", "CAPEX合计 × 整机价转合同汇率", `${formatDisplayValue(item.rawCapexAnchorUsd as number, "money")} USD`)}{row("原始 OPEX 锚定", "OPEX金额 × 整机价转合同汇率", `${formatDisplayValue(item.rawOpexAnchorUsd as number, "money")} USD`)}{row("最终 CAPEX 锚定", item.countryCode === "BR" || item.countryCode === "巴西" ? "原始CAPEX锚定 ÷ (1 + 巴西服务税率)" : "原始CAPEX锚定", `${formatDisplayValue(item.capexAnchorUsd as number, "money")} USD`)}{row("最终 OPEX 锚定", item.countryCode === "BR" || item.countryCode === "巴西" ? "原始OPEX锚定 ÷ (1 + 巴西服务税率)" : "原始OPEX锚定", `${formatDisplayValue(item.opexAnchorUsd as number, "money")} USD`)}</tbody></table></div></div><div><div className="mb-2 text-sm font-medium text-[#303133]">取数快照</div><div className="space-y-2 border border-[#ebeef5] p-3 text-sm"><div><span className="text-[#909399]">实例型号</span><div>{String(item.modelCode ?? "")} / {String(item.nameEn ?? "")}</div></div><div><span className="text-[#909399]">设备 VAT</span><div>{formatDisplayValue(item.deviceVatRate as number, "percentage")}</div></div><div><span className="text-[#909399]">服务 VAT</span><div>{formatDisplayValue(item.serviceVatRate as number, "percentage")}</div></div><div><span className="text-[#909399]">巴西服务税率</span><div>{formatDisplayValue(item.brazilServiceTaxRate as number, "percentage")}</div></div><div><span className="text-[#909399]">来源</span><div>实例型号管理、国家管理、价格版本明细</div></div></div></div></div><div className="border-t border-[#ebeef5] p-5"><div className="mb-2 text-sm font-medium text-[#303133]">历史版本对比</div><div className="table-scroll overflow-auto"><table className="min-w-full border-collapse text-sm"><thead className="bg-[#f5f7fa]"><tr><th className="border-b border-r border-[#ebeef5] px-3 py-2 text-left">版本</th><th className="border-b border-r border-[#ebeef5] px-3 py-2 text-left">生效日期</th><th className="border-b border-r border-[#ebeef5] px-3 py-2 text-right">CAPEX锚定（USD）</th><th className="border-b border-[#ebeef5] px-3 py-2 text-right">OPEX锚定（USD）</th></tr></thead><tbody>{data.history.map((history) => <tr key={String(history.versionId)}><td className="border-b border-r border-[#ebeef5] px-3 py-2">{String(history.versionNo ?? "")}</td><td className="border-b border-r border-[#ebeef5] px-3 py-2">{formatDate(history.effectiveDate)}</td><td className="border-b border-r border-[#ebeef5] px-3 py-2 text-right">{formatDisplayValue(history.capexAnchorUsd as number, "money")}</td><td className="border-b border-[#ebeef5] px-3 py-2 text-right">{formatDisplayValue(history.opexAnchorUsd as number, "money")}</td></tr>)}{!data.history.length ? <tr><td className="py-8 text-center text-[#909399]" colSpan={4}>无历史版本数据</td></tr> : null}</tbody></table></div></div></div></div>;
}

function EditorField({ label, children }: { label: string; children: React.ReactNode }) { return <label className="grid gap-1 text-xs text-[#606266]"><span>{label}</span>{children}</label>; }
function NumericInput({ value, onChange }: { value: number | string; onChange: (value: number | string) => void }) { return <Input className="min-w-[112px]" type="number" value={value} onChange={(event) => onChange(event.target.value === "" ? "" : numberValue(event.target.value))} />; }
function PercentageInput({ value, onChange }: { value: number | string; onChange: (value: number | string) => void }) {
  return <div className="relative min-w-[108px]">
    <Input className="min-w-0 w-full pr-7 text-right" type="number" step="0.0001" value={percentageInput(value)} onChange={(event) => onChange(parsePercentage(event.target.value))} />
    <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-[#909399]">%</span>
  </div>;
}
function CurrencySelect({ value, onChange }: { value: string; onChange: (value: string) => void }) { return <select className="h-9 min-w-[82px] rounded border border-[#dcdfe6] bg-white px-2 text-sm" value={value} onChange={(event) => onChange(event.target.value)}>{CURRENCIES.map((currency) => <option key={currency} value={currency}>{currency}</option>)}</select>; }
