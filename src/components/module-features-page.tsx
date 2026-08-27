"use client";

import { useEffect, useState } from "react";
import { Check, RefreshCw, Save, ShieldOff } from "lucide-react";
import { Button, Panel } from "./ui";
import { StickyTable } from "./sticky-table";

type Feature = {
  key: string;
  title: string;
  groupTitle: string;
  childGroupTitle?: string;
  route: string;
  enabled: boolean;
  defaultEnabled: boolean;
  remark: string;
};

export function ModuleFeaturesPage() {
  const [features, setFeatures] = useState<Feature[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const response = await fetch("/api/system/module-features", { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "功能模块配置加载失败");
      setFeatures(data.features ?? []);
      setIsAdmin(data.isAdmin === true);
    } catch (error) {
      alert(error instanceof Error ? error.message : "功能模块配置加载失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function toggle(feature: Feature) {
    if (!isAdmin) return;
    setSaving(feature.key);
    try {
      const response = await fetch("/api/system/module-features", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ moduleKey: feature.key, enabled: !feature.enabled }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "功能模块状态更新失败");
      setFeatures(data.features ?? []);
      window.parent.postMessage({ type: "cloud-power:module-features-updated" }, window.location.origin);
    } catch (error) {
      alert(error instanceof Error ? error.message : "功能模块状态更新失败");
    } finally {
      setSaving(null);
    }
  }

  return <Panel className="overflow-hidden">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#ebeef5] p-4">
      <div><h1 className="font-medium text-[#303133]">功能模块管理</h1><p className="mt-1 text-sm text-[#909399]">停用后模块不会出现在左侧目录和首页，代码及业务数据仍会保留。</p></div>
      <Button onClick={() => void load()}><RefreshCw size={15} />刷新</Button>
    </div>
    {!isAdmin && !loading ? <div className="border-b border-[#f5dab1] bg-[#fdf6ec] px-4 py-3 text-sm text-[#a66b00]">当前账号没有修改权限，仅可查看模块状态。</div> : null}
    <StickyTable className="table-scroll overflow-auto" tableKey="module-features">
      <table className="min-w-[900px] w-full border-collapse text-sm">
        <thead className="bg-[#f5f7fa]"><tr>{["模块名称", "所属目录", "路由", "默认状态", "当前状态", "操作"].map((label) => <th className="whitespace-nowrap border-b border-r border-[#ebeef5] px-4 py-3 text-left font-medium" key={label}>{label}</th>)}</tr></thead>
        <tbody>
          {features.map((feature) => <tr key={feature.key}>
            <td className="border-b border-r border-[#ebeef5] px-4 py-3 font-medium text-[#303133]">{feature.title}</td>
            <td className="border-b border-r border-[#ebeef5] px-4 py-3 text-[#606266]">{feature.childGroupTitle ? `${feature.groupTitle} / ${feature.childGroupTitle}` : feature.groupTitle}</td>
            <td className="border-b border-r border-[#ebeef5] px-4 py-3 font-mono text-xs text-[#909399]">{feature.route}</td>
            <td className="border-b border-r border-[#ebeef5] px-4 py-3">{feature.defaultEnabled ? "启用" : "停用"}</td>
            <td className="border-b border-r border-[#ebeef5] px-4 py-3"><span className={`inline-flex items-center gap-1 ${feature.enabled ? "text-[#67c23a]" : "text-[#909399]"}`}>{feature.enabled ? <Check size={15} /> : <ShieldOff size={15} />}{feature.enabled ? "已启用" : "已停用"}</span></td>
            <td className="border-b border-[#ebeef5] px-4 py-3"><Button disabled={!isAdmin || saving === feature.key} onClick={() => void toggle(feature)}>{saving === feature.key ? <RefreshCw className="animate-spin" size={15} /> : <Save size={15} />}{feature.enabled ? "停用" : "启用"}</Button></td>
          </tr>)}
          {!loading && !features.length ? <tr><td className="py-10 text-center text-[#909399]" colSpan={6}>无数据</td></tr> : null}
          {loading ? <tr><td className="py-10 text-center text-[#909399]" colSpan={6}>加载中</td></tr> : null}
        </tbody>
      </table>
    </StickyTable>
  </Panel>;
}
