
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const COINGECKO_HISTORY_URL =
  "https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=1&interval=hourly";

const UPSTREAM_TIMEOUT = 8_000;
const CACHE_DURATION = 60_000;

interface HistoryPoint {
  timestamp: number;
  price: number;
}

interface CoinGeckoResponse {
  prices?: unknown;
}

let cachedHistory: HistoryPoint[] | null = null;
let cacheExpiresAt = 0;
let activeRequest: Promise<HistoryPoint[]> | null = null;

function isValidPriceEntry(
  entry: unknown,
): entry is [number, number] {
  return (
    Array.isArray(entry) &&
    entry.length >= 2 &&
    typeof entry[0] === "number" &&
    Number.isFinite(entry[0]) &&
    typeof entry[1] === "number" &&
    Number.isFinite(entry[1])
  );
}

async function fetchHistoryFromCoinGecko(): Promise<HistoryPoint[]> {
  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, UPSTREAM_TIMEOUT);

  try {
    const response = await fetch(COINGECKO_HISTORY_URL, {
      cache: "no-store",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(
        `CoinGecko history request failed with status ${response.status}`,
      );
    }

    const data: unknown = await response.json();

    if (!data || typeof data !== "object") {
      throw new Error("CoinGecko returned an invalid response");
    }

    const responseData = data as CoinGeckoResponse;

    if (!Array.isArray(responseData.prices)) {
      throw new Error("CoinGecko returned an invalid history format");
    }

    const prices: HistoryPoint[] = responseData.prices
      .filter(isValidPriceEntry)
      .map(([timestamp, price]) => ({
        timestamp,
        price,
      }));

    if (prices.length === 0) {
      throw new Error("No historical Bitcoin prices were returned");
    }

    return prices;
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET() {
  const now = Date.now();

  if (cachedHistory && now < cacheExpiresAt) {
    return NextResponse.json({
      prices: cachedHistory,
      lastUpdated: now,
    });
  }

  if (!activeRequest) {
    activeRequest = fetchHistoryFromCoinGecko()
      .then((prices) => {
        cachedHistory = prices;
        cacheExpiresAt = Date.now() + CACHE_DURATION;

        return prices;
      })
      .finally(() => {
        activeRequest = null;
      });
  }

  try {
    const prices = await activeRequest;

    return NextResponse.json({
      prices,
      lastUpdated: Date.now(),
    });
  } catch (error) {
    console.error("Market history API error:", error);

    if (
      error instanceof DOMException &&
      error.name === "AbortError"
    ) {
      return NextResponse.json(
        {
          error: "CoinGecko history request timed out",
        },
        { status: 504 },
      );
    }

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to fetch market history",
      },
      { status: 502 },
    );
  }
}
