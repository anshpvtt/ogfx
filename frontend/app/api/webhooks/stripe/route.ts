import { headers } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import Stripe from "stripe";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getStripe, planFromPriceId } from "@/lib/stripe";

export const runtime = "nodejs";

async function upsertSubscription(subscription: Stripe.Subscription, fallbackUserId?: string | null) {
  const admin = createSupabaseAdminClient();
  const item = subscription.items.data[0];
  const priceId = item?.price.id;
  const userId = subscription.metadata.user_id || fallbackUserId;

  if (!userId) return;
  const plan = subscription.metadata.plan || planFromPriceId(priceId);
  const status = subscription.status;

  await admin.from("subscriptions").upsert(
    {
      user_id: userId,
      stripe_customer_id: String(subscription.customer),
      stripe_subscription_id: subscription.id,
      plan,
      status,
      current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
    },
    { onConflict: "user_id" }
  );

  await admin
    .from("profiles")
    .update({
      subscription_tier: plan,
      subscription_status: status,
      stripe_customer_id: String(subscription.customer),
      stripe_subscription_id: subscription.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", userId);
}

export async function POST(request: NextRequest) {
  const stripe = getStripe();
  const signature = (await headers()).get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!signature || !secret) {
    return NextResponse.json({ error: "Missing Stripe webhook configuration" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    const rawBody = await request.text();
    event = stripe.webhooks.constructEvent(rawBody, signature, secret);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid webhook payload";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    if (session.subscription) {
      const subscription = await stripe.subscriptions.retrieve(String(session.subscription));
      await upsertSubscription(subscription, session.client_reference_id);
    }
  }

  if (event.type === "customer.subscription.updated") {
    await upsertSubscription(event.data.object as Stripe.Subscription);
  }

  if (event.type === "customer.subscription.deleted") {
    const subscription = event.data.object as Stripe.Subscription;
    await admin
      .from("subscriptions")
      .update({ status: "canceled", current_period_end: new Date(subscription.current_period_end * 1000).toISOString() })
      .eq("stripe_subscription_id", subscription.id);
    await admin
      .from("profiles")
      .update({
        subscription_status: "canceled",
        subscription_tier: "free",
        stripe_subscription_id: subscription.id,
        updated_at: new Date().toISOString(),
      })
      .eq("stripe_subscription_id", subscription.id);
  }

  return NextResponse.json({ received: true });
}
