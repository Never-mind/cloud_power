"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, FileDown, Pencil, Plus, Save, Trash2, Upload } from "lucide-react";
import {
  applyBillingAdjustmentDeviceAutofill,
  getBillingAdjustmentEditState,
  type BillingAdjustmentInstanceModel,
} from "@/lib/billing-adjustment-form";
import { formatDateInputValue, formatDisplayValue } from "@/lib/display-format";
import { buildImportMessage, type ImportReport } from "@/lib/entity-import";
import { PURCHASE_CURRENCY_OPTIONS } from "@/lib/purchase-order-form";
import { fetchAllEntityRows } from "@/lib/client-entity-fetch";
import { buildDetailRoute, getReturnTo } from "@/lib/client-list-navigation";
import { Button, Input, Panel, Textarea } from "./ui";
import { StickyTable } from "./sticky-table";

type Row = Record<string, string | number | boolean | null>;

const itemColumns: Array<{ key: string; label: string; type?: string }> = [
  { key: "countryCode", label: "国家" },
  { key: "batchName", label: "批次号" },
  { key: "requestNo", label: "需求单号" },
  { key: "poNo", label: "PO单号" },
  { key: "deviceCode", label: "实例编码" },
  { key: "modelCode", label: "机型" },
  { key: "nameEn", label: "英文名称" },
  { key: "quantity", label: "数量", type: "number" },
  { key: "currency", label: "币种" },
  { key: "effectiveMonth", label: "生效月份", type: "date" },
  { key: "adjustedFirst24MonthPrice", label: "调整后前24个月价", type: "number" },
  { key: "adjustedNext36MonthPrice", label: "调整后后36个月价", type: "number" },
  { key: "createdAt", label: "创建日期", type: "date" },
  { key: "updatedAt", label: "更新日期", type: "date" },
];

const emptyItem = {
  countryCode: "",
  batchName: "",
  requestNo: "",
  poNo: "",
  deviceCode: "",
  modelCode: "",
  nameEn: "",
  quantity: 0,
  currency: "USD",
  effectiveMonth: "",
  adjustedFirst24MonthPrice: 0,
  adjustedNext36MonthPrice: 0,
};

