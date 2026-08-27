import { NextRequest, NextResponse } from "next/server";
import {
  listPrepaymentWriteOffAdjustments,
  listPrepaymentAdjustmentFilterOptions,
  savePrepaymentWriteOffAdjustment,
} from "@/lib/prepayment-adjustment-service";

export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get("field")) {
    return NextResponse.json(await listPrepaymentAdjustmentFilterOptions(request.nextUrl.searchParams));
  }
  const data = await listPrepaymentWriteOffAdjustments(request.nextUrl.searchParams);
  return NextResponse.json(data);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const data = await savePrepaymentWriteOffAdjustment({
      adjustmentNo: String(body.adjustmentNo ?? ""),
      reason: String(body.reason ?? ""),
      monthlyWriteOffIds: Array.isArray(body.monthlyWriteOffIds) ? body.monthlyWriteOffIds.map(String) : [],
      adjustedAmounts: typeof body.adjustedAmounts === "object" && body.adjustedAmounts ? body.adjustedAmounts : {},
    });

    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "创建失败" }, { status: 400 });
  }
}
