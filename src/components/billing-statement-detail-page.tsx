"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Download } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { getReturnTo } from "@/lib/client-list-navigation";
import { formatDisplayValue } from "@/lib/display-format";
import { Button, Panel } from "./ui";
import { StickyTable } from "./sticky-table";

type Row = Record<string, string | number | boolean | null>;
type StatementData = { snapshot: Row | null; items: Row[] };

const summaryFields: Array<{ key: string; label: string; type?: string }> = [
  { key: "snapshotNo", label: "对账单号" },
  { key: "status", label: "确认状态" },
  { key: "countryCode", label: "国家" },
  { key: "startDate", label: "起始日期", type: "date" },
  { key: "endDate", label: "终止日期", type: "date" },
  { key: "currencySummary", label: "币种汇总" },
  { key: "totalQuantity", label: "总数量", type: "number" },
  { key: "totalAmount", label: "总金额", type: "money" },
  { key: "itemCount", label: "明细数量", type: "number" },
  { key: "createdAt", label: "创建日期", type: "date" },
  { key: "updatedAt", label: "更新日期", type: "date" },
  { key: "confirmedAt", label: "确认日期", type: "date" },
];

const itemColumns: Array<{ key: string; label: string; type?: string }> = [
  { key: "countryCode", label: "国家" },
  { key: "instanceContractNo", label: "实例合同号" },
  { key: "productType", label: "实例名称" },
  { key: "unitPriceVatExcluded", label: "实例合同价不含税", type: "money" },
  { key: "vatRate", label: "税率", type: "percent" },
  { key: "unitPriceVatIncluded", label: "实例合同价含税", type: "money" },
  { key: "quantity", label: "数量", type: "number" },
  { key: "amount", label: "金额", type: "money" },
  { key: "currency", label: "币种" },
  { key: "startTime", label: "起始时间", type: "date" },
  { key: "endTime", label: "结束计费时间", type: "date" },
];

export function BillingStatementDetailPage({ snapshotNo }: { snapshotNo: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = getReturnTo(searchParams.get("returnTo"), "/finance/billing-statements");
  const [data, setData] = useState<StatementData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const response = await fetch(`/api/billing-statements/${encodeURIComponent(snapshotNo)}`);
        const result = (await response.json().catch(() => ({}))) as StatementData & { error?: string };
        if (!response.ok) throw new Error(result.error ?? "月账单对账单加载失败");
        if (!cancelled) setData({ snapshot: result.snapshot ?? null, items: result.items ?? [] });
      } catch (error) {
        if (!cancelled) {
          setData(null);
          alert(error instanceof Error ? error.message : "月账单对账单加载失败");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [snapshotNo]);

  const total = useMemo(
    () => (data?.items ?? []).reduce((sum, row) => sum + Number(row.amount ?? 0), 0),
    [data?.items],
  );

  if (loading) return <div className="text-[#909399]">加载中...</div>;
  if (!data?.snapshot) return <div className="text-[#909399]">未找到月账单对账单。</div>;

  const confirmed = data.snapshot.status === "已确认";

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <Button onClick={() => router.push(returnTo)}>
          <ArrowLeft size={15} />
          返回列表
        </Button>
        <div>
          <h1 className="text-xl font-medium text-[#303133]">月账单对账单明细</h1>
          <p className="mt-1 text-sm text-[#909399]">查看已生成对账单的快照信息和汇总后的实例明细。</p>
        </div>
        <a className="ml-auto" href={`/api/billing-statements/${encodeURIComponent(snapshotNo)}/export`}>
          <Button tone="warning">
            <Download size={15} />
            导出 Excel
          </Button>
        </a>
      </div>

      <Panel>
        <div className="border-b border-[#ebeef5] px-4 py-3 font-medium text-[#303133]">对账单信息</div>
        <div className="grid gap-x-5 gap-y-4 p-4 sm:grid-cols-2 xl:grid-cols-4">
          {summaryFields.map((field) => (
            <div key={field.key}>
              <div className="text-xs text-[#909399]">{field.label}</div>
              <div className="mt-1 break-all text-sm text-[#303133]">
                {field.key === "status" ? (
                  <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${confirmed ? "bg-[#f0f9eb] text-[#67c23a]" : "bg-[#fff7e6] text-[#e6a23c]"}`}>
                    {confirmed ? "已确认" : "未确认"}
                  </span>
                ) : formatValue(data.snapshot?.[field.key], field.type)}
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel>
        <div className="flex items-center justify-between border-b border-[#ebeef5] px-4 py-3">
          <span className="font-medium text-[#303133]">对账单明细</span>
          <span className="text-sm text-[#909399]">共 {data.items.length} 条，金额合计 {formatValue(total, "money")}</span>
        </div>
        <StickyTable className="table-scroll overflow-auto" tableKey="billing-statement-detail-items">
          <table className="min-w-full border-collapse text-sm">
            <thead className="bg-[#f5f7fa] text-[#303133]">
              <tr>
                {itemColumns.map((column) => (
                  <th className="whitespace-nowrap border-b border-r border-[#ebeef5] px-3 py-3 text-left font-medium" key={column.key}>
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.items.map((row, index) => (
                <tr className="hover:bg-[#fafafa]" key={`${row.instanceContractNo}-${row.productType}-${row.currency}-${index}`}>
                  {itemColumns.map((column) => (
                    <td className="whitespace-nowrap border-b border-r border-[#ebeef5] px-3 py-3" key={column.key}>
                      {formatValue(row[column.key], column.type)}
                    </td>
                  ))}
                </tr>
              ))}
              {!data.items.length ? (
                <tr><td className="py-12 text-center text-[#909399]" colSpan={itemColumns.length}>暂无明细</td></tr>
              ) : null}
            </tbody>
          </table>
        </StickyTable>
      </Panel>
    </div>
  );
}

function formatValue(value: unknown, type?: string) {
  if (type === "percent") {
    const rate = Number(value ?? 0);
    return `${Number.isFinite(rate) ? (rate * 100).toFixed(2).replace(/\.00$/, "") : 0}%`;
  }
  return formatDisplayValue(value as string | number | boolean | null | undefined, type);
}
