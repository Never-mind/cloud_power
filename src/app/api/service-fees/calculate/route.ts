import { NextRequest, NextResponse } from "next/server";
import { calculateServiceFees, listServiceFeeFilterOptions } from "@/lib/service-fee-service";

export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get("field")) {
    return NextResponse.json(await listServiceFeeFilterOptions(request.nextUrl.searchParams));
  }
  const data = await calculateServiceFees(request.nextUrl.searchParams);
  return NextResponse.json(data);
}
