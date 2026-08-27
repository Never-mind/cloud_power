"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, CheckCircle2, Pencil, Plus, Save, Upload, X } from "lucide-react";
import { formatDateInputValue, formatDisplayValue } from "@/lib/display-format";
import { formatNumericInputValue, parseNumericInputValue } from "@/lib/numeric-input";
import { isConfirmedOrderStatus } from "@/lib/order-status";
import { buildRequestItemRows, type RequestDetailDraft } from "@/lib/request-order-form";
import { REQUEST_TYPE_OPTIONS } from "@/lib/request-type";
import { fetchAllEntityRows } from "@/lib/client-entity-fetch";
import { buildDetailRoute, getReturnTo } from "@/lib/client-list-navigation";
import { Button, Input, Panel } from "./ui";
import { StickyTable } from "./sticky-table";

type Row = Record<string, string | number | boolean | null>;

type MasterDraft = {
  requestNo: string;
  countryCode: string;
  contractNo: string;
  batchName: string;
  requestType: string;
  status: string;
  plannedDeliveryDate: string;
};

type DetailDraft = RequestDetailDraft;
type SaveMode = "draft" | "confirm";

type SearchOption = {
  value: string;
  label: string;
  keywords?: string;
};

const emptyMaster: MasterDraft = {
  requestNo: "",
  countryCode: "",
  contractNo: "",
  batchName: "",
  requestType: "整机",
  status: "草稿",
  plannedDeliveryDate: "",
};

const emptyDetail: DetailDraft = {
  deviceCode: "",
  supplierId: "",
  undertakingUnitId: "",
  customerId: "",
  quantity: 0,
};

