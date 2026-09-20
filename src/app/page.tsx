"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Activity,
  ArrowDown,
  ArrowUp,
  BarChart3,
  ChevronRight,
  Circle,
  Clock3,
  Medal,
  RefreshCcw,
  Trophy,
  Users,
  Zap,
} from "lucide-react";

import { fetchBitcoinPrice } from "@/lib/api";
import { useMarketData } from "@/hooks/useMarketData";
import PriceHistoryChart, { type PriceHistoryPoint } from "@/components/PriceHistoryChart";

type Prediction = "UP" | "DOWN";
type RoundDirection = "UP" | "DOWN" | "FLAT";
type RoundResult = "WIN" | "LOSS" | "PUSH";

type Agent = {
  id: string;
  name: string;
  shortName: string;
  strategy: string;
  prediction: Prediction;
  confidence: number;
  points: number;
  wins: number;
  losses: number;
  accent: string;
};

const initialAgents: Agent[] = [
  {
    id: "degen",
    name: "Degen",
    shortName: "DG",
    strategy: "Momentum",
    prediction: "UP",
    confidence: 78,
    points: 1240,
    wins: 0,
    losses: 0,
    accent: "bg-amber-400 text-black",
  },
  {
    id: "whale",
    name: "Whale Watcher",
    shortName: "WW",
    strategy: "Flow analysis",
    prediction: "UP",
    confidence: 84,
    points: 1185,
    wins: 0,
    losses: 0,
    accent: "bg-slate-200 text-slate-900",
  },
  {
    id: "contrarian",
    name: "Contrarian",
    shortName: "CT",
    strategy: "Crowd reversal",
    prediction: "DOWN",
    confidence: 71,
    points: 1095,
    wins: 0,
    losses: 0,
    accent: "bg-violet-300 text-violet-950",
  },
];

type LeaderboardEntry = {
  rank: number;
  name: string;
  points: number;
  type: "agent" | "user";
};

const ROUND_DURATION = 45;
const WIN_POINTS = 100;

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  return `${String(minutes).padStart(2, "0")}:${String(
    remainingSeconds,
  ).padStart(2, "0")}`;
}

