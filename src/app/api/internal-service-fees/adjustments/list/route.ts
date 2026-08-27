import { NextRequest, NextResponse } from "next/server";
import { listInternalServiceAdjustmentFilterOptions, listInternalServiceAdjustments } from "@/lib/internal-service-fee-service";

export async function GET(request: NextRequest) {
  try {
    if (request.nextUrl.searchParams.has("field")) return NextResponse.json(await listInternalServiceAdjustmentFilterOptions(request.nextUrl.searchParams));
    return NextResponse.json(await listInternalServiceAdjustments(request.nextUrl.searchParams));
  }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "调整单加载失败" }, { status: 500 }); }
}