export function RequestOrderFormPage({ requestNo }: { requestNo?: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = getReturnTo(searchParams.get("returnTo"), "/requests/orders");
  const fileRef = useRef<HTMLInputElement>(null);
  const [master, setMaster] = useState<MasterDraft>(emptyMaster);
  const [details, setDetails] = useState<DetailDraft[]>([{ ...emptyDetail }]);
  const [instanceModels, setInstanceModels] = useState<Row[]>([]);
  const [suppliers, setSuppliers] = useState<Row[]>([]);
  const [undertakingUnits, setUndertakingUnits] = useState<Row[]>([]);
  const [customers, setCustomers] = useState<Row[]>([]);
  const [countries, setCountries] = useState<Row[]>([]);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(!requestNo);
  const canEdit = !requestNo || editing;
  const canConfirm = !isConfirmedRequestStatus(master.status);

  async function fetchEntity(entity: string) {
    return fetchAllEntityRows<Row>(entity);
  }

  useEffect(() => {
    void Promise.all([
      fetchEntity("instance-models"),
      fetchEntity("suppliers"),
      fetchEntity("undertaking-units"),
      fetchEntity("customers"),
      fetchEntity("countries"),
    ]).then(([models, supplierRows, undertakingRows, customerRows, countryRows]) => {
      setInstanceModels(models);
      setSuppliers(supplierRows);
      setUndertakingUnits(undertakingRows);
      setCustomers(customerRows);
      setCountries(countryRows);
    });
  }, []);

  useEffect(() => {
    if (!requestNo) return;

    void fetch(`/api/order-details/requests/${encodeURIComponent(requestNo)}`).then(async (response) => {
      if (response.ok) {
        const data = await response.json();
        const row = data.master as Row;
        setMaster({
          requestNo: String(row.requestNo ?? ""),
          countryCode: String(row.countryCode ?? ""),
          contractNo: String(row.contractNo ?? ""),
          batchName: String(row.batchName ?? ""),
          requestType: String(row.requestType ?? "整机"),
          status: String(row.status ?? "草稿"),
          plannedDeliveryDate: formatDateInputValue(row.plannedDeliveryDate),
        });
        setEditing(false);
        const existingDetails = ((data.details ?? []) as Row[]).map((item) => ({
          deviceCode: String(item.deviceCode ?? ""),
          supplierId: String(item.supplierId ?? ""),
          undertakingUnitId: String(item.undertakingUnitId ?? ""),
          customerId: String(item.customerId ?? ""),
          quantity: Number(item.quantity ?? 0),
        }));

        setDetails(existingDetails.length ? existingDetails : [{ ...emptyDetail }]);
      }
    });
  }, [requestNo]);

  function updateMaster(key: keyof MasterDraft, value: string) {
    if (!canEdit) return;
    setMaster((current) => ({ ...current, [key]: value }));
  }

  function updateDetail(index: number, patch: Partial<DetailDraft>) {
    if (!canEdit) return;
    setDetails((current) =>
      current.map((detail, detailIndex) =>
        detailIndex === index ? { ...detail, ...patch } : detail,
      ),
    );
  }

  function getModel(deviceCode: string) {
    return instanceModels.find((model) => String(model.deviceCode) === deviceCode);
  }

  async function importDetails(file: File) {
    const XLSX = await import("xlsx");
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
    const imported = rows
      .map((row) => ({
        deviceCode: String(row.deviceCode ?? row["设备编码"] ?? ""),
        supplierId: String(row.supplierId ?? row["供应商"] ?? row["供应商ID"] ?? ""),
        undertakingUnitId: String(row.undertakingUnitId ?? ""),
        customerId: resolveCustomerId(row),
        quantity: Number(row.quantity ?? row["节点数量"] ?? 0),
      }))
      .filter((row) => row.deviceCode || row.supplierId || row.undertakingUnitId || row.customerId || row.quantity);

    if (imported.length) setDetails(imported);
  }

  async function upsertRequestItems() {
    const requestItems = buildRequestItemRows({
      requestNo: master.requestNo,
      requestedAt: master.plannedDeliveryDate || formatDateInputValue(new Date()),
      requestType: master.requestType,
      details: details.filter((detail) => detail.deviceCode && detail.supplierId && detail.undertakingUnitId),
    });

    for (const item of requestItems) {
      const existingResponse = await fetch(`/api/entities/request-items/${encodeURIComponent(item.id)}`);
      await fetch(
        `/api/entities/request-items${existingResponse.ok ? `/${encodeURIComponent(item.id)}` : ""}`,
        {
          method: existingResponse.ok ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(item),
        },
      );
    }
  }

  async function saveOrder(mode: SaveMode) {
    setSaving(true);
    if (mode === "confirm") setConfirming(true);
    const status = mode === "confirm" ? "待下单" : "草稿";
    const body = { ...master, status };

    const existingResponse = await fetch(`/api/entities/requests/${encodeURIComponent(master.requestNo)}`);
    const saveResponse = await fetch(`/api/entities/requests${existingResponse.ok ? `/${encodeURIComponent(master.requestNo)}` : ""}`, {
      method: existingResponse.ok ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!saveResponse.ok) {
      const data = await saveResponse.json().catch(() => ({}));
      setSaving(false);
      setConfirming(false);
      alert(data.error ?? "保存失败");
      return;
    }

    await upsertRequestItems();

    if (mode === "confirm") {
      const response = await fetch("/api/procurement/from-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestNo: master.requestNo }),
      });
      const data = await response.json().catch(() => ({}));
      setSaving(false);
      if (!response.ok) {
        setConfirming(false);
        alert(data.error ?? "确认失败");
        return;
      }
      setMaster((current) => ({ ...current, status }));
      setEditing(false);
      router.replace(buildDetailRoute(`/requests/orders/${encodeURIComponent(master.requestNo)}`, returnTo), { scroll: false });
      return;
    }

    setSaving(false);
    setMaster((current) => ({ ...current, status }));
    setEditing(false);
    router.replace(buildDetailRoute(`/requests/orders/${encodeURIComponent(master.requestNo)}`, returnTo), { scroll: false });
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <Button type="button" onClick={() => router.push(returnTo)}>
          <ArrowLeft size={15} />
          返回列表
        </Button>
        <div>
          <h1 className="text-xl font-medium text-[#303133]">
            {requestNo ? "修改需求单明细表" : "新建需求单明细表"}
          </h1>
          <p className="mt-1 text-sm text-[#909399]">
            保存后需求单为草稿；确认后需求单状态为待下单，并自动生成一张采购草稿。
          </p>
        </div>
        <div className="ml-auto flex gap-2">
          {canEdit ? (
            <>
              {requestNo ? (
                <Button disabled={saving} onClick={() => setEditing(false)}>
                  <X size={15} />
                  取消
                </Button>
              ) : null}
              <Button disabled={saving || !master.requestNo} tone="primary" onClick={() => void saveOrder("draft")}>
                <Save size={15} />
                {requestNo ? "保存" : "保存草稿"}
              </Button>
              {!requestNo ? (
                <Button disabled={saving || !master.requestNo} tone="success" onClick={() => void saveOrder("confirm")}>
                  <CheckCircle2 size={15} />
                  {confirming ? "已确认" : "确认需求单"}
                </Button>
              ) : null}
            </>
          ) : (
            <>
              <Button disabled={saving || !canConfirm} onClick={() => setEditing(true)}>
                <Pencil size={15} />
                修改
              </Button>
              <Button disabled={saving || !master.requestNo || !canConfirm} tone="success" onClick={() => void saveOrder("confirm")}>
                <CheckCircle2 size={15} />
                {!canConfirm || confirming ? "已确认" : "确认需求单"}
              </Button>
            </>
          )}
        </div>
      </div>

      <Panel>
        <div className="border-b border-[#ebeef5] px-4 py-3 font-medium text-[#303133]">主单信息</div>
        <div className="grid grid-cols-3 gap-4 p-4">
          <Field disabled={!canEdit || Boolean(requestNo)} label="需求单号" required value={master.requestNo} onChange={(value) => updateMaster("requestNo", value)} />
          <label>
            <span className="mb-1 block text-sm font-medium text-[#606266]">
              <span className="text-[#f56c6c]">*</span>
              国家
            </span>
            <select
              className="h-9 w-full rounded border border-[#dcdfe6] bg-white px-3 text-sm outline-none focus:border-[#1890ff]"
              required
              disabled={!canEdit}
              value={master.countryCode}
              onChange={(event) => updateMaster("countryCode", event.target.value)}
            >
              <option value="">请选择</option>
              {countries.map((country) => (
                <option key={String(country.code)} value={String(country.code)}>
                  {String(country.code)} - {String(country.nameZh ?? country.nameEn ?? "")}
                </option>
              ))}
            </select>
          </label>
          <Field disabled={!canEdit} label="合同号" required value={master.contractNo} onChange={(value) => updateMaster("contractNo", value)} />
          <Field disabled={!canEdit} label="批次名称" required value={master.batchName} onChange={(value) => updateMaster("batchName", value)} />
          <label>
            <span className="mb-1 block text-sm font-medium text-[#606266]">
              <span className="text-[#f56c6c]">*</span>
              类型
            </span>
            <select
              className="h-9 w-full rounded border border-[#dcdfe6] bg-white px-3 text-sm outline-none focus:border-[#1890ff] disabled:bg-[#f5f7fa] disabled:text-[#909399]"
              required
              disabled={!canEdit}
              value={master.requestType}
              onChange={(event) => updateMaster("requestType", event.target.value)}
            >
              {REQUEST_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <Field disabled={!canEdit} label="计划交付日期" type="date" value={master.plannedDeliveryDate} onChange={(value) => updateMaster("plannedDeliveryDate", value)} />
        </div>
      </Panel>

      <Panel>
        <div className="flex items-center gap-2 border-b border-[#ebeef5] px-4 py-3">
          <div className="font-medium text-[#303133]">需求明细</div>
          <Button className="ml-auto" disabled={!canEdit} onClick={() => setDetails((current) => [...current, { ...emptyDetail }])}>
            <Plus size={15} />
            新增明细
          </Button>
          <Button disabled={!canEdit} tone="success" onClick={() => fileRef.current?.click()}>
            <Upload size={15} />
            导入明细
          </Button>
          <input
            ref={fileRef}
            className="hidden"
            type="file"
            accept=".xlsx,.xls"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importDetails(file);
            }}
          />
        </div>

        <StickyTable className="table-scroll overflow-auto" tableKey="request-order-form-details">
          <table className="min-w-[1220px] whitespace-nowrap border-collapse text-sm">
            <thead className="bg-[#f5f7fa] text-[#303133]">
              <tr>
                <th className="border-b border-r border-[#ebeef5] px-3 py-3 text-left">设备编码</th>
                <th className="border-b border-r border-[#ebeef5] px-3 py-3 text-left">机型</th>
                <th className="border-b border-r border-[#ebeef5] px-3 py-3 text-left">英文名称</th>
                <th className="border-b border-r border-[#ebeef5] px-3 py-3 text-left">供应商</th>
                <th className="border-b border-r border-[#ebeef5] px-3 py-3 text-left">承接单位</th>
                <th className="border-b border-r border-[#ebeef5] px-3 py-3 text-left">客户</th>
                <th className="border-b border-r border-[#ebeef5] px-3 py-3 text-left">节点数量</th>
              </tr>
            </thead>
            <tbody>
              {details.map((detail, index) => {
                const model = getModel(detail.deviceCode);
                return (
                  <tr key={index}>
                    <td className="border-b border-r border-[#ebeef5] px-3 py-3">
                      <SearchPicker
                        allowFreeText
                        options={instanceModels.map((item) => ({ value: String(item.deviceCode ?? ""), label: String(item.deviceCode ?? ""), keywords: `${String(item.modelCode ?? "")} ${String(item.nameEn ?? "")}` }))}
                        placeholder="搜索或输入设备编码"
                        className="h-9 min-w-[180px] rounded border border-[#dcdfe6] bg-white px-2"
                        value={detail.deviceCode}
                        disabled={!canEdit}
                        onChange={(value) => updateDetail(index, { deviceCode: value })}
                      />
                    </td>
                    <td className="border-b border-r border-[#ebeef5] px-3 py-3">{formatValue(model?.modelCode)}</td>
                    <td className="border-b border-r border-[#ebeef5] px-3 py-3">{formatValue(model?.nameEn)}</td>
                    <td className="border-b border-r border-[#ebeef5] px-3 py-3">
                      <SearchPicker
                        options={suppliers.map((supplier) => ({ value: String(supplier.supplierId ?? ""), label: String(supplier.supplierCode ?? supplier.supplierId ?? ""), keywords: `${String(supplier.supplierCode ?? "")} ${String(supplier.name ?? "")} ${String(supplier.supplierId ?? "")}` }))}
                        placeholder="搜索供应商"
                        className="h-9 min-w-[160px] rounded border border-[#dcdfe6] bg-white px-2"
                        value={detail.supplierId}
                        disabled={!canEdit}
                        onChange={(value) => updateDetail(index, { supplierId: value })}
                      />
                    </td>
                    <td className="border-b border-r border-[#ebeef5] px-3 py-3">
                      <SearchPicker
                        options={undertakingUnits.map((unit) => ({ value: String(unit.undertakingUnitId ?? ""), label: String(unit.undertakingUnitCode ?? unit.undertakingUnitId ?? ""), keywords: `${String(unit.undertakingUnitCode ?? "")} ${String(unit.name ?? "")} ${String(unit.undertakingUnitId ?? "")}` }))}
                        placeholder="搜索承接单位"
                        value={detail.undertakingUnitId}
                        disabled={!canEdit}
                        onChange={(value) => updateDetail(index, { undertakingUnitId: value })}
                      />
                    </td>
                    <td className="border-b border-r border-[#ebeef5] px-3 py-3">
                      <SearchPicker
                        options={customers.map((customer) => ({ value: String(customer.customerId ?? ""), label: String(customer.customerCode ?? customer.customerId ?? ""), keywords: `${String(customer.customerCode ?? "")} ${String(customer.name ?? "")} ${String(customer.customerId ?? "")}` }))}
                        placeholder="搜索客户"
                        value={detail.customerId}
                        disabled={!canEdit}
                        onChange={(value) => updateDetail(index, { customerId: value })}
                      />
                    </td>
                    <td className="border-b border-r border-[#ebeef5] px-3 py-3">
                      <Input
                        className="w-28 min-w-0"
                        min={0}
                        disabled={!canEdit}
                        type="number"
                        value={formatNumericInputValue(detail.quantity)}
                        onChange={(event) => updateDetail(index, { quantity: parseNumericInputValue(event.target.value) })}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <datalist id="request-device-codes">
            {instanceModels.map((item) => (
              <option key={String(item.deviceCode)} value={String(item.deviceCode)}>
                {String(item.deviceCode)}
              </option>
            ))}
          </datalist>
        </StickyTable>
      </Panel>
    </div>
  );

  function resolveCustomerId(row: Record<string, unknown>) {
    const raw = String(row.customerId ?? row["客户ID"] ?? row.customerCode ?? row["客户代码"] ?? row["客户"] ?? "").trim();
    if (!raw) return "";
    const match = customers.find((customer) => [customer.customerId, customer.customerCode, customer.name]
      .some((value) => String(value ?? "").trim().toLowerCase() === raw.toLowerCase()));
    return String(match?.customerId ?? raw);
  }
}

function SearchPicker({
  allowFreeText = false,
  className,
  disabled,
  onChange,
  options,
  placeholder,
  value,
}: {
  allowFreeText?: boolean;
  className?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  options: SearchOption[];
  placeholder: string;
  value: string;
}) {
  const selected = options.find((option) => option.value === value);
  const inputWrapRef = useRef<HTMLDivElement | null>(null);
  const [query, setQuery] = useState(selected?.label ?? value);
  const [focused, setFocused] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ left: 0, top: 0, width: 0 });

  useEffect(() => {
    if (!focused) setQuery(selected?.label ?? value);
  }, [focused, selected?.label, value]);

  useEffect(() => {
    if (!focused) return;
    const closeMenu = () => setFocused(false);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    return () => {
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
    };
  }, [focused]);

  const normalizedQuery = query.trim().toLowerCase();
  const matches = (normalizedQuery
    ? options.filter((option) => `${option.value} ${option.label} ${option.keywords ?? ""}`.toLowerCase().includes(normalizedQuery))
    : options
  ).slice(0, 8);

  function handleInput(nextQuery: string) {
    setQuery(nextQuery);
    const exact = options.find((option) => [option.value, option.label].some((candidate) => candidate.toLowerCase() === nextQuery.trim().toLowerCase()));
    if (exact) onChange(exact.value);
    else if (allowFreeText) onChange(nextQuery);
    else onChange("");
  }

  function openMenu() {
    const rect = inputWrapRef.current?.getBoundingClientRect();
    if (rect) setMenuPosition({ left: rect.left, top: rect.bottom + 4, width: Math.max(rect.width, 300) });
    setFocused(true);
  }

  return (
    <div className="min-w-[180px]" ref={inputWrapRef}>
      <Input
        className={className}
        disabled={disabled}
        placeholder={placeholder}
        value={query}
        onFocus={openMenu}
        onBlur={() => window.setTimeout(() => setFocused(false), 120)}
        onChange={(event) => handleInput(event.target.value)}
      />
      {focused && !disabled && matches.length ? (
        <div className="fixed z-[100] max-h-64 overflow-auto border border-[#dcdfe6] bg-white py-1 shadow-xl" style={{ left: menuPosition.left, top: menuPosition.top, width: menuPosition.width }}>
          {matches.map((option) => (
            <button
              className="block w-full px-3 py-2 text-left text-sm text-[#606266] hover:bg-[#f5f7fa]"
              key={option.value}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setQuery(option.label);
                setFocused(false);
                onChange(option.value);
              }}
            >
              <span className="block text-[#303133]">{option.label}</span>
              <span className="block text-xs text-[#909399]">{option.value}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Field({
  disabled,
  label,
  onChange,
  required,
  type = "text",
  value,
}: {
  disabled?: boolean;
  label: string;
  onChange: (value: string) => void;
  required?: boolean;
  type?: "date" | "text";
  value: string;
}) {
  return (
    <label>
      <span className="mb-1 block text-sm font-medium text-[#606266]">
        {required ? <span className="text-[#f56c6c]">*</span> : null}
        {label}
      </span>
      <Input className="w-full" disabled={disabled} required={required} type={type} value={type === "date" ? formatDateInputValue(value) : value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function formatValue(value: unknown) {
  return formatDisplayValue(value as string | number | boolean | null | undefined);
}

function isConfirmedRequestStatus(status: string) {
  return isConfirmedOrderStatus("requests", status);
}