function formatPrice(price: number | null) {
  if (price === null) {
    return "--";
  }

  return `$${price.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function getDirection(
  startingPrice: number,
  endingPrice: number,
): RoundDirection {
  if (endingPrice > startingPrice) {
    return "UP";
  }

  if (endingPrice < startingPrice) {
    return "DOWN";
  }

  return "FLAT";
}

function clampConfidence(value: number) {
  return Math.min(90, Math.max(58, Math.round(value)));
}

function getAgentDecision(
  agentId: string,
  change24h: number,
  roundNumber: number,
): Pick<Agent, "prediction" | "confidence"> {
  const marketBias: Prediction = change24h >= 0 ? "UP" : "DOWN";
  const strength = Math.abs(change24h);

  if (agentId === "degen") {
    const prediction =
      roundNumber % 4 === 0
        ? marketBias === "UP"
          ? "DOWN"
          : "UP"
        : marketBias;

    return {
      prediction,
      confidence: clampConfidence(64 + strength * 3),
    };
  }

  if (agentId === "whale") {
    const prediction = marketBias;

    return {
      prediction,
      confidence: clampConfidence(68 + strength * 2.5),
    };
  }

  const prediction = marketBias === "UP" ? "DOWN" : "UP";

  return {
    prediction,
    confidence: clampConfidence(62 + strength * 2),
  };
}

export default function Home() {
  const { market, loading, error } = useMarketData();

  const [priceHistory, setPriceHistory] = useState<PriceHistoryPoint[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadPriceHistory() {
      try {
        setHistoryLoading(true);
        setHistoryError(null);

        const response = await fetch("/api/market/history", {
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error("Unable to load price history.");
        }

        const result = await response.json();

        if (!Array.isArray(result.prices)) {
          throw new Error("Invalid price history response.");
        }

        if (!cancelled) {
          setPriceHistory(result.prices);
        }
      } catch (historyFetchError) {
        if (!cancelled) {
          setHistoryError(
            historyFetchError instanceof Error
              ? historyFetchError.message
              : "Unable to load price history."
          );
        }
      } finally {
        if (!cancelled) {
          setHistoryLoading(false);
        }
      }
    }

    loadPriceHistory();

    const interval = window.setInterval(loadPriceHistory, 60_000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);


  const [roundNumber, setRoundNumber] = useState(42);
  const [roundEndAt, setRoundEndAt] = useState<number | null>(null);
  const [timeLeft, setTimeLeft] = useState(ROUND_DURATION);

  const [prediction, setPrediction] = useState<Prediction | null>(null);
  const [startingPrice, setStartingPrice] = useState<number | null>(null);
  const [endingPrice, setEndingPrice] = useState<number | null>(null);

  const [roundClosed, setRoundClosed] = useState(false);
  const [roundResult, setRoundResult] = useState<RoundResult | null>(null);
  const [actualDirection, setActualDirection] =
    useState<RoundDirection | null>(null);

  const [isResolving, setIsResolving] = useState(false);
  const [resolutionError, setResolutionError] = useState<string | null>(null);
  const [resolutionAttempt, setResolutionAttempt] = useState(0);

  const [userPoints, setUserPoints] = useState(1000);
  const [agents, setAgents] = useState(initialAgents);

  /*
   * Capture the market snapshot when a new round begins.
   *
   * We only establish the starting price once. Market refreshes during
   * the round do not change the round's starting reference.
   */
  useEffect(() => {
    if (startingPrice === null && market?.price) {
      setStartingPrice(market.price);
    }
  }, [market, startingPrice]);

  /*
   * Countdown is derived from an absolute timestamp to avoid timing drift.
   */
  useEffect(() => {
    if (roundEndAt === null || roundClosed) {
      return;
    }

    const updateCountdown = () => {
      const remainingMs = Math.max(roundEndAt - Date.now(), 0);
      const remainingSeconds = Math.ceil(remainingMs / 1000);

      setTimeLeft(remainingSeconds);

      if (remainingMs <= 0) {
        setRoundClosed(true);
      }
    };

    updateCountdown();

    const timer = window.setInterval(updateCountdown, 250);

    return () => window.clearInterval(timer);
  }, [roundEndAt, roundClosed]);

  useEffect(() => {
    if (market?.price === undefined || roundEndAt !== null) {
      return;
    }

    setStartingPrice(market.price);

    setAgents((currentAgents) =>
      currentAgents.map((agent) => ({
        ...agent,
        ...getAgentDecision(
          agent.id,
          market.change24h,
          roundNumber,
        ),
      })),
    );

    setRoundEndAt(Date.now() + ROUND_DURATION * 1000);
    setTimeLeft(ROUND_DURATION);
  }, [market, roundEndAt, roundNumber]);

  /*
   * Resolve the round exactly once after the timer reaches zero.
   *
   * The latest market snapshot available at resolution becomes the
   * ending price for this V1 client-side round engine.
   */
  useEffect(() => {
    if (!roundClosed || roundResult || startingPrice === null) {
      return;
    }

    let cancelled = false;

    const resolveRound = async () => {
      setIsResolving(true);
      setResolutionError(null);

      try {
        const freshMarket = await fetchBitcoinPrice(true);

        if (cancelled) {
          return;
        }

        const finalPrice = freshMarket.price;
        const direction = getDirection(startingPrice, finalPrice);

        setEndingPrice(finalPrice);
        setActualDirection(direction);

        setAgents((currentAgents) =>
          currentAgents.map((agent) => {
            const isCorrect =
              direction !== "FLAT" && agent.prediction === direction;

            const isIncorrect =
              direction !== "FLAT" && agent.prediction !== direction;

            return {
              ...agent,
              points: isCorrect
                ? agent.points + WIN_POINTS
                : agent.points,
              wins: isCorrect ? agent.wins + 1 : agent.wins,
              losses: isIncorrect ? agent.losses + 1 : agent.losses,
            };
          }),
        );

        if (direction === "FLAT" || prediction === null) {
          setRoundResult("PUSH");
          return;
        }

        if (prediction === direction) {
          setRoundResult("WIN");
          setUserPoints((current) => current + WIN_POINTS);
        } else {
          setRoundResult("LOSS");
        }
      } catch (error) {
        console.error("Round resolution failed:", error);

        if (!cancelled) {
          setResolutionError(
            "We couldn't fetch the latest market price. Please try again.",
          );
        }
      } finally {
        if (!cancelled) {
          setIsResolving(false);
        }
      }
    };

    resolveRound();

    return () => {
      cancelled = true;
    };
  }, [
    roundClosed,
    roundResult,
    startingPrice,
    prediction,
    resolutionAttempt,
  ]);

  const resetRound = () => {
    setRoundNumber((current) => current + 1);
    setRoundEndAt(null);
    setTimeLeft(ROUND_DURATION);

    setPrediction(null);
    setStartingPrice(null);
    setEndingPrice(null);

    setRoundClosed(false);
    setRoundResult(null);
    setActualDirection(null);

    setIsResolving(false);
    setResolutionError(null);
    setResolutionAttempt(0);
  };

  const isUrgent = timeLeft <= 10 && !roundClosed;

  const countdownClass = roundClosed
    ? "border-white/10 bg-white/[0.04] text-white/50"
    : isUrgent
      ? "border-rose-400/25 bg-rose-400/[0.07] text-rose-300"
      : "border-amber-400/20 bg-amber-400/[0.06] text-amber-200";

  const leaderboardSorted = useMemo<LeaderboardEntry[]>(() => {
    return [
      ...agents.map((agent) => ({
        name: agent.name,
        points: agent.points,
        type: "agent" as const,
      })),
      {
        name: "You",
        points: userPoints,
        type: "user" as const,
      },
    ]
      .sort((a, b) => b.points - a.points)
      .map((entry, index) => ({
        ...entry,
        rank: index + 1,
      }));
  }, [agents, userPoints]);

  const resultLabel =
  prediction === null
    ? "You didn't make a prediction this round"
    : roundResult === "WIN"
      ? "You won this round"
      : roundResult === "LOSS"
        ? "You lost this round"
        : "Round ended flat";

  return (
    <main className="min-h-screen bg-[#0b0b0a] text-[#f5f5f2]">
      <div className="mx-auto max-w-[1380px] px-4 py-5 sm:px-6 lg:px-8">
        {/* Header */}
        <header className="flex items-center justify-between border-b border-white/[0.08] pb-5">
          <div className="flex items-center gap-3">
            <div
              aria-hidden="true"
              className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-400"
            >
              <Zap className="h-4 w-4 text-black" />
            </div>

            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-[15px] font-semibold tracking-tight">
                  AI Agent Arena
                </h1>

                <span className="hidden rounded-full border border-white/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-white/50 sm:inline-flex">
                  V1
                </span>
              </div>

              <p className="mt-0.5 text-[11px] text-white/45">
                Market prediction competition
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 sm:gap-4">
            <div className="hidden items-center gap-2 text-xs text-white/45 sm:flex">
              <Users className="h-3.5 w-3.5" aria-hidden="true" />
              <span>1,284 in arena</span>
            </div>

            <div
              className="flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/[0.06] px-3 py-1.5"
              aria-label="Arena status: live"
            >
              <Circle
                className="h-1.5 w-1.5 animate-pulse fill-emerald-400 text-emerald-400"
                aria-hidden="true"
              />

              <span className="text-[11px] font-medium text-emerald-300">
                Live
              </span>
            </div>
          </div>
        </header>

        {/* Arena */}
        <section
          aria-labelledby="arena-heading"
          className="mt-7 overflow-hidden rounded-2xl border border-white/[0.09] bg-[#111110]"
        >
          {/* Arena header */}
          <div className="border-b border-white/[0.07] px-5 py-5 sm:px-7">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.16em] text-amber-300">
                  <Activity className="h-3.5 w-3.5" aria-hidden="true" />
                  Live market
                </div>

                <div className="flex items-end gap-3 sm:gap-4">
                  <h2
                    id="arena-heading"
                    className="text-2xl font-semibold tracking-tight sm:text-3xl"
                  >
                    BTC / USD
                  </h2>

                  <span className="mb-1 rounded border border-white/10 px-2 py-1 text-[10px] font-medium text-white/50">
                    Bitcoin
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-3 divide-x divide-white/10 rounded-lg border border-white/[0.06] bg-white/[0.015] lg:border-0 lg:bg-transparent">
                <div className="px-3 py-2 text-center sm:px-5 lg:px-0 lg:pr-6 lg:text-left">
                  <p className="text-[10px] uppercase tracking-wider text-white/45">
                    Round
                  </p>
                  <p className="mt-1 text-sm font-semibold">
                    #{String(roundNumber).padStart(3, "0")}
                  </p>
                </div>

                <div className="px-3 py-2 text-center sm:px-5 lg:px-6 lg:text-left">
                  <p className="text-[10px] uppercase tracking-wider text-white/45">
                    Entries
                  </p>
                  <p className="mt-1 text-sm font-semibold">1,284</p>
                </div>

                <div className="px-3 py-2 text-center sm:px-5 lg:px-0 lg:pl-6 lg:text-left">
                  <p className="text-[10px] uppercase tracking-wider text-white/45">
                    Status
                  </p>

                  <div className="mt-1 flex items-center justify-center gap-1.5 lg:justify-start">
                    <Circle
                      className={`h-1.5 w-1.5 ${
                        roundClosed
                          ? "fill-white/30 text-white/30"
                          : "fill-emerald-400 text-emerald-400"
                      }`}
                      aria-hidden="true"
                    />

                    <span
                      className={`text-sm font-medium ${
                        roundClosed
                          ? "text-white/50"
                          : "text-emerald-300"
                      }`}
                    >
                      {roundClosed ? "Closed" : "Open"}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Market / Prediction */}
          <div className="grid lg:grid-cols-[minmax(0,1fr)_330px]">
            {/* Market */}
            <div className="min-w-0 border-b border-white/[0.07] p-5 sm:p-7 lg:border-b-0 lg:border-r">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-white/45">
                    Current price
                  </p>

                  <div className="mt-2 flex flex-wrap items-end gap-3">
                    <span className="text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">
                      {loading
                        ? "Loading..."
                        : market
                          ? formatPrice(market.price)
                          : "--"}
                    </span>

                    {market && (
                      <div className="mb-1 flex items-center gap-2">
                        <span
                          className={`flex items-center gap-1 text-sm font-medium ${
                            market.change24h >= 0
                              ? "text-emerald-400"
                              : "text-rose-400"
                          }`}
                        >
                          {market.change24h >= 0 ? (
                            <ArrowUp
                              className="h-3.5 w-3.5"
                              aria-hidden="true"
                            />
                          ) : (
                            <ArrowDown
                              className="h-3.5 w-3.5"
                              aria-hidden="true"
                            />
                          )}

                          <span>
                            {market.change24h >= 0 ? "+" : "-"}
                            {Math.abs(market.change24h).toFixed(2)}%
                          </span>
                        </span>

                        <span className="ml-1 text-[10px] text-white/45">
                          24h
                        </span>
                      </div>
                    )}
                  </div>

                  {error && (
                    <p className="mt-2 text-xs text-rose-300" role="alert">
                      {error}
                    </p>
                  )}

                  {!loading && !error && !market && (
                    <p className="mt-2 text-xs text-white/50">
                      Market data is temporarily unavailable.
                    </p>
                  )}

                  {startingPrice !== null && !roundClosed && (
                    <p className="mt-2 text-[10px] text-white/40">
                      Round start: {formatPrice(startingPrice)}
                    </p>
                  )}
                </div>

                <div className="hidden items-center gap-2 text-xs text-white/40 sm:flex">
                  <BarChart3 className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Live feed</span>
                </div>
              </div>

              {/* Live history */}
              <div className="mt-7">
                <div className="relative h-[240px] overflow-hidden rounded-xl border border-white/[0.06] bg-[#0d0d0c] sm:h-[270px]">
                  <PriceHistoryChart
                    data={priceHistory}
                    loading={historyLoading}
                    error={historyError}
                  />

                  <div className="absolute right-4 top-4 rounded border border-white/10 bg-[#111110]/90 px-2 py-1 text-[10px] text-white/50">
                    Live history
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-between gap-3">
                  <p className="text-[10px] text-white/40">
                    Live Bitcoin price history · Refreshes every 60 seconds.
                  </p>

                  <span className="shrink-0 text-[10px] font-medium text-amber-300/70">
                    BTC
                  </span>
                </div>
              </div>
            </div>

            {/* Prediction */}
            <aside
              aria-labelledby="prediction-heading"
              className="bg-[#151513] p-5 sm:p-7"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.16em] text-white/45">
                    Make your call
                  </p>

                  <h3
                    id="prediction-heading"
                    className="mt-1 text-lg font-semibold"
                  >
                    Where next?
                  </h3>
                </div>

                <div
                  className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 transition-colors ${countdownClass}`}
                  aria-label={
                    roundClosed
                      ? "Round closed"
                      : `Round time remaining: ${formatTime(timeLeft)}`
                  }
                >
                  <Clock3
                    className="h-3.5 w-3.5"
                    aria-hidden="true"
                  />

                  <span className="font-mono text-sm font-semibold">
                    {formatTime(timeLeft)}
                  </span>
                </div>
              </div>

              <p className="mt-3 text-xs leading-5 text-white/50">
                {roundClosed
                  ? roundResult
                    ? `${resultLabel}.`
                    : "This round has closed. Waiting for the final market snapshot."
                  : "Choose the direction you think Bitcoin will move before the round closes."}
              </p>

              {!roundClosed ? (
                <div className="mt-7 space-y-3">
                  <button
                    type="button"
                    aria-label="Predict price will go up"
                    aria-pressed={prediction === "UP"}
                    onClick={() => setPrediction("UP")}
                    className={`group flex w-full items-center justify-between rounded-xl border px-4 py-4 text-left transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#151513] ${
                      prediction === "UP"
                        ? "border-emerald-400/60 bg-emerald-400/[0.14]"
                        : "border-emerald-400/25 bg-emerald-400/[0.06] hover:border-emerald-400/50 hover:bg-emerald-400/[0.1]"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-400 text-black transition-transform ${
                          prediction === "UP"
                            ? "scale-105"
                            : "group-hover:scale-105"
                        }`}
                      >
                        <ArrowUp
                          className="h-4 w-4"
                          aria-hidden="true"
                        />
                      </div>

                      <div>
                        <p className="text-sm font-semibold text-emerald-200">
                          Price goes up
                        </p>

                        <p className="mt-0.5 text-[10px] text-white/45">
                          Bullish prediction
                        </p>
                      </div>
                    </div>

                    <ChevronRight
                      className={`h-4 w-4 transition-all ${
                        prediction === "UP"
                          ? "translate-x-0.5 text-emerald-300"
                          : "text-white/25 group-hover:translate-x-0.5"
                      }`}
                      aria-hidden="true"
                    />
                  </button>

                  <button
                    type="button"
                    aria-label="Predict price will go down"
                    aria-pressed={prediction === "DOWN"}
                    onClick={() => setPrediction("DOWN")}
                    className={`group flex w-full items-center justify-between rounded-xl border px-4 py-4 text-left transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#151513] ${
                      prediction === "DOWN"
                        ? "border-rose-400/60 bg-rose-400/[0.13]"
                        : "border-rose-400/25 bg-rose-400/[0.05] hover:border-rose-400/50 hover:bg-rose-400/[0.09]"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`flex h-9 w-9 items-center justify-center rounded-lg bg-rose-400 text-black transition-transform ${
                          prediction === "DOWN"
                            ? "scale-105"
                            : "group-hover:scale-105"
                        }`}
                      >
                        <ArrowDown
                          className="h-4 w-4"
                          aria-hidden="true"
                        />
                      </div>

                      <div>
                        <p className="text-sm font-semibold text-rose-200">
                          Price goes down
                        </p>

                        <p className="mt-0.5 text-[10px] text-white/45">
                          Bearish prediction
                        </p>
                      </div>
                    </div>

                    <ChevronRight
                      className={`h-4 w-4 transition-all ${
                        prediction === "DOWN"
                          ? "translate-x-0.5 text-rose-300"
                          : "text-white/25 group-hover:translate-x-0.5"
                      }`}
                      aria-hidden="true"
                    />
                  </button>
                </div>
              ) : roundResult ? (
                <div className="mt-7">
                  <div
                    className={`rounded-xl border p-5 ${
                      roundResult === "WIN"
                        ? "border-emerald-400/20 bg-emerald-400/[0.06]"
                        : roundResult === "LOSS"
                          ? "border-rose-400/20 bg-rose-400/[0.06]"
                          : "border-amber-400/20 bg-amber-400/[0.05]"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] uppercase tracking-[0.16em] text-white/45">
                        Round result
                      </span>

                      <span
                        className={`text-xs font-semibold ${
                          roundResult === "WIN"
                            ? "text-emerald-300"
                            : roundResult === "LOSS"
                              ? "text-rose-300"
                              : "text-amber-300"
                        }`}
                      >
                        {roundResult}
                      </span>
                    </div>

                    <h4 className="mt-3 text-lg font-semibold">
                      {resultLabel}
                    </h4>

                    <div className="mt-4 space-y-2 border-t border-white/[0.07] pt-4 text-xs">
                      <div className="flex justify-between">
                        <span className="text-white/45">Your prediction</span>
                        <span className="font-semibold">
                          {prediction ?? "None"}
                        </span>
                      </div>

                      <div className="flex justify-between">
                        <span className="text-white/45">Market direction</span>
                        <span className="font-semibold">
                          {actualDirection}
                        </span>
                      </div>

                      <div className="flex justify-between">
                        <span className="text-white/45">Start price</span>
                        <span className="font-mono">
                          {formatPrice(startingPrice)}
                        </span>
                      </div>

                      <div className="flex justify-between">
                        <span className="text-white/45">End price</span>
                        <span className="font-mono">
                          {formatPrice(endingPrice)}
                        </span>
                      </div>

                      {roundResult === "WIN" && (
                        <div className="flex justify-between pt-2 text-emerald-300">
                          <span>Points earned</span>
                          <span className="font-semibold">
                            +{WIN_POINTS}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={resetRound}
                    className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-amber-400 px-4 py-2.5 text-xs font-semibold text-black transition hover:bg-amber-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#151513]"
                  >
                    <RefreshCcw
                      className="h-3.5 w-3.5"
                      aria-hidden="true"
                    />
                    Start Next Round
                  </button>
                </div>
              ) : (
                <div className="mt-7 rounded-xl border border-white/[0.08] bg-white/[0.025] p-5 text-center">
                  <div
                    className={`mx-auto flex h-10 w-10 items-center justify-center rounded-full border border-amber-400/20 bg-amber-400/[0.06] ${
                      isResolving ? "animate-pulse" : ""
                    }`}
                    aria-live="polite"
                  >
                    <Clock3
                      className={`h-4 w-4 text-amber-300 ${
                        isResolving ? "animate-spin" : ""
                      }`}
                      aria-hidden="true"
                    />
                  </div>

                  <h4
                    className="mt-4 text-sm font-semibold"
                    aria-live="polite"
                  >
                    {resolutionError
                      ? "Unable to resolve round"
                      : isResolving
                        ? "Resolving round..."
                        : "Preparing resolution..."}
                  </h4>

                  <p className="mx-auto mt-2 max-w-[260px] text-xs leading-5 text-white/45">
                    {resolutionError
                      ? resolutionError
                      : "Waiting for the latest market snapshot to calculate the result."}
                  </p>

                  {resolutionError && (
                    <button
                      type="button"
                      onClick={() => {
                        setResolutionError(null);
                        setResolutionAttempt((current) => current + 1);
                      }}
                      className="mt-4 inline-flex items-center justify-center gap-2 rounded-lg border border-amber-400/30 bg-amber-400/[0.08] px-4 py-2.5 text-xs font-semibold text-amber-200 transition hover:border-amber-300/50 hover:bg-amber-400/[0.14] focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#151513]"
                    >
                      <RefreshCcw
                        className="h-3.5 w-3.5"
                        aria-hidden="true"
                      />
                      Retry Resolution
                    </button>
                  )}
                </div>
              )}

              <div className="mt-5 min-h-5 text-center">
                {prediction && !roundClosed && (
                  <motion.p
                    initial={{ opacity: 0, y: 3 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-[10px] font-medium text-white/55"
                  >
                    Prediction selected:{" "}
                    <span
                      className={
                        prediction === "UP"
                          ? "text-emerald-300"
                          : "text-rose-300"
                      }
                    >
                      {prediction}
                    </span>
                  </motion.p>
                )}
              </div>

              <div className="mt-5 border-t border-white/[0.07] pt-5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase tracking-wider text-white/40">
                    Your points
                  </span>

                  <span className="font-mono text-sm font-semibold">
                    {userPoints.toLocaleString()}
                  </span>
                </div>
              </div>
            </aside>
          </div>
        </section>

        {/* Agents */}
        <section
          aria-labelledby="agents-heading"
          className="mt-8"
        >
          <div className="mb-4 flex items-end justify-between">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-amber-300/70">
                The competition
              </p>

              <h3
                id="agents-heading"
                className="mt-1.5 text-xl font-semibold tracking-tight"
              >
                Agent predictions
              </h3>
            </div>

            <span className="hidden text-[11px] text-white/40 sm:block">
              Updated this round
            </span>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            {agents.map((agent, index) => (
              <motion.article
                key={agent.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  delay: index * 0.08,
                  duration: 0.35,
                }}
                className="group rounded-xl border border-white/[0.08] bg-[#111110] p-4 transition-colors hover:border-white/[0.14]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div
                      aria-hidden="true"
                      className={`flex h-9 w-9 items-center justify-center rounded-full text-[10px] font-bold ${agent.accent}`}
                    >
                      {agent.shortName}
                    </div>

                    <div>
                      <h4 className="text-sm font-semibold">
                        {agent.name}
                      </h4>

                      <p className="mt-0.5 text-[10px] text-white/40">
                        {agent.strategy}
                      </p>
                    </div>
                  </div>

                  <span
                    className={`rounded-md px-2 py-1 text-[10px] font-semibold ${
                      agent.prediction === "UP"
                        ? "bg-emerald-400/10 text-emerald-300"
                        : "bg-rose-400/10 text-rose-300"
                    }`}
                  >
                    {agent.prediction}
                  </span>
                </div>

                <div className="mt-5 flex items-end justify-between">
                  <div>
                    <p className="text-[10px] text-white/40">
                      Confidence
                    </p>

                    <p className="mt-1 text-lg font-semibold">
                      {agent.confidence}%
                    </p>
                  </div>

                  <div className="text-right">
                    <p className="text-[10px] text-white/40">
                      Points
                    </p>

                    <p className="mt-1 font-mono text-sm font-semibold">
                      {agent.points.toLocaleString()}
                    </p>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-3 gap-2 border-t border-white/[0.07] pt-3 text-[10px]">
                  <div>
                    <p className="text-white/40">Wins</p>
                    <p className="mt-1 font-semibold text-emerald-300">
                      {agent.wins}
                    </p>
                  </div>

                  <div>
                    <p className="text-white/40">Losses</p>
                    <p className="mt-1 font-semibold text-rose-300">
                      {agent.losses}
                    </p>
                  </div>

                  <div>
                    <p className="text-white/40">Win rate</p>
                    <p className="mt-1 font-semibold text-white/80">
                      {agent.wins + agent.losses > 0
                        ? `${Math.round(
                            (agent.wins / (agent.wins + agent.losses)) * 100,
                          )}%`
                        : "--"}
                    </p>
                  </div>
                </div>

                <div
                  className="mt-4 h-1 overflow-hidden rounded-full bg-white/[0.06]"
                  aria-label={`${agent.name} confidence: ${agent.confidence}%`}
                >
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${agent.confidence}%` }}
                    transition={{
                      delay: 0.25 + index * 0.08,
                      duration: 0.5,
                    }}
                    className="h-full rounded-full bg-amber-400"
                  />
                </div>
              </motion.article>
            ))}
          </div>
        </section>

        {/* Leaderboard */}
        <section
          aria-labelledby="leaderboard-heading"
          className="mt-8"
        >
          <div className="mb-4 flex items-end justify-between">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-amber-300/70">
                Rankings
              </p>

              <h3
                id="leaderboard-heading"
                className="mt-1.5 text-xl font-semibold tracking-tight"
              >
                Arena leaderboard
              </h3>
            </div>

            <Trophy
              className="h-4 w-4 text-white/35"
              aria-hidden="true"
            />
          </div>

          <ol className="overflow-hidden rounded-xl border border-white/[0.08] bg-[#111110]">
            {leaderboardSorted.map((entry) => (
              <li
                key={entry.name}
                className={`flex items-center justify-between border-b border-white/[0.06] px-4 py-3.5 last:border-b-0 ${
                  entry.type === "user"
                    ? "bg-amber-400/[0.035]"
                    : ""
                }`}
              >
                <div className="flex min-w-0 items-center gap-4">
                  <div
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-white/[0.07] bg-white/[0.02]"
                    aria-label={`Rank ${entry.rank}`}
                  >
                    {entry.rank <= 3 ? (
                      <Medal
                        className={`h-4 w-4 ${
                          entry.rank === 1
                            ? "text-amber-300"
                            : "text-white/35"
                        }`}
                        aria-hidden="true"
                      />
                    ) : (
                      <span className="font-mono text-[10px] font-medium text-white/40">
                        {String(entry.rank).padStart(2, "0")}
                      </span>
                    )}
                  </div>

                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {entry.name}
                    </p>

                    <p className="mt-0.5 text-[10px] text-white/40">
                      {entry.type === "user"
                        ? "Your current position"
                        : "AI agent"}
                    </p>
                  </div>
                </div>

                <span className="ml-4 shrink-0 font-mono text-sm font-semibold">
                  {entry.points.toLocaleString()}
                </span>
              </li>
            ))}
          </ol>
        </section>

        {/* Footer */}
        <footer className="flex flex-col gap-2 py-8 text-[10px] text-white/40 sm:flex-row sm:items-center sm:justify-between">
          <span>AI Agent Arena V1</span>
          <span>Virtual points only · No real-money wagering</span>
        </footer>
      </div>
    </main>
  );
}
