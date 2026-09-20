"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { BarChart3, RefreshCcw } from "lucide-react";

export type PriceHistoryPoint = {
  timestamp: number;
  price: number;
};

type PriceHistoryChartProps = {
  data: PriceHistoryPoint[];
  loading: boolean;
  error: string | null;
};

function formatChartTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatChartPrice(price: number) {
  return `$${price.toLocaleString("en-US", {
    maximumFractionDigits: 0,
  })}`;
}

export default function PriceHistoryChart({
  data,
  loading,
  error,
}: PriceHistoryChartProps) {
  if (loading) {
    return (
      <div className="flex h-full min-h-[240px] items-center justify-center">
        <div className="flex items-center gap-2 text-xs text-white/45">
          <RefreshCcw className="h-3.5 w-3.5 animate-spin" />
          Loading price history...
        </div>
      </div>
    );
  }

  if (error || data.length < 2) {
    return (
      <div className="flex h-full min-h-[240px] items-center justify-center px-6 text-center">
        <div>
          <BarChart3 className="mx-auto h-6 w-6 text-white/25" />
          <p className="mt-3 text-xs text-white/45">
            {error ?? "Price history is temporarily unavailable."}
          </p>
        </div>
      </div>
    );
  }

  const firstPrice = data[0].price;
  const lastPrice = data[data.length - 1].price;
  const trendIsPositive = lastPrice >= firstPrice;
  const chartColor = trendIsPositive ? "#34d399" : "#fb7185";

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart
        data={data}
        margin={{
          top: 12,
          right: 12,
          left: 0,
          bottom: 24,
        }}
      >
        <defs>
          <linearGradient
            id="priceHistoryFill"
            x1="0"
            y1="0"
            x2="0"
            y2="1"
          >
            <stop offset="0%" stopColor={chartColor} stopOpacity={0.22} />
            <stop offset="100%" stopColor={chartColor} stopOpacity={0} />
          </linearGradient>
        </defs>

        <CartesianGrid
          stroke="rgba(255,255,255,0.055)"
          vertical={false}
        />

        <XAxis
          dataKey="timestamp"
          tickFormatter={formatChartTime}
          tick={{
            fill: "rgba(255,255,255,0.35)",
            fontSize: 10,
          }}
          axisLine={false}
          tickLine={false}
          minTickGap={32}
        />

        <YAxis
          domain={["auto", "auto"]}
          tickFormatter={formatChartPrice}
          tick={{
            fill: "rgba(255,255,255,0.35)",
            fontSize: 10,
          }}
          axisLine={false}
          tickLine={false}
          width={64}
          tickCount={5}
        />

        <Tooltip
          cursor={{
            stroke: "rgba(255,255,255,0.2)",
            strokeDasharray: "4 4",
          }}
          contentStyle={{
            background: "#191917",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: "8px",
            color: "#f5f5f2",
            fontSize: "12px",
          }}
          labelFormatter={(value) => formatChartTime(Number(value))}
          formatter={(value) => [
            formatChartPrice(Number(value)),
            "BTC price",
          ]}
        />

        <Area
          type="monotone"
          dataKey="price"
          stroke={chartColor}
          strokeWidth={2}
          fill="url(#priceHistoryFill)"
          dot={false}
          activeDot={{
            r: 4,
            strokeWidth: 2,
            stroke: "#0d0d0c",
            fill: chartColor,
          }}
          isAnimationActive
          animationDuration={700}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
