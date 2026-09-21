"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowDown,
  ArrowUp,
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
import PriceHistoryChart, {
  type PriceHistoryPoint,
} from "@/components/PriceHistoryChart";

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
  gradient: string;
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
    gradient: "linear-gradient(135deg,#fbbf24,#f59e0b)",
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
    gradient: "linear-gradient(135deg,#818cf8,#6366f1)",
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
    gradient: "linear-gradient(135deg,#f472b6,#ec4899)",
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
  if (price === null) return "--";
  return `$${price.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function getDirection(
  startingPrice: number,
  endingPrice: number,
): RoundDirection {
  if (endingPrice > startingPrice) return "UP";
  if (endingPrice < startingPrice) return "DOWN";
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
    return { prediction, confidence: clampConfidence(64 + strength * 3) };
  }

  if (agentId === "whale") {
    return {
      prediction: marketBias,
      confidence: clampConfidence(68 + strength * 2.5),
    };
  }

  return {
    prediction: marketBias === "UP" ? "DOWN" : "UP",
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

        if (!cancelled) setPriceHistory(result.prices);
      } catch (historyFetchError) {
        if (!cancelled) {
          setHistoryError(
            historyFetchError instanceof Error
              ? historyFetchError.message
              : "Unable to load price history.",
          );
        }
      } finally {
        if (!cancelled) setHistoryLoading(false);
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

  useEffect(() => {
    if (startingPrice === null && market?.price) {
      setStartingPrice(market.price);
    }
  }, [market, startingPrice]);

  useEffect(() => {
    if (roundEndAt === null || roundClosed) return;

    const updateCountdown = () => {
      const remainingMs = Math.max(roundEndAt - Date.now(), 0);
      const remainingSeconds = Math.ceil(remainingMs / 1000);
      setTimeLeft(remainingSeconds);
      if (remainingMs <= 0) setRoundClosed(true);
    };

    updateCountdown();
    const timer = window.setInterval(updateCountdown, 250);
    return () => window.clearInterval(timer);
  }, [roundEndAt, roundClosed]);

  useEffect(() => {
    if (market?.price === undefined || roundEndAt !== null) return;

    setStartingPrice(market.price);

    setAgents((currentAgents) =>
      currentAgents.map((agent) => ({
        ...agent,
        ...getAgentDecision(agent.id, market.change24h, roundNumber),
      })),
    );

    setRoundEndAt(Date.now() + ROUND_DURATION * 1000);
    setTimeLeft(ROUND_DURATION);
  }, [market, roundEndAt, roundNumber]);

  useEffect(() => {
    if (!roundClosed || roundResult || startingPrice === null) return;

    let cancelled = false;

    const resolveRound = async () => {
      setIsResolving(true);
      setResolutionError(null);

      try {
        const freshMarket = await fetchBitcoinPrice(true);
        if (cancelled) return;

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
              points: isCorrect ? agent.points + WIN_POINTS : agent.points,
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
      } catch (resolveError) {
        console.error("Round resolution failed:", resolveError);
        if (!cancelled) {
          setResolutionError(
            "We couldn't fetch the latest market price. Try again.",
          );
        }
      } finally {
        if (!cancelled) setIsResolving(false);
      }
    };

    resolveRound();
    return () => {
      cancelled = true;
    };
  }, [roundClosed, roundResult, startingPrice, prediction, resolutionAttempt]);

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

  const countdownGradient = roundClosed
    ? "linear-gradient(135deg,#6b7280,#4b5563)"
    : isUrgent
      ? "linear-gradient(135deg,#fb7185,#f43f5e)"
      : "linear-gradient(135deg,#fbbf24,#f59e0b)";

  const leaderboardSorted = useMemo<LeaderboardEntry[]>(() => {
    return [
      ...agents.map((agent) => ({
        name: agent.name,
        points: agent.points,
        type: "agent" as const,
      })),
      { name: "You", points: userPoints, type: "user" as const },
    ]
      .sort((a, b) => b.points - a.points)
      .map((entry, index) => ({ ...entry, rank: index + 1 }));
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
    <main className="relative min-h-screen overflow-x-hidden bg-[#05060a] text-white">
      {/* Animated mesh-gradient background */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden="true">
        <div className="mesh-blob mesh-blob-1" />
        <div className="mesh-blob mesh-blob-2" />
        <div className="mesh-blob mesh-blob-3" />
        <div className="mesh-blob mesh-blob-4" />
        <div className="mesh-grid" />
        <div className="mesh-noise" />
      </div>

      <div className="relative mx-auto max-w-[1200px] px-5 py-6 sm:px-8 lg:px-10">
        {/* Header */}
        <header className="glass-panel flex items-center justify-between rounded-2xl px-5 py-4">
          <div className="flex items-center gap-3">
            <div
              className="flex h-10 w-10 items-center justify-center rounded-xl"
              style={{ background: "linear-gradient(135deg,#fbbf24,#f59e0b)" }}
            >
              <Zap className="h-5 w-5 text-black" aria-hidden="true" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[15px] font-bold tracking-tight">
                  Agent Arena
                </span>
                <span className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[10px] text-white/60">
                  v1
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-5">
            <span className="hidden items-center gap-1.5 text-[13px] text-white/50 sm:flex">
              <Users className="h-3.5 w-3.5" aria-hidden="true" />
              1,284 watching
            </span>
            <span className="flex items-center gap-2 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1.5">
              <span className="live-dot" />
              <span className="text-[12px] font-medium text-emerald-300">
                Live
              </span>
            </span>
          </div>
        </header>

        {/* Hero */}
        <section className="glass-panel mt-5 rounded-3xl p-6 sm:p-9">
          <div className="grid gap-8 lg:grid-cols-[1fr_auto] lg:items-end">
            <div>
              <p className="text-[13px] text-white/50">Bitcoin · BTC/USD</p>

              <div className="mt-3 flex flex-wrap items-end gap-4">
                <span className="hero-price text-6xl font-extrabold tracking-[-0.03em] tabular-nums sm:text-7xl lg:text-8xl">
                  {loading
                    ? "···"
                    : market
                      ? formatPrice(market.price)
                      : "--"}
                </span>

                {market && (
                  <span
                    className={`mb-3 flex items-center gap-1 rounded-full px-3 py-1 text-base font-semibold tabular-nums ${
                      market.change24h >= 0
                        ? "bg-emerald-400/10 text-emerald-300"
                        : "bg-rose-400/10 text-rose-300"
                    }`}
                  >
                    {market.change24h >= 0 ? (
                      <ArrowUp className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <ArrowDown className="h-4 w-4" aria-hidden="true" />
                    )}
                    {market.change24h >= 0 ? "+" : "-"}
                    {Math.abs(market.change24h).toFixed(2)}%
                  </span>
                )}
              </div>

              {error && (
                <p className="mt-3 text-sm text-rose-300" role="alert">
                  {error}
                </p>
              )}
              {!loading && !error && !market && (
                <p className="mt-3 text-sm text-white/40">
                  Market data is temporarily unavailable.
                </p>
              )}
              {startingPrice !== null && !roundClosed && (
                <p className="mt-3 text-[13px] text-white/40">
                  opened this round at{" "}
                  <span className="tabular-nums text-white/70">
                    {formatPrice(startingPrice)}
                  </span>
                </p>
              )}
            </div>

            <div className="flex gap-6 lg:flex-col lg:items-end lg:gap-4">
              <div className="stat-chip">
                <p className="text-2xl font-bold tabular-nums">
                  {String(roundNumber).padStart(3, "0")}
                </p>
                <p className="text-[11px] text-white/40">round</p>
              </div>
              <div className="stat-chip">
                <p className="text-2xl font-bold tabular-nums">1,284</p>
                <p className="text-[11px] text-white/40">entries</p>
              </div>
            </div>
          </div>

          <div className="chart-frame mt-7 h-[220px] overflow-hidden rounded-2xl sm:h-[280px]">
            <PriceHistoryChart
              data={priceHistory}
              loading={historyLoading}
              error={historyError}
            />
          </div>
          <p className="mt-3 text-[12px] text-white/40">
            24-hour history, refreshed every minute
          </p>
        </section>

        {/* Prediction */}
        <section className="mt-5 grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="glass-panel rounded-3xl p-6 sm:p-8">
            <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
              Where does it{" "}
              <span className="gradient-text">go</span>?
            </h2>
            <p className="mt-4 max-w-sm text-[14px] leading-6 text-white/50">
              {roundClosed
                ? roundResult
                  ? `${resultLabel}.`
                  : "This round has closed. Waiting for the final price."
                : "Predict Bitcoin's direction before the round closes."}
            </p>

            <div
              className="countdown-badge mt-8 inline-flex items-center gap-2 rounded-2xl px-5 py-3 text-3xl font-extrabold tabular-nums"
              style={{ background: countdownGradient }}
              aria-label={
                roundClosed
                  ? "Round closed"
                  : `Round time remaining: ${formatTime(timeLeft)}`
              }
            >
              <Clock3 className="h-6 w-6" aria-hidden="true" />
              {formatTime(timeLeft)}
            </div>
          </div>

          <div className="glass-panel rounded-3xl p-6 sm:p-8">
            {!roundClosed ? (
              <div className="space-y-3">
                <motion.button
                  type="button"
                  aria-label="Predict price will go up"
                  aria-pressed={prediction === "UP"}
                  onClick={() => setPrediction("UP")}
                  whileHover={{ scale: 1.015, y: -2 }}
                  whileTap={{ scale: 0.985 }}
                  transition={{ type: "spring", stiffness: 400, damping: 25 }}
                  className={`predict-btn predict-up flex w-full items-center justify-between rounded-2xl px-5 py-5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#05060a] ${
                    prediction === "UP" ? "predict-up-active" : ""
                  }`}
                >
                  <span className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-400 text-black">
                      <ArrowUp className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <span>
                      <span className="block text-[15px] font-bold">
                        Goes up
                      </span>
                      <span className="block text-[12px] text-white/50">
                        Bullish
                      </span>
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 text-white/40" aria-hidden="true" />
                </motion.button>

                <motion.button
                  type="button"
                  aria-label="Predict price will go down"
                  aria-pressed={prediction === "DOWN"}
                  onClick={() => setPrediction("DOWN")}
                  whileHover={{ scale: 1.015, y: -2 }}
                  whileTap={{ scale: 0.985 }}
                  transition={{ type: "spring", stiffness: 400, damping: 25 }}
                  className={`predict-btn predict-down flex w-full items-center justify-between rounded-2xl px-5 py-5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#05060a] ${
                    prediction === "DOWN" ? "predict-down-active" : ""
                  }`}
                >
                  <span className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-400 text-black">
                      <ArrowDown className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <span>
                      <span className="block text-[15px] font-bold">
                        Goes down
                      </span>
                      <span className="block text-[12px] text-white/50">
                        Bearish
                      </span>
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 text-white/40" aria-hidden="true" />
                </motion.button>

                {prediction && (
                  <motion.p
                    initial={{ opacity: 0, y: 3 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="pt-1 text-[13px] text-white/50"
                  >
                    Locked in:{" "}
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
            ) : roundResult ? (
              <div>
                <div className="result-card rounded-2xl p-6">
                  <div className="flex items-center justify-between text-[12px] text-white/50">
                    <span>Result</span>
                    <span
                      className={
                        roundResult === "WIN"
                          ? "text-emerald-300"
                          : roundResult === "LOSS"
                            ? "text-rose-300"
                            : "text-amber-300"
                      }
                    >
                      {roundResult}
                    </span>
                  </div>
                  <p className="mt-3 text-xl font-bold">{resultLabel}.</p>

                  <div className="mt-5 space-y-2.5 border-t border-white/10 pt-4 text-[13px]">
                    <div className="flex justify-between">
                      <span className="text-white/40">Your call</span>
                      <span>{prediction ?? "None"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-white/40">Market moved</span>
                      <span>{actualDirection}</span>
                    </div>
                    <div className="flex justify-between tabular-nums">
                      <span className="text-white/40">Open</span>
                      <span>{formatPrice(startingPrice)}</span>
                    </div>
                    <div className="flex justify-between tabular-nums">
                      <span className="text-white/40">Close</span>
                      <span>{formatPrice(endingPrice)}</span>
                    </div>
                    {roundResult === "WIN" && (
                      <div className="flex justify-between pt-1 text-emerald-300">
                        <span>Points</span>
                        <span>+{WIN_POINTS}</span>
                      </div>
                    )}
                  </div>
                </div>

                <motion.button
                  type="button"
                  onClick={resetRound}
                  whileHover={{ scale: 1.015 }}
                  whileTap={{ scale: 0.985 }}
                  className="next-round-btn mt-4 flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-4 text-[14px] font-bold text-black"
                >
                  <RefreshCcw className="h-3.5 w-3.5" aria-hidden="true" />
                  Next round
                </motion.button>
              </div>
            ) : (
              <div className="result-card rounded-2xl p-6 text-center" aria-live="polite">
                <Clock3
                  className={`mx-auto h-6 w-6 text-amber-300 ${
                    isResolving ? "animate-spin" : ""
                  }`}
                  aria-hidden="true"
                />
                <p className="mt-4 text-[15px] font-bold">
                  {resolutionError
                    ? "Couldn't resolve round"
                    : isResolving
                      ? "Resolving…"
                      : "Preparing…"}
                </p>
                <p className="mx-auto mt-2 max-w-[220px] text-[13px] text-white/50">
                  {resolutionError ?? "Waiting for the latest market snapshot."}
                </p>
                {resolutionError && (
                  <motion.button
                    type="button"
                    whileHover={{ scale: 1.03 }}
                    onClick={() => {
                      setResolutionError(null);
                      setResolutionAttempt((current) => current + 1);
                    }}
                    className="mt-4 inline-flex items-center gap-2 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-2 text-[13px] font-semibold text-amber-300"
                  >
                    <RefreshCcw className="h-3.5 w-3.5" aria-hidden="true" />
                    Retry
                  </motion.button>
                )}
              </div>
            )}

            <div className="mt-6 flex items-center justify-between">
              <span className="text-[13px] text-white/50">Your points</span>
              <span className="gradient-text text-2xl font-extrabold tabular-nums">
                {userPoints.toLocaleString()}
              </span>
            </div>
          </div>
        </section>

        {/* Agents */}
        <section className="glass-panel mt-5 rounded-3xl p-6 sm:p-8">
          <div className="mb-6 flex items-end justify-between">
            <h3 className="text-2xl font-extrabold tracking-tight">
              Agent predictions
            </h3>
            <span className="hidden text-[13px] text-white/40 sm:block">
              This round
            </span>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            {agents.map((agent, index) => (
              <motion.div
                key={agent.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                whileHover={{ y: -4 }}
                transition={{ delay: index * 0.08, duration: 0.3 }}
                className="agent-card rounded-2xl p-5"
              >
                <div className="flex items-center gap-3">
                  <span
                    className="flex h-10 w-10 items-center justify-center rounded-full text-[11px] font-extrabold text-black"
                    style={{ background: agent.gradient }}
                  >
                    {agent.shortName}
                  </span>
                  <div>
                    <p className="text-[15px] font-bold">{agent.name}</p>
                    <p className="text-[12px] text-white/40">
                      {agent.strategy}
                    </p>
                  </div>
                </div>

                <div className="mt-6 flex items-baseline justify-between">
                  <span
                    className={`text-2xl font-extrabold ${
                      agent.prediction === "UP"
                        ? "text-emerald-300"
                        : "text-rose-300"
                    }`}
                  >
                    {agent.prediction}
                  </span>
                  <span className="text-[13px] tabular-nums text-white/50">
                    {agent.confidence}% confident
                  </span>
                </div>

                <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-1.5 rounded-full"
                    style={{
                      width: `${agent.confidence}%`,
                      background: agent.gradient,
                    }}
                  />
                </div>

                <div className="mt-4 flex items-center justify-between text-[12px] text-white/40">
                  <span className="tabular-nums">
                    {agent.wins}W – {agent.losses}L
                  </span>
                  <span className="gradient-text font-bold tabular-nums">
                    {agent.points.toLocaleString()} pts
                  </span>
                </div>
              </motion.div>
            ))}
          </div>
        </section>

        {/* Leaderboard */}
        <section className="glass-panel mt-5 rounded-3xl p-6 sm:p-8">
          <div className="mb-5 flex items-end justify-between">
            <h3 className="text-2xl font-extrabold tracking-tight">
              Leaderboard
            </h3>
            <Trophy className="h-5 w-5 text-amber-300" aria-hidden="true" />
          </div>

          <div className="space-y-2">
            {leaderboardSorted.map((entry) => (
              <div
                key={`${entry.type}-${entry.name}`}
                className={`leaderboard-row flex items-center justify-between rounded-xl px-4 py-3.5 ${
                  entry.type === "user" ? "leaderboard-row-user" : ""
                }`}
              >
                <div className="flex items-center gap-4">
                  <span className="flex h-7 w-7 items-center justify-center">
                    {entry.rank <= 3 ? (
                      <Medal
                        className={`h-4 w-4 ${
                          entry.rank === 1
                            ? "text-amber-300"
                            : "text-white/40"
                        }`}
                        aria-hidden="true"
                      />
                    ) : (
                      <span className="text-[12px] tabular-nums text-white/40">
                        {entry.rank}
                      </span>
                    )}
                  </span>
                  <div>
                    <p className="text-[15px] font-semibold">{entry.name}</p>
                    <p className="text-[12px] text-white/40">
                      {entry.type === "user" ? "You" : "AI agent"}
                    </p>
                  </div>
                </div>
                <span className="text-[15px] font-bold tabular-nums">
                  {entry.points.toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </section>

        <footer className="mt-6 flex flex-col gap-1 py-4 text-[12px] text-white/30 sm:flex-row sm:items-center sm:justify-between">
          <span>Agent Arena V1</span>
          <span>Virtual points only, no real-money wagering</span>
        </footer>
      </div>
    </main>
  );
}
