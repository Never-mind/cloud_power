import { NextRequest, NextResponse } from "next/server";
import {
  createBillingStatementSnapshot,
  listBillingStatementFilterOptions,
  listBillingStatementSnapshots,
  previewBillingStatement,
} from "@/lib/billing-statement-service";

export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get("field")) {
    return NextResponse.json(await listBillingStatementFilterOptions(request.nextUrl.searchParams));
  }
  const mode = request.nextUrl.searchParams.get("mode");
  if (mode === "preview") {
    try {
      const data = await previewBillingStatement({
        countryCode: request.nextUrl.searchParams.get("countryCode") ?? "",
        currency: request.nextUrl.searchParams.get("currency") ?? "",
        startDate: request.nextUrl.searchParams.get("startDate") ?? "",
        endDate: request.nextUrl.searchParams.get("endDate") ?? "",
      });
      return NextResponse.json(data);
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "预览失败" }, { status: 400 });
    }
  }

  const data = await listBillingStatementSnapshots(request.nextUrl.searchParams);
  return NextResponse.json(data);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const data = await createBillingStatementSnapshot({
      snapshotNo: String(body.snapshotNo ?? ""),
      filters: {
        countryCode: String(body.countryCode ?? ""),
        currency: String(body.currency ?? ""),
        startDate: String(body.startDate ?? ""),
        endDate: String(body.endDate ?? ""),
      },
    });
    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "生成快照失败" }, { status: 400 });
  }
}
