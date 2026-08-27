import { NextRequest, NextResponse } from "next/server";
import { listOrderFilterOptions, listOrderRows } from "@/lib/order-list-service";

export async function GET(request: NextRequest) {
  try {
    if (request.nextUrl.searchParams.get("mode") && request.nextUrl.searchParams.get("field")) {
      return NextResponse.json(await listOrderFilterOptions(request.nextUrl.searchParams));
    }
    return NextResponse.json(await listOrderRows(request.nextUrl.searchParams));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "订单列表加载失败" }, { status: 500 });
  }
}
