import { NextRequest, NextResponse } from "next/server";
import { deleteEcm, updateEcmStatus } from "@/lib/store";
import type { EcmStatus } from "@/lib/types";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const body = (await request.json()) as { status: EcmStatus; approved: boolean };
  const updated = await updateEcmStatus(Number(id), body.status, Boolean(body.approved));
  if (!updated) {
    return NextResponse.json({ error: "ECM not found" }, { status: 404 });
  }
  return NextResponse.json(updated);
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const deleted = await deleteEcm(Number(id));
  if (!deleted) {
    return NextResponse.json({ error: "ECM not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
