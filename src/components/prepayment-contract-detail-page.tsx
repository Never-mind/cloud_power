"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, Pencil, Plus, Save, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useSearchParams } from "next/navigation";
import { formatDateInputValue, formatDisplayValue } from "@/lib/display-format";
import { getPrepaymentContractEditState } from "@/lib/prepayment-contract-ui";
import { fetchAllEntityRows } from "@/lib/client-entity-fetch";
import { getReturnTo } from "@/lib/client-list-navigation";
import { postWorkspaceMessage } from "@/lib/tab-workspace";
import { Button, Input, Panel, Textarea } from "./ui";
import { StickyTable } from "./sticky-table";
import { WorkspaceNavigationDialog } from "./workspace-navigation-dialog";

type Contract = {
  contractNo: string;
  status: string;
  currency: string;
  effectiveDate: string;
  totalAmount: number;
};

type Row = Record<string, string | number | boolean | null>;

type Line = {
  id: string;
  contractNo: string;
  lineType: "instance" | "fee";
  requestType?: string;
  purchaseOrderItemId: string;
  requestItemId: string;
  countryCode: string;
  batchName: string;
  requestNo: string;
  poNo: string;
  deviceCode: string;
  modelCode: string;
  nameEn: string;
  supplierId?: string;
  undertakingUnitId?: string;
  customerId?: string;
  quantity: number;
  actualCurrency: string;
  actualUnitPrice: number;
  actualTotalAmount: number;
  contractCurrency: string;
  contractUnitPrice: number;
  contractTotalAmount: number;
  writeOffStartMonth: string;
  feeName: string;
  feeDescription: string;
};

const instanceColumns: Array<{ key: keyof Line; label: string; type?: string }> = [
  { key: "countryCode", label: "国家" },
  { key: "batchName", label: "批次号" },
  { key: "requestNo", label: "需求单号" },
  { key: "poNo", label: "PO单号" },
  { key: "deviceCode", label: "实例编码" },
  { key: "requestType", label: "类型" },
  { key: "modelCode", label: "机型" },
  { key: "nameEn", label: "英文名称" },
  { key: "undertakingUnitId", label: "承接单位" },
  { key: "supplierId", label: "供应商" },
  { key: "customerId", label: "客户" },
  { key: "quantity", label: "数量" },
  { key: "actualCurrency", label: "实际币种" },
  { key: "actualUnitPrice", label: "实际单价", type: "money" },
  { key: "actualTotalAmount", label: "实际总价", type: "money" },
];

