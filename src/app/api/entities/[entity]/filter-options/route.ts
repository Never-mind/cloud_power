import { NextRequest, NextResponse } from "next/server";
import { getEntityConfig } from "@/lib/modules";
import { listEntityFilterOptions } from "@/lib/crud";

export async function GET(request: NextRequest, context: { params: Promise<{ entity: string }> }) {
  const { entity } = await context.params;
  const config = getEntityConfig(entity);
  if (!config) return NextResponse.json({ error: "Unknown entity" }, { status: 404 });

  try {
    return NextResponse.json(await listEntityFilterOptions(config, request.nextUrl.searchParams));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "筛选候选值加载失败" }, { status: 400 });
  }
}
