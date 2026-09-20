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

export function useMarketData(): UseMarketDataReturn {
  const [market, setMarket] = useState<MarketData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const requestIdRef = useRef(0);

  const refresh = useCallback(async () => {
    const requestId = ++requestIdRef.current;

    try {
      setError(null);

      const data = await fetchBitcoinPrice();

      if (requestId !== requestIdRef.current) {
        return;
      }

      setMarket(data);
    } catch (error) {
      console.error("Market data refresh failed:", error);

      if (requestId !== requestIdRef.current) {
        return;
      }

      setError("Unable to load market data");
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    refresh();

    const interval = setInterval(refresh, 30_000);

    return () => {
      clearInterval(interval);
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