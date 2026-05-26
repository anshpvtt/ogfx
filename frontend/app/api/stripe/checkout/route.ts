import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { error: "Billing is paused. All OGFX features are currently unlocked for every user." },
    { status: 503 }
  );
}
