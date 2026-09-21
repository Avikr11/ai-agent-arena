import type { MarketData } from "@/types/market";

const MARKET_API_URL = "/api/market";
const REQUEST_TIMEOUT = 15_000;

function isValidMarketData(data: unknown): data is MarketData {
  if (!data || typeof data !== "object") {
    return false;
  }

  const market = data as Record<string, unknown>;

  return (
    typeof market.symbol === "string" &&
    market.symbol.length > 0 &&
    typeof market.price === "number" &&
    Number.isFinite(market.price) &&
    typeof market.change24h === "number" &&
    Number.isFinite(market.change24h) &&
    typeof market.lastUpdated === "number" &&
    Number.isFinite(market.lastUpdated)
  );
}

export async function fetchBitcoinPrice(
  forceFresh = false,
): Promise<MarketData> {
  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, REQUEST_TIMEOUT);

  try {
    const url = forceFresh
      ? `${MARKET_API_URL}?fresh=1`
      : MARKET_API_URL;

    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(
        `Market data request failed with status ${response.status}`,
      );
    }

    const data: unknown = await response.json();

    if (!isValidMarketData(data)) {
      throw new Error("Market data response has an invalid format");
    }

    return data;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Market data request timed out after 15 seconds");
    }

    if (error instanceof Error) {
      throw error;
    }

    throw new Error("Unable to fetch market data");
  } finally {
    clearTimeout(timeout);
  }
}