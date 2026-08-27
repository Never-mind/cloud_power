"use client";

import { useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { Download, FileUp, ListChecks, Plus, Trash2, X } from "lucide-react";
import { exportRowsToXlsx } from "@/lib/client-xlsx-export";
import {
  calculateNonInstanceLine,
  createBlankNonInstanceSettlementLine,
  importNonInstanceSettlementRows,
  NON_INSTANCE_EXPENSE_TYPES,
  NON_INSTANCE_SETTLEMENT_CURRENCIES,
  nonInstanceSettlementColumns,
  validateNonInstanceLine,
  type NonInstanceExpenseLine,
  type NonInstanceImportFailure,
} from "@/lib/non-instance-settlement-import";
import { Button, Input, Panel, Textarea } from "./ui";
import { StickyTable } from "./sticky-table";

type Country = { code: string; nameZh?: string };
type Line = NonInstanceExpenseLine;

function formatCalculatedValue(value: string | number | undefined) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "-";
}

function applyLineCalculation(expenseType: string, line: Line) {
  const cleared = Object.fromEntries(
    nonInstanceSettlementColumns(expenseType)
      .filter((field) => field.derived)
      .map((field) => [field.key, ""]),
  );
  const calculation = calculateNonInstanceLine(expenseType, line);
  return {
    ...line,
    ...cleared,
    ...Object.fromEntries(Object.entries(calculation.values).map(([key, value]) => [key, String(value)])),
  };
}

async function postManual(body: unknown) {
  const response = await fetch("/api/balance-settlements/manual", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? "非实例费用结差草稿生成失败");
  return data;
}

