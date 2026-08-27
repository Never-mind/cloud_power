"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, CheckCircle2, Pencil, Save, X } from "lucide-react";
import { formatDateInputValue, formatDisplayValue } from "@/lib/display-format";
import type { EntityConfig } from "@/lib/modules";
import { formatNumericInputValue, parseNumericInputValue } from "@/lib/numeric-input";
import { getPurchaseOrderForDetailLines } from "@/lib/order-detail-view";
import type { OrderRouteMode } from "@/lib/order-routes";
import { buildPurchaseProductLines, calculatePurchaseTotalAmount } from "@/lib/purchase-lines";
import { PurchaseOrderDemandPlanTabs } from "./purchase-order-demand-plan-tabs";
import { getReturnTo } from "@/lib/client-list-navigation";
import { Button, Input, Panel } from "./ui";
import { StickyTable } from "./sticky-table";

type Row = Record<string, string | number | boolean | null>;

const hiddenPurchaseMasterFieldKeys = new Set(["purchaseOrderId", "sourceRequestNos"]);

export function OrderDetailPage({
  id,
  mode,
  masterConfig,
  detailConfig,
  relationKey,
}: {
  id: string;
  mode: OrderRouteMode;
  masterConfig: EntityConfig;
  detailConfig: EntityConfig;
  relationKey: string;
}) {
  const searchParams = useSearchParams();
  const returnTo = getReturnTo(searchParams.get("returnTo"), mode === "requests" ? "/requests/orders" : "/purchase/orders");
  const [master, setMaster] = useState<Row | null>(null);
  const [details, setDetails] = useState<Row[]>([]);
  const [requestItems, setRequestItems] = useState<Row[]>([]);
  const [instanceModels, setInstanceModels] = useState<Row[]>([]);
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [masterDraft, setMasterDraft] = useState<Row>({});
  const [detailDrafts, setDetailDrafts] = useState<Row[]>([]);

  async function loadData() {
    const detailType = mode === "purchase" ? "purchase-orders" : "requests";
    const response = await fetch(`/api/order-details/${detailType}/${encodeURIComponent(id)}`);
    if (!response.ok) {
      setMaster(null);
      setDetails([]);
      setRequestItems([]);
      setInstanceModels([]);
      return;
    }

    const data = await response.json();
    const nextMaster = (data.master ?? null) as Row | null;
    const nextDetails = (data.details ?? []) as Row[];
    setMaster(nextMaster);
    setDetails(nextDetails);
    setRequestItems((data.requestItems ?? []) as Row[]);
    setInstanceModels((data.instanceModels ?? []) as Row[]);
    setMasterDraft(nextMaster ?? {});
    setDetailDrafts(nextDetails);
  }

  useEffect(() => {
    void loadData();
  }, [id, mode]);

  const totalQuantity = useMemo(() => {
    if (mode === "requests") {
      return details.reduce((total, detail) => total + Number(detail.quantity ?? 0), 0);
    }

    const itemIds = new Set(details.map((detail) => String(detail.requestItemId)));
    return requestItems
      .filter((item) => itemIds.has(String(item.id)))
      .reduce((total, item) => total + Number(item.quantity ?? 0), 0);
  }, [details, mode, requestItems]);

  const purchaseProductLines = useMemo(() => {
    if (!master || mode !== "purchase") return [];
    const activeMaster = getPurchaseOrderForDetailLines(master, masterDraft, editing);
    return buildPurchaseProductLines({
      purchaseOrders: [activeMaster] as any,
      purchaseItems: (editing ? detailDrafts : details) as any,
      requestItems: requestItems as any,
      instanceModels: instanceModels as any,
    });
  }, [detailDrafts, details, editing, instanceModels, master, masterDraft, mode, requestItems]);
  const purchaseTotalAmount = useMemo(
    () => calculatePurchaseTotalAmount(purchaseProductLines),
    [purchaseProductLines],
  );
  const masterFormFields = useMemo(
    () =>
      mode === "purchase"
        ? masterConfig.formFields.filter((field) => !hiddenPurchaseMasterFieldKeys.has(field.key))
        : masterConfig.formFields,
    [masterConfig.formFields, mode],
  );
  const masterListFields = useMemo(
    () =>
      mode === "purchase"
        ? masterConfig.listFields.filter((field) => !hiddenPurchaseMasterFieldKeys.has(field.key))
        : masterConfig.listFields,
    [masterConfig.listFields, mode],
  );

  const detailColumns =
    mode === "purchase"
      ? [
          { key: "deviceCode", label: "产品实例编码" },
          { key: "nameZh", label: "中文名称" },
          { key: "nameEn", label: "英文名称" },
          { key: "quantity", label: "数量", type: "number" },
          { key: "currency", label: "币种" },
          { key: "taxExcludedUnitPrice", label: "不含税单价", type: "money" },
          { key: "taxSurcharge", label: "税费加成", type: "money" },
          { key: "unitPrice", label: "含税单价", type: "money" },
          { key: "totalAmount", label: "含税总价", type: "money" },
          { key: "capexUnitPrice", label: "采购CAPEX单价", type: "money" },
          { key: "opexUnitPrice", label: "采购OPEX单价", type: "money" },
          { key: "hardwareCoefficient", label: "硬件系数", type: "number" },
          { key: "softwareCoefficient", label: "软件系数", type: "number" },
          { key: "totalCoefficient", label: "总系数", type: "number" },
          { key: "requestItemId", label: "需求明细ID" },
        ]
      : detailConfig.listFields;
  const detailRows: Row[] = (mode === "purchase" ? purchaseProductLines : details) as Row[];

  async function confirmPurchaseOrder() {
    setConfirming(true);
    const response = await fetch(`/api/procurement/${encodeURIComponent(id)}/confirm`, {
      method: "POST",
    });
    if (!response.ok) {
      setConfirming(false);
      return;
    }
    await loadData();
  }

  function startEditing() {
    setMasterDraft(master ?? {});
    setDetailDrafts(details);
    setEditing(true);
  }

  function cancelEditing() {
    setMasterDraft(master ?? {});
    setDetailDrafts(details);
    setEditing(false);
  }

  function updateMasterDraft(key: string, value: string | number | null) {
    setMasterDraft((current) => ({ ...current, [key]: value }));
  }

  function updateDetailDraft(rowId: string, key: string, value: number) {
    setDetailDrafts((current) =>
      current.map((row) => {
        if (String(row.id) !== rowId) return row;
        const next = { ...row, [key]: value };
        if (key === "hardwareCoefficient" || key === "softwareCoefficient") {
          next.totalCoefficient =
            Number(next.hardwareCoefficient ?? 0) + Number(next.softwareCoefficient ?? 0);
        }
        if (key === "taxExcludedUnitPrice" || key === "taxSurcharge") {
          next.unitPrice = Number(next.taxExcludedUnitPrice ?? 0) + Number(next.taxSurcharge ?? 0);
        }
        return next;
      }),
    );
  }

  async function saveChanges() {
    if (!master) return;
    await fetch(`/api/entities/${masterConfig.key}/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(masterDraft),
    });

    if (mode === "purchase") {
      for (const detail of detailDrafts) {
        const detailPayload =
          masterDraft.poNo && String(detail.poNo ?? "") !== String(masterDraft.poNo)
            ? { ...detail, poNo: masterDraft.poNo }
            : detail;
        await fetch(`/api/entities/${detailConfig.key}/${encodeURIComponent(String(detail.id))}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(detailPayload),
        });
      }
    }

    setEditing(false);
    await loadData();
  }

  if (!master) {
    return (
      <Panel className="p-8 text-center text-[#909399]">
        未找到单据：{id}
      </Panel>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <Link href={returnTo}>
          <Button>
            <ArrowLeft size={15} />
            返回列表
          </Button>
        </Link>
        <div>
          <h1 className="text-xl font-medium text-[#303133]">
            {mode === "requests" ? "需求单明细" : "采购清单明细"}：{mode === "purchase" ? String(master.poNo ?? id) : id}
          </h1>
          <p className="mt-1 text-sm text-[#909399]">
            {mode === "requests"
              ? "查看当前需求单的主单信息和需求明细。"
              : "查看当前采购清单的主单信息和采购明细，可修改草稿信息，确认后生成物流单据。"}
          </p>
        </div>
        {mode === "purchase" ? (
          <div className="ml-auto flex gap-2">
            {editing ? (
              <>
                <Button onClick={cancelEditing}>
                  <X size={15} />
                  取消
                </Button>
                <Button tone="primary" onClick={() => void saveChanges()}>
                  <Save size={15} />
                  保存
                </Button>
              </>
            ) : (
              <>
                <Button onClick={startEditing}>
                  <Pencil size={15} />
                  修改
                </Button>
                <Button
                  disabled={String(master.status ?? "") === "已确认" || confirming}
                  tone="success"
                  onClick={() => void confirmPurchaseOrder()}
                >
                  <CheckCircle2 size={15} />
                  {String(master.status ?? "") === "已确认" || confirming ? "已确认" : "确认采购"}
                </Button>
              </>
            )}
          </div>
        ) : null}
      </div>

      <Panel>
        <div className="border-b border-[#ebeef5] px-4 py-3 font-medium text-[#303133]">主单信息</div>
        {editing && mode === "purchase" ? (
          <div className="grid grid-cols-4 gap-3 p-4">
            {masterFormFields.map((field) => (
              <label key={field.key}>
                <span className="mb-1 block text-xs text-[#909399]">{field.label}</span>
                {field.type === "select" ? (
                  <select
                    className="h-9 w-full min-w-0 rounded border border-[#dcdfe6] bg-white px-3 text-sm outline-none focus:border-[#1890ff]"
                    disabled={field.key === masterConfig.primaryKey}
                    value={String(masterDraft[field.key] ?? field.options?.[0]?.value ?? "")}
                    onChange={(event) => updateMasterDraft(field.key, event.target.value)}
                  >
                    {field.options?.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Input
                    className="w-full min-w-0"
                    disabled={field.key === masterConfig.primaryKey}
                    step={field.type === "number" ? "0.0001" : undefined}
                    type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
                    value={field.type === "date" ? formatDateInputValue(masterDraft[field.key]) : String(masterDraft[field.key] ?? "")}
                    onChange={(event) =>
                      updateMasterDraft(
                        field.key,
                        field.type === "number" ? Number(event.target.value) : event.target.value,
                      )
                    }
                  />
                )}
              </label>
            ))}
            <Info label="总数量" value={totalQuantity} />
            {mode === "purchase" ? <Info label="采购总金额" value={purchaseTotalAmount} type="money" /> : null}
            <Info label="明细数量" value={details.length} />
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-3 p-4">
            {masterListFields.map((field) => (
              <Info key={field.key} label={field.label} value={master[field.key]} />
            ))}
            <Info label="总数量" value={totalQuantity} />
            {mode === "purchase" ? <Info label="采购总金额" value={purchaseTotalAmount} type="money" /> : null}
            <Info label="明细数量" value={details.length} />
          </div>
        )}
      </Panel>

      <Panel>
        <div className="border-b border-[#ebeef5] px-4 py-3 font-medium text-[#303133]">明细列表</div>
        <StickyTable className="table-scroll overflow-auto" tableKey={`order-detail-${mode}`}>
          <table className={mode === "purchase" ? "min-w-[1800px] whitespace-nowrap border-collapse text-sm" : "min-w-[1050px] whitespace-nowrap border-collapse text-sm"}>
            <thead className="bg-[#f5f7fa] text-[#303133]">
              <tr>
                {detailColumns.map((field) => (
                  <th className="whitespace-nowrap border-b border-r border-[#ebeef5] px-3 py-3 text-left font-medium" key={field.key}>
                    {field.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {detailRows.map((row) => (
                <tr className="hover:bg-[#fafafa]" key={String(row.id ?? row[detailConfig.primaryKey])}>
                  {detailColumns.map((field) => (
                    <td className="whitespace-nowrap border-b border-r border-[#ebeef5] px-3 py-3" key={field.key}>
                      {editing && mode === "purchase" && ["taxExcludedUnitPrice", "taxSurcharge", "capexUnitPrice", "opexUnitPrice", "hardwareCoefficient", "softwareCoefficient"].includes(field.key) ? (
                        <NumberInput
                          value={Number(row[field.key] ?? 0)}
                          onChange={(value) => updateDetailDraft(String(row.id), field.key, value)}
                        />
                      ) : (
                        formatValue(row[field.key], field.type)
                      )}
                    </td>
                  ))}
                </tr>
              ))}
              {!details.length ? (
                <tr>
                  <td className="py-10 text-center text-[#909399]" colSpan={detailColumns.length}>
                    暂无明细
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </StickyTable>
      </Panel>
      {mode === "purchase" ? (
        <PurchaseOrderDemandPlanTabs
          poNo={String(master.poNo ?? "")}
          purchaseOrderId={String(master.purchaseOrderId ?? id)}
        />
      ) : null}
    </div>
  );
}

function Info({ label, value, type }: { label: string; value: unknown; type?: string }) {
  return (
    <div className="border border-[#ebeef5] bg-[#fafafa] p-3">
      <div className="text-xs text-[#909399]">{label}</div>
      <div className="mt-1 truncate text-sm text-[#303133]">{formatValue(value, type)}</div>
    </div>
  );
}

function NumberInput({ onChange, value }: { onChange: (value: number) => void; value: number }) {
  return (
    <Input
      className="w-28 min-w-0"
      step="0.0001"
      type="number"
      value={formatNumericInputValue(value)}
      onChange={(event) => onChange(parseNumericInputValue(event.target.value))}
    />
  );
}

function formatValue(value: unknown, type?: string) {
  return formatDisplayValue(value as string | number | boolean | null | undefined, type);
}
