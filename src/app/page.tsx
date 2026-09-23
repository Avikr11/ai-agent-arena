"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowDown,
  ArrowRight,
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
import ArenaBackground3D from "@/components/ArenaBackground3D";

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
      {/* === CINEMATIC BACKGROUND STACK === */}
      <div className="arena-background-fallback" aria-hidden="true" />

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

      <div className="arena-cinematic-vignette" aria-hidden="true" />

      <ArenaBackground3D
        change24h={market?.change24h ?? 0}
        roundProgress={1 - timeLeft / ROUND_DURATION}
        userPrediction={prediction}
        roundClosed={roundClosed}
      />

      <div className="arena-cinematic-glow" aria-hidden="true" />

      {/* === FOREGROUND CONTENT === */}
      <div className="relative z-10 mx-auto max-w-[1440px] px-5 sm:px-8 lg:px-14">
        {/* HEADER */}
        <motion.header
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="arena-header"
        >
          <div className="arena-logo">
            <div className="arena-logo-mark">AA</div>
            <span className="arena-brand-title">Agent Arena</span>
          </div>

          <nav className="arena-nav">
            <a href="#arena">Arena</a>
            <a href="#agents">Agents</a>
            <a href="#leaderboard">Leaderboard</a>
            <a href="#about">About</a>
          </nav>

          <div className="flex items-center gap-3 sm:gap-4">
            <div className="arena-live-pill">
              <span className="arena-live-dot" />
              <span>Live</span>
              <span className="hidden text-white/20 sm:inline">·</span>
              <span className="hidden sm:inline">386,812</span>
            </div>

            <div className="arena-profile">
              <span>1</span>
            </div>

            <ChevronDown className="hidden h-4 w-4 text-white/40 sm:block" />
          </div>
        </motion.header>

        {/* HERO */}
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="arena-hero"
        >
          <span className="arena-hero-label">
            Live Bitcoin Prediction Arena
          </span>

          <h1 className="arena-hero-title">
            Predict the market.
            <br />
            <em>Outsmart the agents.</em>
          </h1>

          <p className="arena-hero-sub">
            A real-time arena where AI agents and humans compete on
            Bitcoin price direction. Every 45 seconds a new round begins.
            Pick your side, watch the price, and rise up the leaderboard.
          </p>

          <div className="arena-hero-actions">
            <a href="#arena" className="arena-pill arena-pill-primary">
              Enter the arena
              <ArrowRight className="h-4 w-4" />
            </a>
            <a href="#agents" className="arena-pill arena-pill-ghost">
              Meet the agents
            </a>
          </div>

          <div className="arena-hero-stats">
            <div>
              <div className="arena-hero-stat-value tabular-nums">
                {roundNumber}
              </div>
              <div className="arena-hero-stat-label">Round number</div>
            </div>
            <div>
              <div className="arena-hero-stat-value tabular-nums">
                {userPoints.toLocaleString()}
              </div>
              <div className="arena-hero-stat-label">Your points</div>
            </div>
            <div>
              <div className="arena-hero-stat-value tabular-nums">
                386,812
              </div>
              <div className="arena-hero-stat-label">Players online</div>
            </div>
          </div>
        </motion.section>

        {/* MAIN DASHBOARD */}
        <section
          id="arena"
          className="mt-4 grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]"
        >
          {/* LEFT CONTENT */}
          <div className="min-w-0">
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
              {/* CHART */}
              <motion.section
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.15 }}
                className="arena-panel arena-chart-panel"
              >
                <div className="arena-time-tabs">
                  <button>1H</button>
                  <button>5W</button>
                  <button className="active">1M</button>
                  <button>5M</button>
                  <button>AIX</button>
                </div>

                <div className="mb-6 flex items-start justify-between">
                  <div>
                    <p className="arena-label">BTC / USDT</p>

                    <div className="mt-4 flex items-end gap-4">
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
                    <p className="arena-label">Market</p>
                    <p className="mt-2 text-sm font-normal text-white/70">
                      Bitcoin
                    </p>
                  </div>
                </div>

                {error && (
                  <p className="mb-4 text-xs text-rose-300/80">{error}</p>
                )}

                <div className="arena-chart-wrapper">
                  <PriceHistoryChart
                    data={priceHistory}
                    loading={historyLoading}
                    error={historyError}
                  />
                </div>

                <div className="mt-4 flex items-center justify-between text-[10px] uppercase tracking-[0.2em] text-white/25">
                  <span>Live price history</span>
                  <span>Refreshes every 60s</span>
                </div>
              </motion.section>

              {/* COUNTDOWN AND PREDICTION */}
              <motion.section
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.2 }}
                className="arena-prediction-column"
              >
                <div className="arena-countdown">
                  <div className="arena-countdown-ring">
                    <div className="arena-countdown-inner">
                      <span className="arena-countdown-label">
                        Countdown
                      </span>

                      <strong>{formatTime(timeLeft)}</strong>

                      <span className="arena-countdown-label">
                        Time left
                      </span>
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
                    <span>Predict Up</span>
                    <ArrowUp className="h-7 w-7" />
                  </button>

                  <button
                    disabled={roundClosed}
                    onClick={() => setPrediction("DOWN")}
                    className={`arena-prediction-button arena-down-button ${
                      prediction === "DOWN" ? "selected" : ""
                    }`}
                    aria-label="Predict price will go down"
                  >
                    <span>Predict Down</span>
                    <ArrowDown className="h-7 w-7" />
                  </button>
                </div>

                {!roundClosed && (
                  <div className="arena-status-text">
                    Select your prediction
                  </div>
                )}

                {roundClosed && !roundResult && (
                  <div className="arena-status-text">
                    {resolutionError ? (
                      <div className="flex flex-col items-center gap-3">
                        <span className="text-rose-300/90">
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
                          <RefreshCcw
                            className="h-3.5 w-3.5"
                            aria-hidden="true"
                          />
                          Retry
                        </button>
                      </div>
                    ) : (
                      <span>
                        {isResolving
                          ? "Resolving round..."
                          : "Preparing result..."}
                      </span>
                    )}
                  </div>
                )}

                {!showRoundResult && roundClosed && roundResult && (
                  <button onClick={resetRound} className="arena-next-button">
                    Start next round
                  </button>
                )}
              </motion.section>
            </div>

            {/* AGENT CARDS */}
            <section id="agents" className="arena-section">
              <div className="arena-section-head">
                <h2 className="arena-section-title">
                  Meet the <em>agents</em>
                </h2>
                <span className="arena-section-meta">
                  {agents.length} competing this round
                </span>
              </div>

              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
                {agents.map((agent, index) => (
                  <motion.article
                    key={agent.id}
                    initial={{ opacity: 0, y: 18 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.08 }}
                    className={`arena-agent-card agent-${agent.id}`}
                  >
                    <div className="arena-agent-icon">
                      {index === 0 && <Flame />}
                      {index === 1 && <Waves />}
                      {index === 2 && <ArrowDown />}
                    </div>

                    <h3>{agent.name}</h3>

                    <div className="arena-agent-tags">
                      <span>AI Agent</span>
                      <span>{agent.strategy}</span>
                    </div>

                    <div className="mt-5 flex items-center justify-between">
                      <div>
                        <p className="arena-small-label">Prediction</p>
                        <p className="arena-agent-prediction">
                          {agent.prediction}
                        </p>
                      </div>

                      <div className="text-right">
                        <p className="arena-small-label">Confidence</p>
                        <p className="text-sm font-medium tabular-nums">
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

                    <div className="mt-4 flex justify-between text-[10px] tracking-[0.14em] text-white/35">
                      <span>{agent.points.toLocaleString()} pts</span>
                      <span>
                        {agent.wins}W / {agent.losses}L
                      </span>
                    </div>
                  </motion.article>
                ))}

                <motion.article
                  initial={{ opacity: 0, y: 18 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.24 }}
                  className="arena-agent-card agent-user"
                >
                  <div className="arena-user-icon">
                    <Users />
                  </div>

                  <h3>You</h3>

                  <div className="arena-agent-tags">
                    <span>Strategy</span>
                    <span>Manual</span>
                  </div>

                  <div className="mt-5 flex items-center justify-between">
                    <div>
                      <p className="arena-small-label">Prediction</p>
                      <p className="arena-agent-prediction">
                        {prediction ?? "--"}
                      </p>
                    </div>

                    <div className="text-right">
                      <p className="arena-small-label">Points</p>
                      <p className="text-sm font-medium tabular-nums">
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
              <span>Round {roundNumber}</span>
              <span>386,812 players</span>
              <span className="hidden sm:inline">
                Win rate <b>92%</b>
              </span>
              <span className="ml-auto">Virtual points only</span>
            </footer>
          </div>

          {/* LEADERBOARD */}
          <motion.aside
            id="leaderboard"
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: 0.25 }}
            className="arena-leaderboard"
          >
            <div className="arena-leaderboard-heading">
              Live Leaderboard
            </div>

            <div className="space-y-1">
              {leaderboardSorted.map((entry) => (
                <div
                  key={`${entry.type}-${entry.name}`}
                  className={`arena-leaderboard-row ${
                    entry.type === "user" ? "current-user" : ""
                  }`}
                >
                  <span className="arena-rank">
                    {String(entry.rank).padStart(2, "0")}
                  </span>

                  <div className={`arena-rank-icon rank-${entry.rank}`}>
                    {entry.type === "user" ? (
                      <Users className="h-4 w-4" />
                    ) : entry.name === "Degen" ? (
                      <Flame className="h-4 w-4" />
                    ) : entry.name === "Whale Watcher" ? (
                      <Waves className="h-4 w-4" />
                    ) : (
                      <ArrowDown className="h-4 w-4" />
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium uppercase tracking-wider text-white/80">
                      {entry.name}
                    </p>
                  </div>

                  <span className="arena-leaderboard-points">
                    {entry.points.toLocaleString()}
                  </span>
                </div>
              ))}
            </div>

            <div className="mt-8 border-t border-white/5 pt-6 text-center">
              <Trophy className="mx-auto h-5 w-5 text-amber-300/70" />

              <p className="mt-3 text-[10px] uppercase tracking-[0.24em] text-white/30">
                Compete. Predict. Win.
              </p>
            </div>
          </motion.aside>
        </section>

        {/* ABOUT / FOOTER */}
        <section id="about" className="arena-section pb-20">
          <div className="arena-section-head">
            <h2 className="arena-section-title">
              About the <em>arena</em>
            </h2>
            <span className="arena-section-meta">Virtual points only</span>
          </div>

          <p className="max-w-2xl text-sm leading-relaxed text-white/50">
            Agent Arena is a demonstration of AI agents competing with
            humans on short-horizon Bitcoin price prediction. Every 45
            seconds a new round begins — agents lock in their picks, you
            lock in yours, and the price decides the winner. No real
            money is involved.
          </p>
        </section>
      </div>

      {/* RESULT MODAL */}
      {roundClosed && roundResult && showRoundResult && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-[#05070a]/85 px-4 backdrop-blur-xl"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          role="dialog"
          aria-modal="true"
          aria-label="Round result"
        >
          <motion.div
            className={`relative w-full max-w-[640px] overflow-hidden rounded-[24px] border p-10 text-center backdrop-blur-2xl sm:p-14 ${
              resultIsWin
                ? "border-emerald-300/40 bg-emerald-950/40"
                : resultIsLoss
                  ? "border-rose-400/40 bg-rose-950/40"
                  : "border-amber-300/40 bg-amber-950/40"
            }`}
            initial={{ scale: 0.9, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 180, damping: 20 }}
          >
            <div className="relative z-10">
              <motion.div
                className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full border ${
                  resultIsWin
                    ? "border-emerald-200/60 bg-emerald-300/10 text-emerald-200"
                    : resultIsLoss
                      ? "border-rose-200/60 bg-rose-300/10 text-rose-200"
                      : "border-amber-200/60 bg-amber-300/10 text-amber-200"
                }`}
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.15, type: "spring" }}
              >
                {resultIsWin ? (
                  <CheckCircle2 className="h-9 w-9" />
                ) : resultIsLoss ? (
                  <X className="h-9 w-9" />
                ) : (
                  <Circle className="h-9 w-9" />
                )}
              </motion.div>

              <p className="mt-7 font-mono text-[10px] uppercase tracking-[0.32em] text-white/40">
                Round {roundNumber} complete
              </p>

              <h2 className="mt-4 text-3xl font-normal tracking-tight text-white sm:text-5xl">
                {resultIsWin ? (
                  <>
                    You <em className="italic text-emerald-300">won</em>
                  </>
                ) : resultIsLoss ? (
                  <>
                    Round <em className="italic text-rose-300">lost</em>
                  </>
                ) : (
                  <>
                    Round <em className="italic text-amber-200">draw</em>
                  </>
                )}
              </h2>

              <div className="mx-auto mt-8 max-w-[440px] rounded-2xl border border-white/8 bg-black/25 px-6 py-6">
                <p className="text-sm text-white/60">
                  BTC went{" "}
                  <span
                    className={`font-medium ${
                      actualDirection === "UP"
                        ? "text-emerald-300"
                        : actualDirection === "DOWN"
                          ? "text-rose-300"
                          : "text-amber-200"
                    }`}
                  >
                    {actualDirection ?? "FLAT"}
                  </span>{" "}
                  <span className="font-medium tabular-nums">
                    {roundChangePercent >= 0 ? "+" : ""}
                    {roundChangePercent.toFixed(2)}%
                  </span>
                </p>

                <p
                  className={`mt-3 font-mono text-xs uppercase tracking-[0.18em] ${
                    resultIsWin
                      ? "text-emerald-300"
                      : resultIsLoss
                        ? "text-rose-300"
                        : "text-amber-200"
                  }`}
                >
                  {resultIsWin
                    ? `+${WIN_POINTS} points`
                    : resultIsLoss
                      ? "0 points"
                      : "0 points"}
                </p>
              </div>

              <button
                type="button"
                onClick={resetRound}
                className="arena-pill arena-pill-primary mt-8"
              >
                {resultIsLoss ? "Try next round" : "Next round"}
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}

      {roundClosed && roundResult && !showRoundResult && (
        <div className="pointer-events-none fixed left-0 right-0 top-24 z-[100] flex justify-center px-4">
          <button
            type="button"
            onClick={resetRound}
            className="arena-pill arena-pill-primary pointer-events-auto"
          >
            Start next round
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </main>
  );
}