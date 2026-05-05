import { NextRequest, NextResponse } from "next/server";
import { portfolioSummary } from "@/lib/store";

export async function GET(request: NextRequest) {
  const propertyId = request.nextUrl.searchParams.get("propertyId");
  return NextResponse.json(await portfolioSummary(propertyId ? Number(propertyId) : undefined));
}