export function BillingAdjustmentDetailPage({ adjustmentNo: routeAdjustmentNo }: { adjustmentNo: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = getReturnTo(searchParams.get("returnTo"), "/finance/billing-adjustments");
  const fileRef = useRef<HTMLInputElement>(null);
  const isNew = routeAdjustmentNo === "new";
  const [adjustmentNo, setAdjustmentNo] = useState(isNew ? buildAdjustmentNo() : routeAdjustmentNo);
  const [instanceContractNo, setInstanceContractNo] = useState("");
  const [status, setStatus] = useState("草稿");
  const [reason, setReason] = useState("");
  const [items, setItems] = useState<Row[]>([{ ...emptyItem }]);
  const [instanceModels, setInstanceModels] = useState<BillingAdjustmentInstanceModel[]>([]);
  const [isEditing, setIsEditing] = useState(isNew);
  const [saving, setSaving] = useState(false);
  const editState = getBillingAdjustmentEditState({ isEditing, isSaving: saving, status });
  const { canEdit, confirmed } = editState;

  async function loadAdjustment() {
    if (isNew) return;
    const response = await fetch(`/api/billing/adjustments/${encodeURIComponent(routeAdjustmentNo)}`);
    const data = await response.json();
    if (!response.ok) return;
    const adjustment = data.adjustment ?? {};
    setAdjustmentNo(String(adjustment.adjustmentNo ?? routeAdjustmentNo));
    setInstanceContractNo(String(adjustment.instanceContractNo ?? ""));
    setStatus(String(adjustment.status ?? "草稿"));
    setReason(String(adjustment.reason ?? ""));
    setItems((data.items ?? []).length ? data.items : [{ ...emptyItem }]);
    setIsEditing(false);
  }

  useEffect(() => {
    void loadAdjustment();
    void fetchAllEntityRows<Row>("instance-models")
      .then((rows) =>
        setInstanceModels(
          rows.map((row) => ({
            deviceCode: String(row.deviceCode ?? ""),
            modelCode: String(row.modelCode ?? ""),
            nameEn: String(row.nameEn ?? ""),
          })),
        ),
      );
  }, []);

  function updateItem(index: number, key: string, value: string) {
    setItems((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index
          ? nextItemWithChange(item, key, value, instanceModels)
          : item,
      ),
    );
  }

  function addItem() {
    setItems((current) => [...current, { ...emptyItem }]);
  }

  function removeItem(index: number) {
    setItems((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  async function saveDraft() {
    if (saving) return false;
    if (!adjustmentNo.trim()) {
      alert("请填写调整单号");
      return false;
    }
    if (!instanceContractNo.trim()) {
      alert("请填写实例合同单号");
      return false;
    }
    setSaving(true);
    const response = await fetch(`/api/billing/adjustments${isNew ? "" : `/${encodeURIComponent(adjustmentNo)}`}`, {
      method: isNew ? "POST" : "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adjustmentNo, instanceContractNo, reason, items }),
    });
    const data = await response.json();
    setSaving(false);
    if (!response.ok) {
      alert(data.error ?? "保存失败");
      return false;
    }
    if (isNew) {
      router.replace(buildDetailRoute(`/finance/billing-adjustments/${encodeURIComponent(adjustmentNo)}`, returnTo), { scroll: false });
      router.refresh();
    }
    setItems(data.items ?? items);
    setStatus(String(data.adjustment?.status ?? "草稿"));
    setIsEditing(false);
    alert("实例合同调整单草稿已保存");
    return true;
  }

  async function confirmAdjustment() {
    if (canEdit) {
      const saved = await saveDraft();
      if (!saved) return;
    }
    const response = await fetch(`/api/billing/adjustments/${encodeURIComponent(adjustmentNo)}/confirm`, {
      method: "POST",
    });
    const data = await response.json();
    if (!response.ok) {
      alert(data.error ?? "确认失败");
      return;
    }
    setStatus("已确认");
    alert("实例合同调整单已确认");
    router.push(returnTo);
  }

  async function importItems(file: File) {
    if (!adjustmentNo.trim() || !instanceContractNo.trim()) {
      alert("请先填写调整单号和实例合同单号");
      return;
    }
    const formData = new FormData();
    formData.set("file", file);
    formData.set("instanceContractNo", instanceContractNo);
    formData.set("reason", reason);
    formData.set("replace", "true");
    const response = await fetch(`/api/billing/adjustments/${encodeURIComponent(adjustmentNo)}/import`, {
      method: "POST",
      body: formData,
    });
    const data = await response.json();
    if (!response.ok) {
      alert(data.error ?? "导入失败");
      return;
    }
    setItems(data.items ?? []);
    alert(buildImportMessage(data.report as ImportReport));
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-medium text-[#303133]">实例合同调整单明细</h1>
        <p className="mt-1 text-sm text-[#909399]">一个实例合同单号可对应多条实例明细，导入入口在下方明细区域内。</p>
      </div>

      <Panel>
        <div className="grid gap-4 border-b border-[#ebeef5] p-4 md:grid-cols-4">
          <label>
            <span className="mb-1 block text-sm font-medium text-[#606266]">调整单号</span>
            <Input className="w-full" disabled={!canEdit || !isNew} value={adjustmentNo} onChange={(event) => setAdjustmentNo(event.target.value)} />
          </label>
          <label>
            <span className="mb-1 block text-sm font-medium text-[#606266]">实例合同单号</span>
            <Input className="w-full" disabled={!canEdit} value={instanceContractNo} onChange={(event) => setInstanceContractNo(event.target.value)} />
          </label>
          <label>
            <span className="mb-1 block text-sm font-medium text-[#606266]">状态</span>
            <Input className="w-full" disabled value={status} />
          </label>
          <label>
            <span className="mb-1 block text-sm font-medium text-[#606266]">调整原因</span>
            <Textarea className="w-full" disabled={!canEdit} value={reason} onChange={(event) => setReason(event.target.value)} />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-[#ebeef5] p-4">
          <span className="mr-auto text-sm font-medium text-[#303133]">调整明细</span>
          {!confirmed ? (
            <>
              {canEdit ? (
                <>
                  <Button onClick={addItem}>
                    <Plus size={15} />
                    新增明细
                  </Button>
                  <input
                    ref={fileRef}
                    className="hidden"
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void importItems(file);
                      event.currentTarget.value = "";
                    }}
                  />
                  <Button onClick={() => fileRef.current?.click()}>
                    <Upload size={15} />
                    导入明细
                  </Button>
                  <a href={`/api/billing/adjustments/${encodeURIComponent(adjustmentNo)}/template`}>
                    <Button>
                      <FileDown size={15} />
                      下载模板
                    </Button>
                  </a>
                </>
              ) : null}
              <Button
                disabled={editState.editButtonDisabled}
                tone="primary"
                onClick={() => {
                  if (canEdit) void saveDraft();
                  else setIsEditing(true);
                }}
              >
                {canEdit ? <Save size={15} /> : <Pencil size={15} />}
                {saving ? "保存中" : editState.editButtonLabel}
              </Button>
              <Button disabled={editState.confirmDisabled} tone="success" onClick={() => void confirmAdjustment()}>
                <CheckCircle2 size={15} />
                {editState.confirmButtonLabel}
              </Button>
            </>
          ) : (
            <Button disabled tone="success">
              <CheckCircle2 size={15} />
              已确认
            </Button>
          )}
        </div>

        <StickyTable className="table-scroll overflow-auto" tableKey="billing-adjustment-detail-items">
          <table className="min-w-full border-collapse text-sm">
            <thead className="bg-[#f5f7fa] text-[#303133]">
              <tr>
                {itemColumns.map((column) => (
                  <th className="whitespace-nowrap border-b border-r border-[#ebeef5] px-3 py-3 text-left font-medium" key={column.key}>
                    {column.label}
                  </th>
                ))}
                {canEdit ? <th className="sticky right-0 border-b border-[#ebeef5] bg-[#f5f7fa] px-3 py-3 text-left font-medium">操作</th> : null}
              </tr>
            </thead>
            <tbody>
              {items.map((item, index) => (
                <tr className="hover:bg-[#fafafa]" key={String(item.id ?? index)}>
                  {itemColumns.map((column) => (
                    <td className="whitespace-nowrap border-b border-r border-[#ebeef5] px-3 py-3" key={column.key}>
                      {!canEdit ? (
                        formatValue(item[column.key], column.type)
                      ) : column.key === "currency" ? (
                        <select
                          className="h-9 min-w-[100px] rounded border border-[#dcdfe6] bg-white px-3 text-sm outline-none focus:border-[#1890ff]"
                          value={String(item[column.key] ?? "USD")}
                          onChange={(event) => updateItem(index, column.key, event.target.value)}
                        >
                          {PURCHASE_CURRENCY_OPTIONS.map((currency) => (
                            <option key={currency} value={currency}>
                              {currency}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <Input
                          className="min-w-[130px]"
                          list={column.key === "deviceCode" ? "billing-adjustment-device-codes" : undefined}
                          readOnly={column.key === "modelCode" || column.key === "nameEn"}
                          type={column.type === "date" ? "date" : column.type === "number" ? "number" : "text"}
                          step={column.type === "number" ? "0.0001" : undefined}
                          value={column.type === "date" ? formatDateInputValue(item[column.key]) : String(item[column.key] ?? "")}
                          onChange={(event) => updateItem(index, column.key, event.target.value)}
                        />
                      )}
                    </td>
                  ))}
                  {canEdit ? (
                    <td className="sticky right-0 whitespace-nowrap border-b border-[#ebeef5] bg-white px-3 py-3">
                      <Button disabled={items.length <= 1} tone="danger" onClick={() => removeItem(index)}>
                        <Trash2 size={15} />
                        删除
                      </Button>
                    </td>
                  ) : null}
                </tr>
              ))}
              {!items.length ? (
                <tr>
                  <td className="py-12 text-center text-[#909399]" colSpan={itemColumns.length + (canEdit ? 1 : 0)}>
                    暂无调整明细
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </StickyTable>
        <datalist id="billing-adjustment-device-codes">
          {instanceModels.map((model) => (
            <option key={model.deviceCode} value={model.deviceCode}>
              {model.modelCode ?? ""} {model.nameEn ?? ""}
            </option>
          ))}
        </datalist>
      </Panel>
    </div>
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
  return `TZ-${stamp}`;
}

function formatValue(value: unknown, type?: string) {
  return formatDisplayValue(value as string | number | boolean | null | undefined, type);
}

function stripLeadingZero(value: string) {
  if (!value) return value;
  if (/^0+\d/.test(value)) return value.replace(/^0+(?=\d)/, "");
  return value;
}

function nextItemWithChange(
  item: Row,
  key: string,
  value: string,
  instanceModels: BillingAdjustmentInstanceModel[],
) {
  const nextValue = key === "quantity" || key.includes("Price") ? stripLeadingZero(value) : value;
  const nextItem = { ...item, [key]: nextValue };
  if (key !== "deviceCode") return nextItem;
  return applyBillingAdjustmentDeviceAutofill(nextItem, instanceModels);
}
