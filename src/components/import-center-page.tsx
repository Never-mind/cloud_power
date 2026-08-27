"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, RefreshCw, Upload } from "lucide-react";
import { formatDisplayValue } from "@/lib/display-format";
import { DEFAULT_PAGE_SIZE } from "@/lib/pagination";
import { PaginationBar } from "./pagination-bar";
import { StickyTable } from "./sticky-table";
import { Button, Panel } from "./ui";

type ImportTarget = {
  key: string;
  title: string;
  description: string;
  columns: Array<{ key: string; label: string; required?: boolean; note?: string }>;
};

type ImportJob = {
  jobId: string;
  targetKey: string;
  targetTitle: string;
  fileName: string;
  status: string;
  totalRows: number;
  successRows: number;
  failedRows: number;
  masterCount: number;
  detailCount: number;
  createdAt: string;
  updatedAt: string;
  confirmedAt?: string | null;
};

type ImportPreview = {
  jobId: string;
  targetKey: string;
  status: string;
  report: {
    total: number;
    success: number;
    failed: Array<{ rowNumber: number; primaryKey: string; error: string }>;
  };
  summary: { masterCount: number; detailCount: number };
  strategy?: ImportStrategy;
  execution?: { create: number; updateDraft: number; updateConfirmed: number; skip: number };
};

type ImportStrategy = "create-only" | "overwrite-drafts" | "overwrite-all";

const strategyOptions: Array<{ value: ImportStrategy; label: string; description: string }> = [
  { value: "create-only", label: "仅新增", description: "已存在的数据跳过" },
  { value: "overwrite-drafts", label: "覆盖草稿", description: "仅更新草稿，已确认数据跳过" },
  { value: "overwrite-all", label: "覆盖全部", description: "更新草稿及已确认数据，需二次确认" },
];

