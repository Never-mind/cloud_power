import { NextRequest, NextResponse } from "next/server";
import { listInternalServiceFeeFilterOptions, listInternalServiceFees, syncInternalServiceLedgers } from "@/lib/internal-service-fee-service";

export async function GET(request: NextRequest) {
  try {
    if (request.nextUrl.searchParams.get("field")) {
      return NextResponse.json(await listInternalServiceFeeFilterOptions(request.nextUrl.searchParams));
    }
    return NextResponse.json(await listInternalServiceFees(request.nextUrl.searchParams));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "内部服务费加载失败" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    return NextResponse.json(await syncInternalServiceLedgers(Array.isArray(body.ledgerIds) ? body.ledgerIds.map(String) : undefined));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "内部服务费生成失败" }, { status: 400 });
  }
}