export function NonInstanceSettlementPage({ countries }: { countries: Country[] }) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [expenseType, setExpenseType] = useState<string>(NON_INSTANCE_EXPENSE_TYPES[0]);
  const [countryCode, setCountryCode] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [title, setTitle] = useState("");
  const [sourceFileName, setSourceFileName] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([createBlankNonInstanceSettlementLine(expenseType)]);
  const [saving, setSaving] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importFailures, setImportFailures] = useState<NonInstanceImportFailure[]>([]);
  const [importTotal, setImportTotal] = useState(0);
  const [importedCount, setImportedCount] = useState(0);
  const [importFileName, setImportFileName] = useState("");
  const fields = useMemo(() => nonInstanceSettlementColumns(expenseType), [expenseType]);
  const calculationFormula = useMemo(() => calculateNonInstanceLine(expenseType, {}).formula, [expenseType]);

  function changeType(value: string) {
    setExpenseType(value);
    setLines([createBlankNonInstanceSettlementLine(value)]);
  }

  function updateLine(index: number, key: string, value: string) {
    setLines((current) => current.map((line, lineIndex) => lineIndex === index
      ? applyLineCalculation(expenseType, { ...line, [key]: value })
      : line));
  }

  async function saveDraft() {
    if (!countryCode || !periodStart || !periodEnd) return alert("请先填写国家和结差期间");
    if (!lines.length) return alert("请至少新增一条明细");
    const preparedLines = lines.map((line) => applyLineCalculation(expenseType, line));
    const invalid = preparedLines
      .map((line, index) => ({ index: index + 1, errors: validateNonInstanceLine(expenseType, line) }))
      .find((result) => result.errors.length);
    if (invalid) return alert(`第 ${invalid.index} 条明细：${invalid.errors[0]}`);
    setSaving(true);
    try {
      setLines(preparedLines);
      await postManual({ title, countryCode, currency, sourceFileName, notes, periodStart, periodEnd, items: preparedLines.map((line) => ({ ...line, itemType: "非实例费用", countryCode, settlementCurrency: currency })) });
      alert("非实例费用结差草稿已生成，可在结差来源单中确认");
      setLines([createBlankNonInstanceSettlementLine(expenseType)]);
      setTitle("");
      setSourceFileName("");
      setNotes("");
    } catch (error) {
      alert(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  function downloadTemplate() {
    exportRowsToXlsx({
      fileName: `${expenseType}-导入模板.xlsx`,
      sheetName: expenseType.slice(0, 31),
      columns: fields.filter((field) => !field.derived).map((field) => ({ key: field.key, label: field.label })),
      rows: [createBlankNonInstanceSettlementLine(expenseType)],
    });
  }

  function exportCurrentLines() {
    exportRowsToXlsx({
      fileName: `${expenseType}-明细.xlsx`,
      sheetName: expenseType.slice(0, 31),
      columns: fields.map((field) => ({ key: field.key, label: field.label })),
      rows: lines,
    });
  }

  async function importFile(file: File) {
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array", cellDates: false });
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      if (!worksheet) throw new Error("未找到可读取的工作表");
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: "", raw: false });
      const result = importNonInstanceSettlementRows(expenseType, rows);
      setImportTotal(rows.length);
      setImportedCount(result.lines.length);
      setImportFailures(result.failures);
      setImportFileName(file.name);
      if (result.lines.length) {
        setLines(result.lines);
        setSourceFileName(file.name);
      }
    } catch (error) {
      alert(error instanceof Error ? error.message : "文件读取失败");
    }
  }

  function downloadImportErrors() {
    exportRowsToXlsx({
      fileName: `${expenseType}-导入错误报告.xlsx`,
      sheetName: "错误报告",
      columns: [{ key: "rowNumber", label: "Excel行号" }, { key: "error", label: "错误原因" }],
      rows: importFailures,
    });
  }

  return <Panel className="overflow-hidden">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#ebeef5] p-4"><div><h1 className="font-medium text-[#303133]">非实例费用结差</h1><p className="mt-1 text-sm text-[#909399]">先形成已确认的来源单，再由“结差结算单”统一汇集实例与非实例费用。</p></div><div className="flex flex-wrap gap-2"><Button onClick={downloadTemplate}><Download size={15} />下载模板</Button><Button onClick={() => { setImportOpen(true); setImportFailures([]); setImportTotal(0); setImportedCount(0); }}><FileUp size={15} />导入明细</Button><Button onClick={exportCurrentLines}><Download size={15} />导出明细</Button><Button tone="primary" disabled={saving} onClick={() => void saveDraft()}><ListChecks size={15} />保存草稿</Button></div></div>
    <div className="grid gap-3 border-b border-[#ebeef5] p-4 md:grid-cols-2 xl:grid-cols-4"><Input placeholder="结差单名称" value={title} onChange={(event) => setTitle(event.target.value)} /><select className="h-9 rounded border border-[#dcdfe6] bg-white px-2 text-sm" value={countryCode} onChange={(event) => setCountryCode(event.target.value)}><option value="">选择国家</option>{countries.map((country) => <option key={country.code} value={country.code}>{country.code} {country.nameZh ? `- ${country.nameZh}` : ""}</option>)}</select><select className="h-9 rounded border border-[#dcdfe6] bg-white px-2 text-sm" value={currency} onChange={(event) => setCurrency(event.target.value)}>{NON_INSTANCE_SETTLEMENT_CURRENCIES.map((item) => <option key={item} value={item}>{item}</option>)}</select><Input placeholder="来源文件名（可选）" value={sourceFileName} onChange={(event) => setSourceFileName(event.target.value)} /><label className="grid gap-1 text-xs text-[#606266]"><span>结差期间开始</span><Input type="date" value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} /></label><label className="grid gap-1 text-xs text-[#606266]"><span>结差期间结束</span><Input type="date" value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} /></label><label className="grid gap-1 text-xs text-[#606266] xl:col-span-2"><span>备注</span><Textarea className="min-h-9" value={notes} onChange={(event) => setNotes(event.target.value)} /></label></div>
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#ebeef5] p-4"><div><h2 className="font-medium text-[#303133]">明细类型</h2><p className="mt-1 text-sm text-[#909399]">同一张来源单使用同一类字段，后续可与其他类型来源单一起汇总。</p><p className="mt-1 max-w-4xl text-xs text-[#606266]">{calculationFormula}</p></div><select className="h-9 min-w-[210px] rounded border border-[#dcdfe6] bg-white px-2 text-sm" value={expenseType} onChange={(event) => changeType(event.target.value)}>{NON_INSTANCE_EXPENSE_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}</select></div>
    <StickyTable className="table-scroll overflow-auto" tableKey="non-instance-settlement-lines"><table className="w-full min-w-[1900px] border-collapse text-sm"><thead className="bg-[#f5f7fa]"><tr>{fields.map((field) => <th className="whitespace-nowrap border-b border-r border-[#ebeef5] px-3 py-3 text-left font-medium" key={field.key}>{field.label}{field.required ? <span className="ml-1 text-[#f56c6c]">*</span> : null}</th>)}<th className="whitespace-nowrap border-b border-r border-[#ebeef5] px-3 py-3 text-left font-medium">操作</th></tr></thead><tbody>{lines.map((line, index) => <tr key={index}>{fields.map((field) => <td className="border-b border-r border-[#ebeef5] px-2 py-2" key={field.key}>{field.derived ? <div className="flex h-8 min-w-[130px] items-center rounded border border-[#e4e7ed] bg-[#f5f7fa] px-2 text-[#606266]">{formatCalculatedValue(line[field.key])}</div> : field.key === "feeCurrency" || field.key === "priceConfirmation" || field.key === "confirmationResult" || field.key === "differenceNature" ? <select className="h-8 min-w-[105px] rounded border border-[#dcdfe6] bg-white px-2" value={line[field.key]} onChange={(event) => updateLine(index, field.key, event.target.value)}>{(field.key === "feeCurrency" ? NON_INSTANCE_SETTLEMENT_CURRENCIES : field.key === "differenceNature" ? ["CAPEX", "OPEX"] : ["YES", "NO"]).map((value) => <option value={value} key={value}>{value}</option>)}</select> : <input className="h-8 min-w-[110px] rounded border border-[#dcdfe6] px-2" inputMode={field.kind === "number" || field.kind === "percentage" ? "decimal" : undefined} min={field.kind === "number" || field.kind === "percentage" ? "0" : undefined} placeholder={field.kind === "percentage" ? "如 16 表示16%" : undefined} step={field.kind === "percentage" ? "0.01" : field.kind === "number" ? "0.0001" : undefined} type={field.kind === "date" ? "date" : field.kind === "number" || field.kind === "percentage" ? "number" : "text"} value={line[field.key]} onChange={(event) => updateLine(index, field.key, event.target.value)} />}</td>)}<td className="border-b border-r border-[#ebeef5] px-2 py-2"><button className="text-[#f56c6c]" aria-label="删除明细" onClick={() => setLines((current) => current.filter((_, lineIndex) => lineIndex !== index))}><Trash2 size={17} /></button></td></tr>)}</tbody></table></StickyTable>
    <div className="flex flex-wrap items-center gap-2 p-4"><Button onClick={() => setLines((current) => [...current, createBlankNonInstanceSettlementLine(expenseType)])}><Plus size={15} />新增明细</Button><span className="text-xs text-[#909399]">带 * 的字段为必填；灰底字段由系统实时计算，导入时也会重新计算。</span></div>
    {importOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4"><div className="max-h-[85vh] w-full max-w-3xl overflow-auto bg-white shadow-xl"><div className="flex items-center justify-between border-b border-[#ebeef5] px-5 py-4"><div><h2 className="font-medium text-[#303133]">导入{expenseType}明细</h2><p className="mt-1 text-sm text-[#909399]">先下载当前类型模板；上传后只填入页面，点击“保存草稿”才写入数据库。</p></div><button aria-label="关闭导入窗口" className="text-[#909399] hover:text-[#303133]" onClick={() => setImportOpen(false)}><X size={20} /></button></div><div className="space-y-4 p-5"><div className="flex flex-wrap gap-2"><Button onClick={downloadTemplate}><Download size={15} />下载当前模板</Button><Button tone="primary" onClick={() => fileInputRef.current?.click()}><FileUp size={15} />选择 Excel 文件</Button><input accept=".xlsx,.xls,.csv" className="hidden" ref={fileInputRef} type="file" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void importFile(file); }} /></div>{importFileName && <div className="border border-[#ebeef5] bg-[#fafafa] px-3 py-2 text-sm text-[#606266]">文件：{importFileName}。共读取 {importTotal} 行，成功填入 {importedCount} 行，失败 {importFailures.length} 行。</div>}{importFailures.length > 0 && <div className="overflow-auto border border-[#fde2e2]"><div className="flex items-center justify-between bg-[#fef0f0] px-3 py-2 text-sm text-[#f56c6c]"><span>以下行未填入页面，请修正后重新导入。</span><Button className="h-7" onClick={downloadImportErrors}><Download size={14} />下载错误报告</Button></div><table className="w-full border-collapse text-sm"><thead className="bg-[#f5f7fa]"><tr><th className="border-b border-r border-[#ebeef5] px-3 py-2 text-left">Excel行号</th><th className="border-b border-[#ebeef5] px-3 py-2 text-left">错误原因</th></tr></thead><tbody>{importFailures.map((failure) => <tr key={`${failure.rowNumber}-${failure.error}`}><td className="border-b border-r border-[#ebeef5] px-3 py-2">{failure.rowNumber}</td><td className="border-b border-[#ebeef5] px-3 py-2">{failure.error}</td></tr>)}</tbody></table></div>}<div className="flex justify-end"><Button onClick={() => setImportOpen(false)}>{importedCount ? "完成并查看明细" : "关闭"}</Button></div></div></div></div>}
  </Panel>;
}
