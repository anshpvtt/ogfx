import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { error: "Billing is paused. Subscription management is temporarily disabled." },
    { status: 503 }
  );
}
