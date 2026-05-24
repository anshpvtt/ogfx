import { NextResponse, type NextRequest } from "next/server";
import { getStripe } from "@/lib/stripe";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const { plan } = await request.json().catch(() => ({ plan: null }));
  const priceId =
    plan === "elite"
      ? process.env.STRIPE_ELITE_PRICE_ID
      : plan === "pro"
        ? process.env.STRIPE_PRO_PRICE_ID
        : null;

  if (!priceId) {
    return NextResponse.json({ error: "Unknown plan" }, { status: 400 });
  }

  const origin = request.nextUrl.origin;
  const stripe = getStripe();
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer_email: user.email,
    client_reference_id: user.id,
    line_items: [{ price: priceId, quantity: 1 }],
    metadata: { user_id: user.id, plan },
    subscription_data: {
      metadata: { user_id: user.id, plan },
    },
    success_url: `${origin}/dashboard?upgraded=true`,
    cancel_url: `${origin}/pricing?canceled=true`,
  });

  return NextResponse.json({ url: session.url });
}
