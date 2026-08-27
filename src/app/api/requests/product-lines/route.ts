import { NextRequest, NextResponse } from "next/server";
import { listProductLineFilterOptions, listRequestProductLines } from "@/lib/product-lines-service";

export async function GET(request: NextRequest) {
  try {
    if (request.nextUrl.searchParams.get("field")) {
      const params = new URLSearchParams(request.nextUrl.searchParams);
      params.set("mode", "request");
      return NextResponse.json(await listProductLineFilterOptions(params));
    }
    return NextResponse.json(await listRequestProductLines(request.nextUrl.searchParams));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "需求明细加载失败" }, { status: 500 });
  }
}
