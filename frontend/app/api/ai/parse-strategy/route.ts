import { NextResponse, type NextRequest } from "next/server";
import { chunkStrategyText, extractStrategyFromPdf } from "@/lib/ai/strategy-parser";
import { extractStrategyFromYoutube } from "@/lib/ai/youtube-strategy";
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
  const strategyFile = file instanceof File && file.size > 0 ? file : null;
  const hasFile = Boolean(strategyFile);
  const youtubeUrl = String(formData?.get("youtubeUrl") || "").trim();
  const notes = String(formData?.get("notes") || "").trim();
  const descriptionInput = String(formData?.get("description") || "").slice(0, 500);

  if (!hasFile && !youtubeUrl && !notes) {
    return NextResponse.json({ error: "Add a PDF, YouTube strategy link, or pasted strategy notes" }, { status: 400 });
  }
  if (strategyFile?.type && strategyFile.type !== "application/pdf") {
    return NextResponse.json({ error: "Only PDF strategy files are supported" }, { status: 415 });
  }
  if (strategyFile && strategyFile.size > 10 * 1024 * 1024) {
    return NextResponse.json({ error: "Strategy PDF must be 10MB or smaller" }, { status: 413 });
  }

  const rawParts: string[] = [];
  const sourceNotes: string[] = [];
  let buffer: Buffer | null = null;
  let objectPath: string | null = null;
  let warning: string | null = null;

  if (strategyFile) {
    buffer = Buffer.from(await strategyFile.arrayBuffer());
    const pdfText = await extractStrategyFromPdf(buffer);
    if (!pdfText) {
      return NextResponse.json({ error: "Could not extract text from this PDF" }, { status: 422 });
    }
    rawParts.push(`PDF STRATEGY SOURCE: ${strategyFile.name}\n\n${pdfText}`);
    sourceNotes.push(`PDF: ${strategyFile.name}`);
  }

  if (youtubeUrl) {
    try {
      const youtube = await extractStrategyFromYoutube(youtubeUrl);
      rawParts.push(`YOUTUBE STRATEGY SOURCE: ${youtube.title}\nURL: ${youtubeUrl}\n\n${youtube.text}`);
      sourceNotes.push(`YouTube: ${youtube.title}`);
    } catch (error: any) {
      warning = error?.message || "Could not extract YouTube transcript";
      if (!rawParts.length && !notes) {
        return NextResponse.json({ error: warning }, { status: 422 });
      }
      sourceNotes.push(`YouTube link provided, transcript unavailable: ${youtubeUrl}`);
    }
  }

  if (notes) {
    rawParts.push(`PASTED STRATEGY NOTES:\n\n${notes}`);
    sourceNotes.push("Pasted notes");
  }

  if (!rawParts.length) {
    return NextResponse.json({ error: "No usable strategy text was extracted" }, { status: 422 });
  }

  const rawText = rawParts.join("\n\n---\n\n");
  const name = String(formData?.get("name") || (strategyFile ? strategyFile.name : "OGFX strategy")).slice(0, 120);
  const description = [descriptionInput, ...sourceNotes].filter(Boolean).join(" | ").slice(0, 500) || null;

  if (strategyFile && buffer) {
    objectPath = `${user.id}/${Date.now()}-${safeFileName(strategyFile.name)}`;
    const { error: uploadError } = await supabase.storage
      .from("strategies")
      .upload(objectPath, buffer, {
        contentType: "application/pdf",
        upsert: false,
      });

    if (uploadError) {
      return NextResponse.json({ error: uploadError.message }, { status: 500 });
    }
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
    warning,
  });
}
