import { NextResponse, type NextRequest } from "next/server";
import { chunkStrategyText, extractStrategyFromPdf } from "@/lib/ai/strategy-parser";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function safeFileName(name: string) {
  return name.replace(/[^a-z0-9.\-_]+/gi, "-").replace(/-+/g, "-").slice(0, 120) || "strategy.pdf";
}

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "PDF file is required" }, { status: 400 });
  }
  if (file.type && file.type !== "application/pdf") {
    return NextResponse.json({ error: "Only PDF strategy files are supported" }, { status: 415 });
  }
  if (file.size > 10 * 1024 * 1024) {
    return NextResponse.json({ error: "Strategy PDF must be 10MB or smaller" }, { status: 413 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const rawText = await extractStrategyFromPdf(buffer);
  if (!rawText) {
    return NextResponse.json({ error: "Could not extract text from this PDF" }, { status: 422 });
  }

  const name = String(formData?.get("name") || file.name || "OGFX strategy").slice(0, 120);
  const description = String(formData?.get("description") || "").slice(0, 500) || null;
  const objectPath = `${user.id}/${Date.now()}-${safeFileName(file.name)}`;
  const { error: uploadError } = await supabase.storage
    .from("strategies")
    .upload(objectPath, buffer, {
      contentType: "application/pdf",
      upsert: false,
    });

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  await supabase
    .from("user_strategies")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .eq("is_active", true);

  const chunks = chunkStrategyText(rawText);
  const { data, error } = await supabase
    .from("user_strategies")
    .insert({
      user_id: user.id,
      name,
      description,
      file_url: objectPath,
      raw_text: rawText,
      chunks,
      is_active: true,
    })
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    success: true,
    strategyId: data.id,
    textPreview: rawText.slice(0, 400),
    chunks: chunks.length,
  });
}