export function ImportCenterPage() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [targets, setTargets] = useState<ImportTarget[]>([]);
  const [jobs, setJobs] = useState<ImportJob[]>([]);
  const [jobTotal, setJobTotal] = useState(0);
  const [jobPage, setJobPage] = useState(1);
  const [jobPageSize, setJobPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [targetKey, setTargetKey] = useState("");
  const [strategy, setStrategy] = useState<ImportStrategy>("overwrite-drafts");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const currentTarget = useMemo(
    () => targets.find((target) => target.key === targetKey) ?? targets[0],
    [targetKey, targets],
  );

  async function loadData(next?: { page?: number; pageSize?: number }) {
    setLoading(true);
    const nextPage = next?.page ?? jobPage;
    const nextPageSize = next?.pageSize ?? jobPageSize;
    const params = new URLSearchParams({
      page: String(nextPage),
      pageSize: String(nextPageSize),
    });
    const response = await fetch(`/api/import-center?${params.toString()}`);
    const data = await response.json();
    setTargets(data.targets ?? []);
    setJobs(data.jobs ?? []);
    setJobTotal(data.pagination?.total ?? 0);
    setJobPage(data.pagination?.page ?? nextPage);
    setJobPageSize(data.pagination?.pageSize ?? nextPageSize);
    setTargetKey((current) => current || data.targets?.[0]?.key || "");
    setLoading(false);
  }

  useEffect(() => {
    void loadData();
  }, [jobPage, jobPageSize]);

  async function uploadFile(file: File) {
    if (!currentTarget) return;
    setUploading(true);
    const formData = new FormData();
    formData.set("targetKey", currentTarget.key);
    formData.set("strategy", strategy);
    formData.set("file", file);
    const response = await fetch("/api/import-center/preview", { method: "POST", body: formData });
    const data = await response.json();
    setUploading(false);
    if (!response.ok) {
      alert(data.error ?? "上传失败");
      return;
    }
    setPreview(data);
    setJobPage(1);
    await loadData({ page: 1 });
  }

  async function confirmImport() {
    if (!preview) return;
    const allowConfirmed = preview.strategy === "overwrite-all";
    if (allowConfirmed && !window.confirm("将覆盖已确认单据及其明细。此操作会直接刷新已确认数据，是否继续？")) return;
    setConfirming(true);
    const response = await fetch("/api/import-center/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: preview.jobId, allowConfirmed }),
    });
    const data = await response.json();
    setConfirming(false);
    if (!response.ok) {
      alert(data.error ?? "确认导入失败");
      return;
    }
    const shipmentSync = data.job?.shipmentSync;
    if (shipmentSync && preview.targetKey === "purchase-orders") {
      alert(
        `采购订单导入完成。已确认采购订单同步 ${shipmentSync.orderCount ?? 0} 张，新增 ${shipmentSync.created ?? 0} 条物流数据，更新 ${shipmentSync.updated ?? 0} 条物流数据。`,
      );
    }
    setPreview(null);
    setJobPage(1);
    await loadData({ page: 1 });
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <div>
          <h1 className="text-xl font-medium text-[#303133]">数据导入中心</h1>
          <p className="mt-1 text-sm text-[#909399]">
            统一管理模板下载、文件上传、导入预览、错误报告和导入历史；主从单据会按模板规则自动生成。
          </p>
        </div>
        <Button className="ml-auto" onClick={() => void loadData()}>
          <RefreshCw size={15} />
          {loading ? "刷新中" : "刷新"}
        </Button>
      </div>

      <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
        <Panel className="p-3">
          <div className="mb-2 px-2 text-sm font-medium text-[#303133]">导入类型</div>
          <div className="space-y-2">
            {targets.map((target) => (
              <button
                className={`w-full border px-3 py-3 text-left text-sm ${
                  currentTarget?.key === target.key
                    ? "border-[#1890ff] bg-[#ecf5ff] text-[#1890ff]"
                    : "border-[#ebeef5] bg-white text-[#606266] hover:border-[#c6e2ff]"
                }`}
                key={target.key}
                type="button"
                onClick={() => {
                  setTargetKey(target.key);
                  setPreview(null);
                }}
              >
                <div className="font-medium">{target.title}</div>
                <div className="mt-1 text-xs text-[#909399]">{target.description}</div>
              </button>
            ))}
          </div>
        </Panel>

        <div className="space-y-5">
          <Panel>
            <div className="flex flex-wrap items-center gap-3 border-b border-[#ebeef5] p-4">
              <div>
                <div className="font-medium text-[#303133]">{currentTarget?.title ?? "请选择导入类型"}</div>
                <div className="mt-1 text-xs text-[#909399]">{currentTarget?.description}</div>
              </div>
              {currentTarget ? (
                <>
                  <a className="ml-auto" href={`/api/import-center/template?target=${encodeURIComponent(currentTarget.key)}`}>
                    <Button type="button">
                      <Download size={15} />
                      下载模板
                    </Button>
                  </a>
                  <Button type="button" tone="primary" onClick={() => fileInputRef.current?.click()}>
                    <Upload size={15} />
                    {uploading ? "上传中" : "上传预览"}
                  </Button>
                  <input
                    accept=".xlsx,.xls,.csv"
                    className="hidden"
                    ref={fileInputRef}
                    type="file"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      if (file) void uploadFile(file);
                    }}
                  />
                </>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-3 border-b border-[#ebeef5] bg-[#fafafa] px-4 py-3">
              <span className="text-sm font-medium text-[#303133]">导入策略</span>
              <select
                className="h-9 min-w-[180px] border border-[#dcdfe6] bg-white px-2 text-sm text-[#303133] outline-none focus:border-[#1890ff]"
                value={strategy}
                onChange={(event) => {
                  setStrategy(event.target.value as ImportStrategy);
                  setPreview(null);
                }}
              >
                {strategyOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              <span className="text-xs text-[#909399]">{strategyOptions.find((option) => option.value === strategy)?.description}</span>
            </div>

            <div className="grid gap-4 p-4 lg:grid-cols-[1fr_320px]">
              <StickyTable className="overflow-auto" tableKey="import-center-columns">
                <table className="min-w-full border-collapse text-sm">
                  <thead className="bg-[#f5f7fa]">
                    <tr>
                      <th className="border-b border-r border-[#ebeef5] px-3 py-2 text-left">字段</th>
                      <th className="border-b border-r border-[#ebeef5] px-3 py-2 text-left">列名</th>
                      <th className="border-b border-r border-[#ebeef5] px-3 py-2 text-left">要求</th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentTarget?.columns.map((column) => (
                      <tr key={column.key}>
                        <td className="border-b border-r border-[#ebeef5] px-3 py-2">{column.key}</td>
                        <td className="border-b border-r border-[#ebeef5] px-3 py-2">{column.label}</td>
                        <td className="border-b border-r border-[#ebeef5] px-3 py-2">
                          {column.required ? "必填" : "可选"}{column.note ? `，${column.note}` : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </StickyTable>

              <div className="border border-[#ebeef5] bg-[#fafafa] p-4">
                <div className="mb-3 flex items-center gap-2 font-medium text-[#303133]">
                  <FileSpreadsheet size={16} />
                  导入预览
                </div>
                {preview ? (
                  <div className="space-y-3 text-sm text-[#606266]">
                    <Metric label="任务编号" value={preview.jobId} />
                    <Metric label="总行数" value={preview.report.total} />
                    <Metric label="可导入行数" value={preview.report.success} />
                    <Metric label="失败行数" value={preview.report.failed.length} />
                    <Metric label="生成主单" value={preview.summary.masterCount} />
                    <Metric label="生成明细" value={preview.summary.detailCount} />
                    <Metric label="新增记录" value={preview.execution?.create ?? 0} />
                    <Metric label="覆盖草稿" value={preview.execution?.updateDraft ?? 0} />
                    <Metric label="覆盖已确认" value={preview.execution?.updateConfirmed ?? 0} />
                    <Metric label="跳过记录" value={preview.execution?.skip ?? 0} />
                    {preview.strategy === "overwrite-all" && (preview.execution?.updateConfirmed ?? 0) > 0 ? (
                      <div className="flex gap-2 border border-[#fde2e2] bg-[#fef0f0] p-2 text-xs text-[#f56c6c]">
                        <AlertTriangle size={15} className="shrink-0" />
                        已确认单据将按导入文件覆盖，确认导入时需再次确认。
                      </div>
                    ) : null}
                    {preview.report.failed.length ? (
                      <a href={`/api/import-center/jobs/${encodeURIComponent(preview.jobId)}/errors`}>
                        <Button className="w-full" type="button">下载错误报告</Button>
                      </a>
                    ) : (
                      <Button className="w-full" disabled={confirming} tone="success" onClick={() => void confirmImport()}>
                        <CheckCircle2 size={15} />
                        {confirming ? "导入中" : "确认导入"}
                      </Button>
                    )}
                  </div>
                ) : (
                  <div className="text-sm text-[#909399]">上传模板文件后，系统会先预览校验，不会立即写入数据库。</div>
                )}
              </div>
            </div>
          </Panel>

          <Panel>
            <div className="border-b border-[#ebeef5] px-4 py-3 font-medium text-[#303133]">导入历史</div>
            <StickyTable className="overflow-auto" tableKey="import-center-history">
              <table className="min-w-full border-collapse text-sm">
                <thead className="bg-[#f5f7fa]">
                  <tr>
                    {["任务编号", "导入类型", "文件名", "状态", "总行数", "成功", "失败", "主单", "明细", "创建时间", "更新时间", "操作"].map((label) => (
                      <th className="whitespace-nowrap border-b border-r border-[#ebeef5] px-3 py-3 text-left" key={label}>{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((job) => (
                    <tr className="hover:bg-[#fafafa]" key={job.jobId}>
                      <td className="whitespace-nowrap border-b border-r border-[#ebeef5] px-3 py-3">{job.jobId}</td>
                      <td className="whitespace-nowrap border-b border-r border-[#ebeef5] px-3 py-3">{job.targetTitle}</td>
                      <td className="whitespace-nowrap border-b border-r border-[#ebeef5] px-3 py-3">{job.fileName}</td>
                      <td className="whitespace-nowrap border-b border-r border-[#ebeef5] px-3 py-3">{job.status}</td>
                      <td className="whitespace-nowrap border-b border-r border-[#ebeef5] px-3 py-3">{job.totalRows}</td>
                      <td className="whitespace-nowrap border-b border-r border-[#ebeef5] px-3 py-3">{job.successRows}</td>
                      <td className="whitespace-nowrap border-b border-r border-[#ebeef5] px-3 py-3">{job.failedRows}</td>
                      <td className="whitespace-nowrap border-b border-r border-[#ebeef5] px-3 py-3">{job.masterCount}</td>
                      <td className="whitespace-nowrap border-b border-r border-[#ebeef5] px-3 py-3">{job.detailCount}</td>
                      <td className="whitespace-nowrap border-b border-r border-[#ebeef5] px-3 py-3">{formatDisplayValue(job.createdAt)}</td>
                      <td className="whitespace-nowrap border-b border-r border-[#ebeef5] px-3 py-3">{formatDisplayValue(job.updatedAt)}</td>
                      <td className="whitespace-nowrap border-b border-r border-[#ebeef5] px-3 py-3">
                        <a className="text-[#1890ff] hover:underline" href={`/api/import-center/jobs/${encodeURIComponent(job.jobId)}/errors`}>
                          错误报告
                        </a>
                      </td>
                    </tr>
                  ))}
                  {!jobs.length ? (
                    <tr>
                      <td className="py-10 text-center text-[#909399]" colSpan={12}>暂无导入历史</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </StickyTable>
            <PaginationBar
              page={jobPage}
              pageSize={jobPageSize}
              total={jobTotal}
              onPageChange={setJobPage}
              onPageSizeChange={setJobPageSize}
            />
          </Panel>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-[#909399]">{label}</span>
      <span className="text-right font-medium text-[#303133]">{String(value ?? "-")}</span>
    </div>
  );
}
