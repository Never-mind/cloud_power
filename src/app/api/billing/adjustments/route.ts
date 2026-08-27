import { NextRequest, NextResponse } from "next/server";
import { listBillingAdjustmentFilterOptions, listBillingAdjustments, saveBillingAdjustmentDraft } from "@/lib/billing-service";

export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get("field")) {
    return NextResponse.json(await listBillingAdjustmentFilterOptions(request.nextUrl.searchParams));
  }
  const data = await listBillingAdjustments(request.nextUrl.searchParams);
  return NextResponse.json(data);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const data = await saveBillingAdjustmentDraft({
      adjustmentNo: String(body.adjustmentNo ?? ""),
      instanceContractNo: String(body.instanceContractNo ?? ""),
      reason: String(body.reason ?? ""),
      items: Array.isArray(body.items) ? body.items : [],
    });
    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "创建失败" }, { status: 400 });
  }
}
