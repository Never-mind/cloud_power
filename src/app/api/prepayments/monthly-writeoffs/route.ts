import { NextRequest, NextResponse } from "next/server";
import { listMonthlyPrepaymentWriteOffFilterOptions, listMonthlyPrepaymentWriteOffs } from "@/lib/prepayment-service";

export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get("field")) {
    return NextResponse.json(await listMonthlyPrepaymentWriteOffFilterOptions(request.nextUrl.searchParams));
  }
  const data = await listMonthlyPrepaymentWriteOffs(request.nextUrl.searchParams);
  return NextResponse.json(data);
}
