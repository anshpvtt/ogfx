function extractVideoId(url: string) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes("youtu.be")) return parsed.pathname.slice(1).split("/")[0] || "";
    if (parsed.hostname.includes("youtube.com")) {
      if (parsed.pathname.startsWith("/shorts/")) return parsed.pathname.split("/")[2] || "";
      return parsed.searchParams.get("v") || "";
    }
  } catch {
    return "";
  }
  return "";
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function extractPlayerResponse(html: string) {
  const marker = "ytInitialPlayerResponse = ";
  const start = html.indexOf(marker);
  if (start < 0) return null;
  const jsonStart = start + marker.length;
  const end = html.indexOf(";</script>", jsonStart);
  if (end < 0) return null;
  try {
    return JSON.parse(html.slice(jsonStart, end));
  } catch {
    return null;
  }
}

export async function extractStrategyFromYoutube(url: string) {
  const videoId = extractVideoId(url);
  if (!videoId) throw new Error("Invalid YouTube URL");

  const response = await fetch(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`, {
    headers: { "User-Agent": "Mozilla/5.0 OGFX Strategy Analyzer" },
  });
  const html = await response.text();
  if (!response.ok) throw new Error(`Could not load YouTube page (${response.status})`);

  const player = extractPlayerResponse(html);
  const tracks = player?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  const preferred = tracks.find((track: any) => String(track.languageCode || "").startsWith("en")) ?? tracks[0];
  if (!preferred?.baseUrl) {
    throw new Error("No public transcript/captions found for this YouTube video. Paste strategy notes with the link.");
  }

  const transcriptUrl = `${decodeHtml(String(preferred.baseUrl))}&fmt=json3`;
  const transcriptResponse = await fetch(transcriptUrl, {
    headers: { "User-Agent": "Mozilla/5.0 OGFX Strategy Analyzer" },
  });
  const raw = await transcriptResponse.text();
  if (!transcriptResponse.ok) throw new Error(`Could not load YouTube transcript (${transcriptResponse.status})`);

  const payload = JSON.parse(raw || "{}");
  const text = (payload?.events ?? [])
    .flatMap((event: any) => event?.segs ?? [])
    .map((seg: any) => String(seg?.utf8 || ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) throw new Error("YouTube transcript was empty. Paste strategy notes with the link.");
  return {
    videoId,
    title: String(player?.videoDetails?.title || "YouTube strategy"),
    text,
  };
}
