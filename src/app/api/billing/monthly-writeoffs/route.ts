import { NextRequest, NextResponse } from "next/server";
import { listMonthlyBillingWriteOffFilterOptions, listMonthlyBillingWriteOffs } from "@/lib/billing-service";

export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get("field")) {
    return NextResponse.json(await listMonthlyBillingWriteOffFilterOptions(request.nextUrl.searchParams));
  }
  const data = await listMonthlyBillingWriteOffs(request.nextUrl.searchParams);
  return NextResponse.json(data);
}
