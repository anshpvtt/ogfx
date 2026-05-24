const backendUrl = process.env.BACKEND_URL || process.env.API_URL || "https://ogfx-render-agent-free.onrender.com";
const cronSecret = process.env.CRON_SECRET || process.env.AGENT_SECRET || "";

async function main() {
  const response = await fetch(`${backendUrl.replace(/\/$/, "")}/api/cron/scan-market`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cronSecret ? { "x-cron-secret": cronSecret } : {}),
    },
  });

  const body = await response.text();
  console.log(body);

  if (!response.ok) {
    throw new Error(`Market scan failed with ${response.status}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

