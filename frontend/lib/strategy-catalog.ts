import { readFile } from "node:fs/promises";
import path from "node:path";

export type StrategyCatalogItem = {
  id: string;
  name: string;
  description: string;
  source: "workspace" | "backend";
  timeframes: string[];
  instruments: string[];
  riskReward: number;
  raw: unknown;
};

function workspaceRoot() {
  return path.basename(process.cwd()) === "frontend" ? path.resolve(process.cwd(), "..") : process.cwd();
}

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

async function readJson(relativePath: string) {
  const raw = await readFile(path.join(workspaceRoot(), relativePath), "utf8");
  return JSON.parse(raw);
}

function normalizeStrategy(raw: any, source: StrategyCatalogItem["source"], fallbackId: string): StrategyCatalogItem {
  const name = String(raw?.name ?? fallbackId);
  const id = String(raw?.id ?? slug(name) ?? fallbackId);
  const riskReward = Number(
    raw?.risk_reward ??
      raw?.riskManagement?.minRiskReward ??
      raw?.riskManagement?.tpMultiplier ??
      raw?.performance?.targetRR ??
      2
  );

  return {
    id,
    name,
    description: String(raw?.description ?? "OGFX strategy dataset"),
    source,
    timeframes: Array.isArray(raw?.timeframes)
      ? raw.timeframes.map(String)
      : raw?.timeframe
        ? [String(raw.timeframe)]
        : ["1H", "4H", "1D"],
    instruments: Array.isArray(raw?.instruments) ? raw.instruments.map(String) : [],
    riskReward: Number.isFinite(riskReward) ? riskReward : 2,
    raw,
  };
}

export async function loadStrategyCatalog(): Promise<StrategyCatalogItem[]> {
  const [defaultStrategy, smcStrategy, backendStrategies] = await Promise.all([
    readJson("strategies/default.json"),
    readJson("strategies/smc.json"),
    readJson("backend/data/strategies.json"),
  ]);

  return [
    normalizeStrategy(defaultStrategy, "workspace", "ogfx_default_strategy"),
    normalizeStrategy(smcStrategy, "workspace", "ogfx_smc_strategy"),
    ...(Array.isArray(backendStrategies)
      ? backendStrategies.map((strategy, index) => normalizeStrategy(strategy, "backend", `backend_strategy_${index + 1}`))
      : []),
  ];
}
