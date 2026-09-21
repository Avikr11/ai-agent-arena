"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Circle,
  CheckCircle2,
  Flame,
  RefreshCcw,
  Trophy,
  Users,
  X,
  Waves,
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
};

type LeaderboardEntry = {
  rank: number;
  name: string;
  points: number;
  type: "agent" | "user";
};

const ROUND_DURATION = 45;
const WIN_POINTS = 120;

const initialAgents: Agent[] = [
  {
    id: "degen",
    name: "Degen",
    shortName: "DG",
    strategy: "Aggressive",
    prediction: "UP",
    confidence: 78,
    points: 15470,
    wins: 0,
    losses: 0,
  },
  {
    id: "whale",
    name: "Whale Watcher",
    shortName: "WW",
    strategy: "Trend-Following",
    prediction: "UP",
    confidence: 84,
    points: 3035,
    wins: 0,
    losses: 0,
  },
  {
    id: "contrarian",
    name: "Contrarian",
    shortName: "CT",
    strategy: "Trend-Following",
    prediction: "DOWN",
    confidence: 71,
    points: 1805,
    wins: 0,
    losses: 0,
  },
];

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

    return {
      prediction,
      confidence: clampConfidence(64 + strength * 3),
    };
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

  const [roundNumber, setRoundNumber] = useState(11);
  const [roundEndAt, setRoundEndAt] = useState<number | null>(null);
  const [timeLeft, setTimeLeft] = useState(ROUND_DURATION);

  const [prediction, setPrediction] = useState<Prediction | null>(null);
  const [startingPrice, setStartingPrice] = useState<number | null>(null);
  const [endingPrice, setEndingPrice] = useState<number | null>(null);

  const [roundClosed, setRoundClosed] = useState(false);
  const [roundResult, setRoundResult] = useState<RoundResult | null>(null);
  const [showRoundResult, setShowRoundResult] = useState(false);
  const [actualDirection, setActualDirection] =
    useState<RoundDirection | null>(null);

  const [isResolving, setIsResolving] = useState(false);
  const [resolutionError, setResolutionError] = useState<string | null>(null);
  const [resolutionAttempt, setResolutionAttempt] = useState(0);

  const [userPoints, setUserPoints] = useState(2550);
  const [agents, setAgents] = useState(initialAgents);

  const [priceHistory, setPriceHistory] = useState<PriceHistoryPoint[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);

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

      if (remainingMs <= 0) {
        setRoundClosed(true);
      }
    };

    updateCountdown();

    const timer = window.setInterval(updateCountdown, 250);

    return () => window.clearInterval(timer);
  }, [roundEndAt, roundClosed]);

  /*
   * Starts a new round and locks in each agent's prediction for that round.
   *
   * FIX: agent decisions now only get set here, once, when a round actually
   * begins (roundEndAt === null). Previously this ran on every market poll
   * (every 30s), which meant an agent's displayed prediction could silently
   * change mid-round or even after resolution had already judged it.
   */
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

  /*
   * Resolves the round exactly once after the timer reaches zero.
   *
   * FIX: isResolving / resolutionError / resolutionAttempt restored so a
   * failed fetch no longer leaves the round hanging with no feedback and
   * no way to recover.
   */
  useEffect(() => {
    if (!roundClosed || roundResult || startingPrice === null) return;

    let cancelled = false;

    async function resolveRound() {
      setIsResolving(true);
      setResolutionError(null);

      try {
        const freshMarket = await fetchBitcoinPrice(true);
        if (cancelled) return;

        const finalPrice = freshMarket.price;
        const initialPrice = startingPrice;
        if (initialPrice === null) return;

        const direction = getDirection(initialPrice, finalPrice);
        setEndingPrice(finalPrice);
        setActualDirection(direction);

        if (direction !== "FLAT") {
          setAgents((currentAgents) =>
            currentAgents.map((agent) => {
              const won = agent.prediction === direction;
              return {
                ...agent,
                points: won ? agent.points + WIN_POINTS : agent.points,
                wins: won ? agent.wins + 1 : agent.wins,
                losses: won ? agent.losses : agent.losses + 1,
              };
            }),
          );
        }

        if (direction === "FLAT" || prediction === null) {
          setRoundResult("PUSH");
        } else if (prediction === direction) {
          setRoundResult("WIN");
          setUserPoints((current) => current + WIN_POINTS);
        } else {
          setRoundResult("LOSS");
        }
      } catch (resolveError) {
        console.error("Round resolution failed:", resolveError);
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
    }

    resolveRound();

    return () => {
      cancelled = true;
    };
  }, [roundClosed, roundResult, startingPrice, prediction, resolutionAttempt]);

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
              : "Unable to load price history.",
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

  const roundChangePercent =
    startingPrice !== null && endingPrice !== null && startingPrice !== 0
      ? ((endingPrice - startingPrice) / startingPrice) * 100
      : 0;

  const resultIsWin = roundResult === "WIN";
  const resultIsLoss = roundResult === "LOSS";

  useEffect(() => {
    if (!roundClosed || !roundResult) {
      setShowRoundResult(false);
      return;
    }

    setShowRoundResult(true);
  }, [roundClosed, roundResult]);

  return (
    <main className="arena-dashboard min-h-screen overflow-hidden text-white">
      <video
        className="arena-background-video"
        autoPlay
        loop
        muted
        playsInline
        aria-hidden="true"
      >
        <source src="/media/arena-background.mp4" type="video/mp4" />
      </video>

      <div className="arena-video-overlay" aria-hidden="true" />

      <div className="arena-dashboard-background" />

      <div className="relative z-10 mx-auto max-w-[1550px] px-4 pb-5 pt-5 sm:px-7 lg:px-12">
        {/* HEADER */}
        <header className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-3 sm:gap-5">
            <div className="arena-logo">
              <span>AA</span>
            </div>

            <div>
              <h1 className="arena-brand-title">AGENT ARENA</h1>
              <div className="arena-brand-line" />
            </div>
          </div>

          <div className="flex items-center gap-4 sm:gap-7">
            <div className="arena-live-pill">
              <Circle className="h-3 w-3 fill-cyan-300 text-cyan-300" />
              <span>LIVE</span>
              <span className="hidden text-white/30 sm:inline">|</span>
              <Users className="hidden h-4 w-4 text-white/60 sm:block" />
              <span className="hidden sm:inline">386,812</span>
            </div>

            <div className="hidden h-10 w-px bg-white/20 sm:block" />

            <div className="flex items-center gap-2">
              <div className="arena-profile">
                <span>1</span>
              </div>

              <ChevronDown className="h-4 w-4 text-white/60" />
            </div>
          </div>
        </header>

        {/* MAIN DASHBOARD */}
        <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_258px]">
          {/* LEFT CONTENT */}
          <div className="min-w-0">
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_365px]">
              {/* CHART */}
              <section className="arena-panel arena-chart-panel">
                <div className="arena-time-tabs">
                  <button>1H</button>
                  <button>5W</button>
                  <button className="active">1M</button>
                  <button>5M</button>
                  <button>AIX</button>
                </div>

                <div className="mb-5 flex items-center justify-between">
                  <div>
                    <p className="arena-label">BTC / USDT</p>

                    <div className="mt-2 flex items-end gap-3">
                      <h2 className="arena-price">
                        {loading
                          ? "Loading..."
                          : formatPrice(market?.price ?? null)}
                      </h2>

                      {market && (
                        <span
                          className={
                            market.change24h >= 0
                              ? "arena-positive"
                              : "arena-negative"
                          }
                        >
                          {market.change24h >= 0 ? "+" : ""}
                          {market.change24h.toFixed(2)}%
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="hidden text-right sm:block">
                    <p className="arena-label">MARKET</p>
                    <p className="mt-1 text-sm text-cyan-200">BITCOIN</p>
                  </div>
                </div>

                {error && (
                  <p className="mb-3 text-xs text-rose-300">{error}</p>
                )}

                <div className="arena-chart-wrapper">
                  <PriceHistoryChart
                    data={priceHistory}
                    loading={historyLoading}
                    error={historyError}
                  />
                </div>

                <div className="mt-4 flex items-center justify-between text-[10px] uppercase tracking-[0.16em] text-white/40">
                  <span>Live price history</span>
                  <span>60s refresh</span>
                </div>
              </section>

              {/* COUNTDOWN AND PREDICTION */}
              <section className="arena-prediction-column">
                <div className="arena-countdown">
                  <div className="arena-countdown-ring">
                    <div className="arena-countdown-inner">
                      <span className="arena-countdown-label">
                        COUNTDOWN
                      </span>

                      <strong>{formatTime(timeLeft)}</strong>

                      <span className="arena-countdown-label">TIME</span>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <button
                    disabled={roundClosed}
                    onClick={() => setPrediction("UP")}
                    className={`arena-prediction-button arena-up-button ${
                      prediction === "UP" ? "selected" : ""
                    }`}
                    aria-label="Predict price will go up"
                  >
                    <span>PREDICT UP</span>
                    <ArrowUp className="h-10 w-10" />
                  </button>

                  <button
                    disabled={roundClosed}
                    onClick={() => setPrediction("DOWN")}
                    className={`arena-prediction-button arena-down-button ${
                      prediction === "DOWN" ? "selected" : ""
                    }`}
                    aria-label="Predict price will go down"
                  >
                    <span>PREDICT DOWN</span>
                    <ArrowDown className="h-10 w-10" />
                  </button>
                </div>

                {!roundClosed && (
                  <div className="arena-status-text">
                    Select your prediction
                  </div>
                )}

                {/*
                 * FIX: while the round is closed but not yet resolved,
                 * show a resolving/error state instead of nothing. On
                 * failure, a retry button re-runs resolution without
                 * needing a full page refresh.
                 */}
                {roundClosed && !roundResult && (
                  <div className="arena-status-text">
                    {resolutionError ? (
                      <div className="flex flex-col items-center gap-3">
                        <span className="text-rose-300">
                          {resolutionError}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setResolutionError(null);
                            setResolutionAttempt((current) => current + 1);
                          }}
                          className="arena-next-button flex items-center gap-2"
                        >
                          <RefreshCcw className="h-3.5 w-3.5" aria-hidden="true" />
                          RETRY
                        </button>
                      </div>
                    ) : (
                      <span>
                        {isResolving
                          ? "RESOLVING ROUND..."
                          : "PREPARING RESULT..."}
                      </span>
                    )}
                  </div>
                )}

                {/*
                 * FIX: added `roundResult` to this condition so the
                 * fallback "start next round" button can only appear
                 * once a result actually exists — not during the
                 * resolving window, where it would conflict with the
                 * status message above.
                 */}
                {!showRoundResult && roundClosed && roundResult && (
                  <button onClick={resetRound} className="arena-next-button">
                    START NEXT ROUND
                  </button>
                )}
              </section>
            </div>

            {/* AGENT CARDS */}
            <section className="mt-6">
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
                {agents.map((agent, index) => (
                  <motion.article
                    key={agent.id}
                    initial={{ opacity: 0, y: 18 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.1 }}
                    className={`arena-agent-card agent-${agent.id}`}
                  >
                    <div className="arena-agent-icon">
                      {index === 0 && <Flame />}
                      {index === 1 && <Waves />}
                      {index === 2 && <ArrowDown />}
                    </div>

                    <h3>{agent.name}</h3>

                    <div className="arena-agent-tags">
                      <span>AI AGENT</span>
                      <span>{agent.strategy}</span>
                    </div>

                    <div className="mt-5 flex items-center justify-between">
                      <div>
                        <p className="arena-small-label">PREDICTION</p>
                        <p className="arena-agent-prediction">
                          {agent.prediction}
                        </p>
                      </div>

                      <div className="text-right">
                        <p className="arena-small-label">CONFIDENCE</p>
                        <p className="text-sm font-bold">
                          {agent.confidence}%
                        </p>
                      </div>
                    </div>

                    <div className="arena-confidence-track">
                      <div
                        style={{ width: `${agent.confidence}%` }}
                        className="arena-confidence-fill"
                      />
                    </div>

                    <div className="mt-4 flex justify-between text-[10px] text-white/40">
                      <span>{agent.points.toLocaleString()} PTS</span>
                      <span>
                        {agent.wins}W / {agent.losses}L
                      </span>
                    </div>
                  </motion.article>
                ))}

                {/* USER CARD */}
                <motion.article
                  initial={{ opacity: 0, y: 18 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 }}
                  className="arena-agent-card agent-user"
                >
                  <div className="arena-user-icon">
                    <Users />
                  </div>

                  <h3>YOU</h3>

                  <div className="arena-agent-tags">
                    <span>STRATEGY</span>
                    <span>MANUAL</span>
                  </div>

                  <div className="mt-5 flex items-center justify-between">
                    <div>
                      <p className="arena-small-label">PREDICTION</p>
                      <p className="arena-agent-prediction">
                        {prediction ?? "--"}
                      </p>
                    </div>

                    <div className="text-right">
                      <p className="arena-small-label">POINTS</p>
                      <p className="text-sm font-bold">
                        {userPoints.toLocaleString()}
                      </p>
                    </div>
                  </div>

                  <div className="arena-confidence-track">
                    <div
                      style={{ width: prediction ? "92%" : "25%" }}
                      className="arena-confidence-fill"
                    />
                  </div>
                </motion.article>
              </div>
            </section>

            {/* BOTTOM STATUS BAR */}
            <footer className="arena-bottom-bar mt-6">
              <span>ROUND #: {roundNumber}</span>
              <span>TOTAL PLAYERS: 386,812</span>
              <span className="hidden sm:inline">
                WIN RATE: <b>92%</b>
              </span>
              <span className="ml-auto">VIRTUAL POINTS ONLY</span>
            </footer>
          </div>

          {/* LEADERBOARD */}
          <aside className="arena-leaderboard">
            <div className="arena-leaderboard-heading">
              AGENT ARENA LEADERBOARD
            </div>

            <div className="space-y-1">
              {leaderboardSorted.map((entry) => (
                <div
                  key={`${entry.type}-${entry.name}`}
                  className={`arena-leaderboard-row ${
                    entry.type === "user" ? "current-user" : ""
                  }`}
                >
                  <span className="arena-rank">{entry.rank}</span>

                  <div className={`arena-rank-icon rank-${entry.rank}`}>
                    {entry.type === "user" ? (
                      <Users className="h-5 w-5" />
                    ) : entry.name === "Degen" ? (
                      <Flame className="h-5 w-5" />
                    ) : entry.name === "Whale Watcher" ? (
                      <Waves className="h-5 w-5" />
                    ) : (
                      <ArrowDown className="h-5 w-5" />
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold uppercase">
                      {entry.name}
                    </p>
                  </div>

                  <span className="arena-leaderboard-points">
                    {entry.points.toLocaleString()}
                  </span>
                </div>
              ))}
            </div>

            <div className="mt-8 border-t border-white/10 pt-5 text-center">
              <Trophy className="mx-auto h-7 w-7 text-amber-300" />

              <p className="mt-2 text-[10px] uppercase tracking-[0.18em] text-white/40">
                Compete. Predict. Win.
              </p>
            </div>
          </aside>
        </section>
      </div>

      {roundClosed && roundResult && showRoundResult && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-[#05060d]/75 px-4 backdrop-blur-md"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          role="dialog"
          aria-modal="true"
          aria-label="Round result"
        >
          <motion.div
            className={`relative w-full max-w-[720px] overflow-hidden rounded-[28px] border p-8 text-center shadow-2xl sm:p-12 ${resultIsWin ? "border-emerald-300/80 bg-emerald-950/70 shadow-emerald-500/30" : resultIsLoss ? "border-rose-400/80 bg-rose-950/70 shadow-rose-500/30" : "border-amber-300/70 bg-amber-950/70 shadow-amber-500/30"}`}
            initial={{ scale: 0.82, y: 24 }}
            animate={{ scale: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 180, damping: 18 }}
          >
            <div className="relative z-10">
              <motion.div
                className={`mx-auto flex h-20 w-20 items-center justify-center rounded-full border ${resultIsWin ? "border-emerald-200 bg-emerald-300/20 text-emerald-200" : resultIsLoss ? "border-rose-200 bg-rose-300/20 text-rose-200" : "border-amber-200 bg-amber-300/20 text-amber-200"}`}
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.15, type: "spring" }}
              >
                {resultIsWin ? (
                  <CheckCircle2 className="h-12 w-12" />
                ) : resultIsLoss ? (
                  <X className="h-12 w-12" />
                ) : (
                  <Circle className="h-12 w-12" />
                )}
              </motion.div>

              <p className="mt-7 text-xs font-semibold uppercase tracking-[0.35em] text-white/55">
                Round {roundNumber} complete
              </p>
              <h2 className="mt-3 text-4xl font-black uppercase tracking-tight text-white sm:text-6xl">
                {resultIsWin
                  ? "You Won"
                  : resultIsLoss
                    ? "Round Lost"
                    : "Round Draw"}
              </h2>
              <p className="mt-2 text-2xl font-black uppercase text-white sm:text-4xl">
                {resultIsWin
                  ? "This Round"
                  : resultIsLoss
                    ? "Try Again"
                    : "No Change"}
              </p>

              <div className="mx-auto mt-8 max-w-[510px] rounded-2xl border border-white/10 bg-black/20 px-5 py-5">
                <p className="text-lg text-white/80 sm:text-2xl">
                  BTC went{" "}
                  <span
                    className={`font-black ${actualDirection === "UP" ? "text-emerald-300" : actualDirection === "DOWN" ? "text-rose-300" : "text-amber-200"}`}
                  >
                    {actualDirection ?? "FLAT"}
                  </span>{" "}
                  <span className="font-black">
                    {roundChangePercent >= 0 ? "+" : ""}
                    {roundChangePercent.toFixed(2)}%
                  </span>
                </p>
                <p
                  className={`mt-2 text-xl font-black sm:text-3xl ${resultIsWin ? "text-emerald-300" : resultIsLoss ? "text-rose-300" : "text-amber-200"}`}
                >
                  {resultIsWin
                    ? `+${WIN_POINTS} points`
                    : resultIsLoss
                      ? "0 points, streak reset"
                      : "0 points"}
                </p>
              </div>

              <button
                type="button"
                onClick={resetRound}
                className={`mt-8 rounded-2xl border px-10 py-4 text-base font-black uppercase tracking-wide text-white transition hover:scale-[1.03] ${resultIsWin ? "border-emerald-200/80 bg-emerald-400/30 shadow-lg shadow-emerald-500/30" : resultIsLoss ? "border-rose-200/80 bg-rose-400/25 shadow-lg shadow-rose-500/30" : "border-amber-200/80 bg-amber-400/25 shadow-lg shadow-amber-500/30"}`}
              >
                {resultIsLoss ? "Try Next Round" : "Next Round"}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}

      {roundClosed && roundResult && !showRoundResult && (
        <div className="fixed left-0 right-0 top-[145px] z-[100] flex justify-center px-4 pointer-events-none">
          <button
            type="button"
            onClick={resetRound}
            className={`pointer-events-auto rounded-2xl border px-10 py-4 text-base font-black uppercase tracking-wide text-white transition hover:scale-[1.03] ${
              resultIsWin
                ? "border-emerald-200/80 bg-emerald-400/30 shadow-lg shadow-emerald-500/30"
                : resultIsLoss
                  ? "border-rose-200/80 bg-rose-400/25 shadow-lg shadow-rose-500/30"
                  : "border-amber-200/80 bg-amber-400/25 shadow-lg shadow-amber-500/30"
            }`}
          >
            START NEXT ROUND
          </button>
        </div>
      )}
    </main>
  );
}
