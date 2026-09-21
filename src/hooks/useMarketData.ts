
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchBitcoinPrice } from "@/lib/api";
import type { MarketData } from "@/types/market";

interface UseMarketDataReturn {
  market: MarketData | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const MAX_RETRIES = 2;
const RETRY_DELAY = 800;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function useMarketData(): UseMarketDataReturn {
  const [market, setMarket] = useState<MarketData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const requestIdRef = useRef(0);
  const marketRef = useRef<MarketData | null>(null);

  const refresh = useCallback(async () => {
    const requestId = ++requestIdRef.current;

    let lastError: unknown = null;

    try {
      setError(null);

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
        try {
          const data = await fetchBitcoinPrice();

          if (requestId !== requestIdRef.current) {
            return;
          }

          marketRef.current = data;
          setMarket(data);
          setError(null);

          return;
        } catch (error) {
          lastError = error;

          if (attempt < MAX_RETRIES) {
            await wait(RETRY_DELAY * (attempt + 1));
          }
        }
      }

      if (requestId !== requestIdRef.current) {
        return;
      }

      console.error("Market data refresh failed:", lastError);

      // Keep previously loaded market data visible if a refresh fails.
      if (marketRef.current === null) {
        setError("Unable to load market data");
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void refresh();

    const interval = window.setInterval(() => {
      void refresh();
    }, 30_000);

    return () => {
      window.clearInterval(interval);
      requestIdRef.current += 1;
    };
  }, [refresh]);

  return {
    market,
    loading,
    error,
    refresh,
  };
}
