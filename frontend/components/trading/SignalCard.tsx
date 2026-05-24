"use client";

import { motion } from "framer-motion";
import { ArrowUp, ArrowDown, Target, Shield, Clock, TrendingUp, Zap, Diamond, BarChart3, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { Signal } from "@/hooks/useSignals";

interface SignalCardProps {
  signal: Signal & { smcData?: any; riskReward?: number; engine?: string };
  index?: number;
}

export function SignalCard({ signal, index = 0 }: SignalCardProps) {
  const isBuy = signal.type === "BUY";
  const isActive = signal.status === "ACTIVE";
  const isSMC = signal.smcData !== undefined;
  
  // Quality indicators
  const isHighQuality = signal.confidence >= 85;
  const isMediumQuality = signal.confidence >= 70 && signal.confidence < 85;
  
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.1 }}
    >
      <Card
        className={cn(
          "relative overflow-hidden transition-all duration-300",
          "bg-gradient-to-br from-ogfx-card to-ogfx-dark",
          "border-ogfx-border hover:border-ogfx-accent/50",
          !isActive && "opacity-60"
        )}
      >
        {/* Glow effect */}
        <div
          className={cn(
            "absolute inset-0 opacity-10 transition-opacity",
            isBuy ? "bg-emerald-500/20" : "bg-red-500/20"
          )}
        />

        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Badge
                variant={isBuy ? "success" : "danger"}
                className={cn(
                  "px-2 py-1 text-xs font-bold uppercase tracking-wider",
                  isBuy ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"
                )}
              >
                {isBuy ? (
                  <ArrowUp className="w-3 h-3 mr-1" />
                ) : (
                  <ArrowDown className="w-3 h-3 mr-1" />
                )}
                {signal.type}
              </Badge>
              <span className="text-lg font-bold text-white">{signal.pair}</span>
              {isSMC && (
                <Badge variant="outline" className="text-xs border-amber-500/30 text-amber-400">
                  <Zap className="w-3 h-3 mr-1" />
                  SMC
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              {isHighQuality && (
                <Diamond className="w-4 h-4 text-cyan-400" />
              )}
              <Badge variant="outline" className="text-xs">
                <Clock className="w-3 h-3 mr-1" />
                {new Date(signal.timestamp).toLocaleTimeString()}
              </Badge>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Price levels */}
          <div className="grid grid-cols-3 gap-2">
            <div className="p-2 rounded-lg bg-white/5">
              <p className="text-xs text-gray-400 mb-1">Entry</p>
              <p className="text-sm font-mono font-semibold text-white">
                {signal.entry.toFixed(signal.pair.includes("JPY") ? 3 : 5)}
              </p>
            </div>
            <div className="p-2 rounded-lg bg-red-500/10">
              <p className="text-xs text-red-400 mb-1 flex items-center gap-1">
                <Shield className="w-3 h-3" /> SL
              </p>
              <p className="text-sm font-mono font-semibold text-red-400">
                {signal.stopLoss.toFixed(signal.pair.includes("JPY") ? 3 : 5)}
              </p>
            </div>
            <div className="p-2 rounded-lg bg-emerald-500/10">
              <p className="text-xs text-emerald-400 mb-1 flex items-center gap-1">
                <Target className="w-3 h-3" /> TP
              </p>
              <p className="text-sm font-mono font-semibold text-emerald-400">
                {signal.takeProfit.toFixed(signal.pair.includes("JPY") ? 3 : 5)}
              </p>
            </div>
          </div>

          {/* Confidence & R:R */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-ogfx-accent" />
              <span className="text-sm text-gray-300">Confidence:</span>
              <div className="flex-1 h-2 bg-gray-700 rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${signal.confidence}%` }}
                  transition={{ duration: 0.5, delay: 0.2 }}
                  className={cn(
                    "h-full rounded-full",
                    signal.confidence >= 85
                      ? "bg-cyan-500"
                      : signal.confidence >= 70
                      ? "bg-emerald-500"
                      : signal.confidence >= 60
                      ? "bg-amber-500"
                      : "bg-red-500"
                  )}
                />
              </div>
              <span className="text-sm font-bold text-white">{signal.confidence}%</span>
            </div>
            
            {/* Risk:Reward */}
            {signal.riskReward && (
              <div className="flex items-center gap-2 text-xs">
                <BarChart3 className="w-3 h-3 text-gray-400" />
                <span className="text-gray-400">R:R</span>
                <span className={cn(
                  "font-medium",
                  signal.riskReward >= 2 ? "text-emerald-400" : 
                  signal.riskReward >= 1.5 ? "text-amber-400" : "text-gray-400"
                )}>
                  {signal.riskReward.toFixed(1)}:1
                </span>
              </div>
            )}
            
            <p className="text-xs text-gray-400 line-clamp-2">{signal.reason}</p>
          </div>
          
          {/* SMC Data Display */}
          {isSMC && signal.smcData && (
            <div className="pt-3 border-t border-white/10">
              <div className="grid grid-cols-2 gap-2 text-xs">
                {signal.smcData.htfBias && (
                  <div className="flex items-center gap-1">
                    <span className="text-gray-500">HTF:</span>
                    <span className={cn(
                      "font-medium",
                      signal.smcData.htfBias === "bullish" ? "text-emerald-400" : 
                      signal.smcData.htfBias === "bearish" ? "text-red-400" : "text-gray-400"
                    )}>
                      {signal.smcData.htfBias.toUpperCase()}
                    </span>
                  </div>
                )}
                
                {signal.smcData.structure && (
                  <div className="flex items-center gap-1">
                    <span className="text-gray-500">Structure:</span>
                    <span className="text-gray-300 capitalize">{signal.smcData.structure}</span>
                  </div>
                )}
                
                {signal.smcData.sweep && (
                  <div className="flex items-center gap-1">
                    <span className="text-gray-500">Sweep:</span>
                    <span className="text-emerald-400">✓ Detected</span>
                  </div>
                )}
                
                {signal.smcData.zone && (
                  <div className="flex items-center gap-1">
                    <span className="text-gray-500">Zone:</span>
                    <span className="text-amber-400 capitalize">{signal.smcData.zone.type}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Status */}
          {!isActive && (
            <div className="pt-2 border-t border-white/10">
              <Badge
                variant={signal.status === "CLOSED" ? "secondary" : "outline"}
                className="text-xs"
              >
                {signal.status}
                {signal.pips !== undefined && (
                  <span
                    className={cn(
                      "ml-1",
                      signal.pips > 0 ? "text-emerald-400" : signal.pips < 0 ? "text-red-400" : ""
                    )}
                  >
                    ({signal.pips > 0 ? "+" : ""}
                    {signal.pips} pips)
                  </span>
                )}
              </Badge>
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
