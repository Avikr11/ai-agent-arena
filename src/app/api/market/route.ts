import { NextResponse } from "next/server";

const COINGECKO_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true";

const UPSTREAM_TIMEOUT = 15_000;
const CACHE_DURATION = 30_000;

let cachedMarketData: {
  symbol: string;
  price: number;
  change24h: number;
  lastUpdated: number;
} | null = null;

let cacheExpiresAt = 0;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const forceFresh = searchParams.get("fresh") === "1";
  const now = Date.now();

  // Serve cached data while it is still fresh unless a fresh request is required.
  if (!forceFresh && cachedMarketData && now < cacheExpiresAt) {
    return NextResponse.json(cachedMarketData);
  }

  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, UPSTREAM_TIMEOUT);

  try {
    const response = await fetch(COINGECKO_URL, {
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(
        `CoinGecko request failed with status ${response.status}`,
      );
    }

    const data = await response.json();

    if (
      typeof data?.bitcoin?.usd !== "number" ||
      !Number.isFinite(data.bitcoin.usd) ||
      typeof data?.bitcoin?.usd_24h_change !== "number" ||
      !Number.isFinite(data.bitcoin.usd_24h_change)
    ) {
      throw new Error("CoinGecko returned an invalid Bitcoin data format");
    }

    const marketData = {
      symbol: "BTC / USD",
      price: data.bitcoin.usd,
      change24h: data.bitcoin.usd_24h_change,
      lastUpdated: Date.now(),
    };

    cachedMarketData = marketData;
    cacheExpiresAt = Date.now() + CACHE_DURATION;

    return NextResponse.json(marketData);
  } catch (error) {
    console.error("Market API error:", error);

    // Return previously cached data if live market data is temporarily unavailable.
    // This prevents the dashboard from breaking during upstream API failures.
    if (cachedMarketData) {
      return NextResponse.json({
        ...cachedMarketData,
        stale: true,
      });
    }

    if (error instanceof DOMException && error.name === "AbortError") {
      return NextResponse.json(
        { error: "CoinGecko request timed out after 15 seconds" },
        { status: 504 },
      );
    }

    if (error instanceof Error) {
      return NextResponse.json(
        { error: error.message },
        { status: 502 },
      );
    }

    return NextResponse.json(
      { error: "Unable to fetch market data" },
      { status: 502 },
    );
  } finally {
    clearTimeout(timeout);
  }
}