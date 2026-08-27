import { NextRequest, NextResponse } from "next/server";
import { listProductLineFilterOptions, listPurchaseProductLines } from "@/lib/product-lines-service";

export async function GET(request: NextRequest) {
  try {
    if (request.nextUrl.searchParams.get("field")) {
      const params = new URLSearchParams(request.nextUrl.searchParams);
      params.set("mode", "purchase");
      return NextResponse.json(await listProductLineFilterOptions(params));
    }
    return NextResponse.json(await listPurchaseProductLines(request.nextUrl.searchParams));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "采购明细加载失败" }, { status: 500 });
  }
}
