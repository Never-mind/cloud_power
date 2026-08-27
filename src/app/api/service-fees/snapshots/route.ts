import { NextRequest, NextResponse } from "next/server";
import { createServiceFeeStatementDraft, listServiceFeeStatementFilterOptions, listServiceFeeStatements } from "@/lib/service-fee-service";

export async function GET(request: NextRequest) {
  try {
    if (request.nextUrl.searchParams.get("field")) {
      return NextResponse.json(await listServiceFeeStatementFilterOptions(request.nextUrl.searchParams));
    }
    return NextResponse.json(await listServiceFeeStatements(request.nextUrl.searchParams));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "服务费对账单加载失败" }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const data = await createServiceFeeStatementDraft({
      snapshotNo: body.snapshotNo,
      filters: body.filters ?? {},
    });
    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "服务费对账单生成失败" }, { status: 400 });
  }
}
