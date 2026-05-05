import { NextRequest, NextResponse } from "next/server";
import { createEcm, listEcms } from "@/lib/store";
import type { EcmInput } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const propertyId = request.nextUrl.searchParams.get("propertyId");
  return NextResponse.json(await listEcms(propertyId ? Number(propertyId) : undefined));
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as EcmInput;
  if (!body.title?.trim()) {
    return NextResponse.json({ error: "ECM title is required" }, { status: 400 });
  }
  return NextResponse.json(await createEcm(body), { status: 201 });
}