export function PrepaymentContractDetailPage({ contractNo }: { contractNo: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = getReturnTo(searchParams.get("returnTo"), "/finance/prepayment-contracts");
  const [contract, setContract] = useState<Contract | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [navigationPrompt, setNavigationPrompt] = useState<{ route: string; title: string; detail: string } | null>(null);
  const [suppliers, setSuppliers] = useState<Row[]>([]);
  const [undertakingUnits, setUndertakingUnits] = useState<Row[]>([]);
  const [customers, setCustomers] = useState<Row[]>([]);
  const [countries, setCountries] = useState<Row[]>([]);
  const editState = getPrepaymentContractEditState({
    isConfirming: confirming,
    isEditing: editing,
    isSaving: saving,
    status: contract?.status,
  });
  const confirmed = editState.confirmed;
  const canEdit = editState.canEdit;

  function partyCode(line: Line, key: "undertakingUnitId" | "supplierId" | "customerId") {
    const value = String(line[key] ?? "");
    if (key === "undertakingUnitId") return String(undertakingUnits.find((row) => String(row.undertakingUnitId) === value)?.undertakingUnitCode ?? value);
    if (key === "supplierId") return String(suppliers.find((row) => String(row.supplierId) === value)?.supplierCode ?? value);
    return String(customers.find((row) => String(row.customerId) === value)?.customerCode ?? value);
  }

  function countryLabel(countryCode: string) {
    const country = countries.find((row) => String(row.code ?? "") === countryCode);
    return country ? `${countryCode} - ${String(country.nameZh ?? countryCode)}` : countryCode;
  }

  async function loadData() {
    const response = await fetch(`/api/prepayments/contracts/${encodeURIComponent(contractNo)}`);
    const data = await response.json();
    if (!response.ok) {
      alert(data.error ?? "合同不存在");
      router.push(returnTo);
      return;
    }
    setContract({
      ...data.contract,
      effectiveDate: formatDateInputValue(data.contract.effectiveDate),
      totalAmount: Number(data.contract.totalAmount ?? 0),
    });
    const sourceLines = (data.lines ?? []) as Line[];
    const instanceCountries = new Set(
      sourceLines
        .filter((line) => line.lineType === "instance")
        .map((line) => String(line.countryCode ?? "").trim())
        .filter(Boolean),
    );
    const defaultFeeCountry = instanceCountries.size === 1 ? Array.from(instanceCountries)[0] : "";
    setLines(
      sourceLines.map((line) => ({
        ...line,
        countryCode: String(line.countryCode ?? "").trim() || (line.lineType === "fee" ? defaultFeeCountry : ""),
        quantity: Number(line.quantity ?? 0),
        actualUnitPrice: Number(line.actualUnitPrice ?? 0),
        actualTotalAmount: Number(line.actualTotalAmount ?? 0),
        contractUnitPrice: Number(line.contractUnitPrice ?? 0),
        contractTotalAmount: Number(line.contractTotalAmount ?? 0),
        writeOffStartMonth: formatDateInputValue(line.writeOffStartMonth ?? data.contract.effectiveDate),
      })),
    );
    setEditing(false);
  }

  useEffect(() => {
    void Promise.all([
      fetchAllEntityRows<Row>("suppliers"),
      fetchAllEntityRows<Row>("undertaking-units"),
      fetchAllEntityRows<Row>("customers"),
      fetchAllEntityRows<Row>("countries"),
    ]).then(([supplierRows, unitRows, customerRows, countryRows]) => {
      setSuppliers(supplierRows);
      setUndertakingUnits(unitRows);
      setCustomers(customerRows);
      setCountries(countryRows);
    });
  }, []);

  useEffect(() => {
    void loadData();
  }, [contractNo]);

  const instanceLines = lines.filter((line) => line.lineType === "instance");
  const feeLines = lines.filter((line) => line.lineType === "fee");
  const totalAmount = useMemo(
    () => roundMoney(lines.reduce((total, line) => total + Number(line.contractTotalAmount ?? 0), 0)),
    [lines],
  );

  function updateContract(patch: Partial<Contract>) {
    setContract((current) => (current ? { ...current, ...patch } : current));
  }

  function updateLine(id: string, patch: Partial<Line>) {
    setLines((current) =>
      current.map((line) => {
        if (line.id !== id) return line;
        const next = { ...line, ...patch };
        if (patch.contractUnitPrice !== undefined && patch.contractTotalAmount === undefined && next.lineType === "instance") {
          next.contractTotalAmount = roundMoney(Number(next.contractUnitPrice ?? 0) * Number(next.quantity ?? 0));
        }
        return next;
      }),
    );
  }

  function addFeeLine() {
    if (!contract) return;
    const instanceCountries = new Set(
      instanceLines.map((line) => String(line.countryCode ?? "").trim()).filter(Boolean),
    );
    const defaultCountryCode = instanceCountries.size === 1 ? Array.from(instanceCountries)[0] : "";
    setLines((current) => [
      ...current,
      {
        id: `PPCI-${contract.contractNo}-FEE-${Date.now()}`,
        contractNo: contract.contractNo,
        lineType: "fee",
        requestType: "",
        purchaseOrderItemId: "",
        requestItemId: "",
        countryCode: defaultCountryCode,
        batchName: "",
        requestNo: "",
        poNo: "",
        deviceCode: "",
        modelCode: "",
        nameEn: "",
        supplierId: "",
        undertakingUnitId: "",
        customerId: "",
        quantity: 1,
        actualCurrency: contract.currency || "USD",
        actualUnitPrice: 0,
        actualTotalAmount: 0,
        contractCurrency: contract.currency || "USD",
        contractUnitPrice: 0,
        contractTotalAmount: 0,
        writeOffStartMonth: contract.effectiveDate,
        feeName: "",
        feeDescription: "",
      },
    ]);
  }

  function removeLine(id: string) {
    setLines((current) => current.filter((line) => line.id !== id));
  }

  async function saveDraft() {
    if (!contract) return false;
    const missingFeeCountry = lines.some(
      (line) => line.lineType === "fee" && !String(line.countryCode ?? "").trim(),
    );
    if (missingFeeCountry) {
      alert("费用明细必须选择国家后才能保存");
      return false;
    }
    setSaving(true);
    const response = await fetch(`/api/prepayments/contracts/${encodeURIComponent(contract.contractNo)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        effectiveDate: contract.effectiveDate,
        lines,
      }),
    });
    const data = await response.json();
    setSaving(false);
    if (!response.ok) {
      alert(data.error ?? "保存失败");
      return false;
    }
    await loadData();
    setEditing(false);
    return true;
  }

  async function confirmContract() {
    if (!contract) return;
    if (!confirm("确认后将生成24个月预付款每月核销明细，合同金额和起始月份将锁定。是否确认？")) return;
    if (editing) {
      const saved = await saveDraft();
      if (!saved) return;
    }
    setSaving(true);
    setConfirming(true);
    const response = await fetch(`/api/prepayments/contracts/${encodeURIComponent(contract.contractNo)}/confirm`, {
      method: "POST",
    });
    const data = await response.json();
    setSaving(false);
    if (!response.ok) {
      setConfirming(false);
      alert(data.error ?? "确认失败");
      return;
    }
    setConfirming(false);
    setContract((current) => (current ? { ...current, status: "已确认" } : current));
    setEditing(false);
    setNavigationPrompt({
      route: `/finance/monthly-prepayment-writeoffs?keyword=${encodeURIComponent(contract.contractNo)}`,
      title: "预付款每月核销明细",
      detail: `合同号：${contract.contractNo}`,
    });
  }

  function handleEditButton() {
    if (!editing) {
      setEditing(true);
      return;
    }
    void saveDraft();
  }

  if (!contract) {
    return <div className="text-[#909399]">加载中...</div>;
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <Button onClick={() => router.push(returnTo)}>
          <ArrowLeft size={15} />
          返回列表
        </Button>
        <div>
          <h1 className="text-xl font-medium text-[#303133]">预付款合同明细</h1>
          <p className="mt-1 text-sm text-[#909399]">维护实例预付款金额、额外费用和每项明细起始核销月份。</p>
        </div>
        <div className="ml-auto flex gap-2">
          <Button disabled={editState.editButtonDisabled} tone="primary" onClick={handleEditButton}>
            {editing ? <Save size={15} /> : <Pencil size={15} />}
            {editState.editButtonLabel}
          </Button>
          <Button disabled={editState.confirmDisabled} tone="success" onClick={() => void confirmContract()}>
            <CheckCircle2 size={15} />
            {editState.confirmButtonLabel}
          </Button>
        </div>
      </div>

      <Panel>
        <div className="border-b border-[#ebeef5] px-4 py-3 font-medium text-[#303133]">主单信息</div>
        <div className="grid grid-cols-5 gap-4 p-4">
          <Field disabled label="预付款合同号" value={contract.contractNo} onChange={() => undefined} />
          <Field disabled label="状态" value={contract.status} onChange={() => undefined} />
          <Field disabled={!canEdit} label="币种" value={contract.currency ?? ""} onChange={(value) => updateContract({ currency: value })} />
          <Field disabled={!canEdit} label="生效日期" type="date" value={contract.effectiveDate} onChange={(value) => updateContract({ effectiveDate: value })} />
          <Field disabled label="合同总金额" value={formatDisplayValue(totalAmount, "money")} onChange={() => undefined} />
        </div>
      </Panel>

      <Panel>
        <div className="border-b border-[#ebeef5] px-4 py-3 font-medium text-[#303133]">实例明细</div>
        <StickyTable className="table-scroll overflow-auto" tableKey={`prepayment-contract-${contractNo}-instances`}>
          <table className="min-w-full border-collapse text-sm">
            <thead className="bg-[#f5f7fa] text-[#303133]">
              <tr>
                {instanceColumns.map((column) => (
                  <th className="whitespace-nowrap border-b border-r border-[#ebeef5] px-3 py-3 text-left font-medium" key={column.key}>
                    {column.label}
                  </th>
                ))}
                <th className="whitespace-nowrap border-b border-r border-[#ebeef5] px-3 py-3 text-left font-medium">合同币种</th>
                <th className="whitespace-nowrap border-b border-r border-[#ebeef5] px-3 py-3 text-left font-medium">合同单价</th>
                <th className="whitespace-nowrap border-b border-r border-[#ebeef5] px-3 py-3 text-left font-medium">合同总价</th>
                <th className="whitespace-nowrap border-b border-r border-[#ebeef5] px-3 py-3 text-left font-medium">起始核销月份</th>
              </tr>
            </thead>
            <tbody>
              {instanceLines.map((line) => (
                <tr className="hover:bg-[#fafafa]" key={line.id}>
                  {instanceColumns.map((column) => (
                    <td className="whitespace-nowrap border-b border-r border-[#ebeef5] px-3 py-3" key={column.key}>
                      {column.key === "undertakingUnitId" || column.key === "supplierId" || column.key === "customerId"
                        ? partyCode(line, column.key)
                        : formatValue(line[column.key], column.type)}
                    </td>
                  ))}
                  <td className="border-b border-r border-[#ebeef5] px-3 py-3">
                    <Input className="w-24 min-w-0" disabled={!canEdit} value={line.contractCurrency ?? ""} onChange={(event) => updateLine(line.id, { contractCurrency: event.target.value })} />
                  </td>
                  <td className="border-b border-r border-[#ebeef5] px-3 py-3">
                    <Input className="w-28 min-w-0" disabled={!canEdit} type="number" value={line.contractUnitPrice} onChange={(event) => updateLine(line.id, { contractUnitPrice: Number(event.target.value) })} />
                  </td>
                  <td className="border-b border-r border-[#ebeef5] px-3 py-3">
                    <Input className="w-32 min-w-0" disabled={!canEdit} type="number" value={line.contractTotalAmount} onChange={(event) => updateLine(line.id, { contractTotalAmount: Number(event.target.value) })} />
                  </td>
                  <td className="border-b border-r border-[#ebeef5] px-3 py-3">
                    <Input className="w-40 min-w-0" disabled={!canEdit} type="date" value={formatDateInputValue(line.writeOffStartMonth)} onChange={(event) => updateLine(line.id, { writeOffStartMonth: event.target.value })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </StickyTable>
      </Panel>

      <Panel>
        <div className="flex items-center border-b border-[#ebeef5] px-4 py-3">
          <div className="font-medium text-[#303133]">费用明细</div>
          <Button className="ml-auto" disabled={!canEdit} onClick={addFeeLine}>
            <Plus size={15} />
            新增费用明细
          </Button>
        </div>
        <StickyTable className="table-scroll overflow-auto" tableKey={`prepayment-contract-${contractNo}-fees`}>
          <table className="min-w-full border-collapse text-sm">
            <thead className="bg-[#f5f7fa] text-[#303133]">
              <tr>
                <th className="border-b border-r border-[#ebeef5] px-3 py-3 text-left">费用名称</th>
                <th className="border-b border-r border-[#ebeef5] px-3 py-3 text-left">国家</th>
                <th className="border-b border-r border-[#ebeef5] px-3 py-3 text-left">批次号</th>
                <th className="border-b border-r border-[#ebeef5] px-3 py-3 text-left">说明</th>
                <th className="border-b border-r border-[#ebeef5] px-3 py-3 text-left">承接单位</th>
                <th className="border-b border-r border-[#ebeef5] px-3 py-3 text-left">供应商</th>
                <th className="border-b border-r border-[#ebeef5] px-3 py-3 text-left">客户</th>
                <th className="border-b border-r border-[#ebeef5] px-3 py-3 text-left">币种</th>
                <th className="border-b border-r border-[#ebeef5] px-3 py-3 text-left">金额</th>
                <th className="border-b border-r border-[#ebeef5] px-3 py-3 text-left">起始核销月份</th>
                <th className="border-b border-[#ebeef5] px-3 py-3 text-left">操作</th>
              </tr>
            </thead>
            <tbody>
              {feeLines.map((line) => (
                <tr key={line.id}>
                  <td className="border-b border-r border-[#ebeef5] px-3 py-3">
                    <Input disabled={!canEdit} value={line.feeName ?? ""} onChange={(event) => updateLine(line.id, { feeName: event.target.value, nameEn: event.target.value })} />
                  </td>
                  <td className="border-b border-r border-[#ebeef5] px-3 py-3">
                    <select
                      className="h-9 min-w-[150px] rounded border border-[#dcdfe6] bg-white px-2"
                      disabled={!canEdit}
                      value={line.countryCode ?? ""}
                      onChange={(event) => updateLine(line.id, { countryCode: event.target.value })}
                    >
                      <option value="">请选择国家</option>
                      {countries
                        .map((country) => ({
                          code: String(country.code ?? "").trim(),
                          nameZh: String(country.nameZh ?? "").trim(),
                        }))
                        .filter((country) => country.code)
                        .sort((left, right) => left.code.localeCompare(right.code))
                        .map((country) => (
                          <option key={country.code} value={country.code}>
                            {countryLabel(country.code)}
                          </option>
                        ))}
                    </select>
                  </td>
                  <td className="border-b border-r border-[#ebeef5] px-3 py-3">
                    <Input disabled={!canEdit} value={line.batchName ?? ""} onChange={(event) => updateLine(line.id, { batchName: event.target.value })} />
                  </td>
                  <td className="border-b border-r border-[#ebeef5] px-3 py-3">
                    <Textarea disabled={!canEdit} value={line.feeDescription ?? ""} onChange={(event) => updateLine(line.id, { feeDescription: event.target.value })} />
                  </td>
                  <td className="border-b border-r border-[#ebeef5] px-3 py-3">
                    <select className="h-9 min-w-[160px] rounded border border-[#dcdfe6] bg-white px-2" disabled={!canEdit} value={line.undertakingUnitId ?? ""} onChange={(event) => updateLine(line.id, { undertakingUnitId: event.target.value })}>
                      <option value="">请选择</option>
                      {undertakingUnits.map((unit) => <option key={String(unit.undertakingUnitId)} value={String(unit.undertakingUnitId)}>{String(unit.undertakingUnitCode ?? unit.undertakingUnitId)}</option>)}
                    </select>
                  </td>
                  <td className="border-b border-r border-[#ebeef5] px-3 py-3">
                    <select className="h-9 min-w-[160px] rounded border border-[#dcdfe6] bg-white px-2" disabled={!canEdit} value={line.supplierId ?? ""} onChange={(event) => updateLine(line.id, { supplierId: event.target.value })}>
                      <option value="">请选择</option>
                      {suppliers.map((supplier) => <option key={String(supplier.supplierId)} value={String(supplier.supplierId)}>{String(supplier.supplierCode ?? supplier.supplierId)}</option>)}
                    </select>
                  </td>
                  <td className="border-b border-r border-[#ebeef5] px-3 py-3">
                    <select className="h-9 min-w-[160px] rounded border border-[#dcdfe6] bg-white px-2" disabled={!canEdit} value={line.customerId ?? ""} onChange={(event) => updateLine(line.id, { customerId: event.target.value })}>
                      <option value="">请选择</option>
                      {customers.map((customer) => <option key={String(customer.customerId)} value={String(customer.customerId)}>{String(customer.customerCode ?? customer.customerId)}</option>)}
                    </select>
                  </td>
                  <td className="border-b border-r border-[#ebeef5] px-3 py-3">
                    <Input className="w-24 min-w-0" disabled={!canEdit} value={line.contractCurrency ?? ""} onChange={(event) => updateLine(line.id, { contractCurrency: event.target.value })} />
                  </td>
                  <td className="border-b border-r border-[#ebeef5] px-3 py-3">
                    <Input className="w-32 min-w-0" disabled={!canEdit} type="number" value={line.contractTotalAmount} onChange={(event) => updateLine(line.id, { contractTotalAmount: Number(event.target.value), contractUnitPrice: Number(event.target.value) })} />
                  </td>
                  <td className="border-b border-r border-[#ebeef5] px-3 py-3">
                    <Input className="w-40 min-w-0" disabled={!canEdit} type="date" value={formatDateInputValue(line.writeOffStartMonth)} onChange={(event) => updateLine(line.id, { writeOffStartMonth: event.target.value })} />
                  </td>
                  <td className="border-b border-[#ebeef5] px-3 py-3">
                    <Button disabled={!canEdit} tone="danger" onClick={() => removeLine(line.id)}>
                      <Trash2 size={15} />
                      删除
                    </Button>
                  </td>
                </tr>
              ))}
              {!feeLines.length ? (
                <tr>
                  <td className="py-8 text-center text-[#909399]" colSpan={10}>暂无费用明细</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </StickyTable>
      </Panel>
      {navigationPrompt ? (
        <WorkspaceNavigationDialog
          title="合同已确认"
          message="预付款合同已确认，是否打开对应的预付款每月核销明细？"
          detail={navigationPrompt.detail}
          onStay={() => setNavigationPrompt(null)}
          onOpen={() => {
            const target = navigationPrompt;
            setNavigationPrompt(null);
            postWorkspaceMessage({ type: "cloud-power:open-tab", route: target.route, title: target.title });
          }}
        />
      ) : null}
    </div>
  );
}

function Field({
  disabled,
  label,
  onChange,
  type = "text",
  value,
}: {
  disabled?: boolean;
  label: string;
  onChange: (value: string) => void;
  type?: "date" | "text";
  value: string;
}) {
  return (
    <label>
      <span className="mb-1 block text-sm font-medium text-[#606266]">{label}</span>
      <Input className="w-full" disabled={disabled} type={type} value={type === "date" ? formatDateInputValue(value) : value ?? ""} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function formatValue(value: unknown, type?: string) {
  return formatDisplayValue(value as string | number | boolean | null | undefined, type);
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
