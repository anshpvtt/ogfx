export const BACKEND_API_URL =
  process.env.NEXT_PUBLIC_API_URL || "https://ogfx-render-agent-free.onrender.com";

export async function backendJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${BACKEND_API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init.headers,
    },
    cache: "no-store",
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(payload.error || `Backend ${path} failed with ${response.status}`);
  }
  return payload as T;
}

export function chartIntervalToApi(value: string) {
  if (value === "1") return "1m";
  if (value === "5") return "5m";
  if (value === "15") return "15m";
  if (value === "60") return "1h";
  if (value === "240") return "4h";
  if (value === "D") return "1d";
  return value;
}

