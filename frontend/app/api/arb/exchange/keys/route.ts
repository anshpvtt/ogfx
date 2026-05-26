import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { EXCHANGES_SIMULATED } from "@/lib/cryptoPriceFeed";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

function encryptionSecret() {
  return process.env.ARB_KEY_ENCRYPTION_SECRET || process.env.JWT_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "ogfx-local-dev-only";
}

function encrypt(value: string) {
  if (!value) return null;
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(encryptionSecret(), "ogfx-arb-exchange-keys", 32);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString("base64")}:${tag.toString("base64")}:${ciphertext.toString("base64")}`;
}

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const { data, error } = await supabase
    .from("arb_exchange_keys")
    .select("exchange_name,is_active,created_at,api_key_encrypted,secret_encrypted")
    .eq("user_id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const rows = EXCHANGES_SIMULATED.map((exchange) => {
    const row = (data ?? []).find((item: any) => item.exchange_name === exchange);
    return {
      exchangeName: exchange,
      isActive: Boolean(row?.is_active),
      hasApiKey: Boolean(row?.api_key_encrypted),
      hasSecret: Boolean(row?.secret_encrypted),
      createdAt: row?.created_at ?? null,
    };
  });
  return NextResponse.json({ exchanges: rows });
}

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const exchangeName = String(body?.exchangeName || "");
  if (!EXCHANGES_SIMULATED.includes(exchangeName as any)) {
    return NextResponse.json({ error: "Unknown exchange" }, { status: 400 });
  }

  const { error } = await supabase
    .from("arb_exchange_keys")
    .upsert({
      user_id: user.id,
      exchange_name: exchangeName,
      api_key_encrypted: encrypt(String(body?.apiKey || "")),
      secret_encrypted: encrypt(String(body?.secret || "")),
      is_active: Boolean(body?.isActive),
      created_at: new Date().toISOString(),
    }, { onConflict: "user_id,exchange_name" });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
