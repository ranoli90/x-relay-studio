/** Coins the desk can pay with. IDs are Plisio psys_cid values. */

export type Coin = {
  id: string;
  ticker: string;
  label: string;
  network: string;
};

export const COINS: readonly Coin[] = [
  { id: "USDT_TRX", ticker: "USDT", label: "Tether", network: "TRC-20" },
  { id: "USDT", ticker: "USDT", label: "Tether", network: "ERC-20" },
  { id: "USDT_BSC", ticker: "USDT", label: "Tether", network: "BEP-20" },
  { id: "USDC", ticker: "USDC", label: "USD Coin", network: "ERC-20" },
  { id: "BTC", ticker: "BTC", label: "Bitcoin", network: "Bitcoin" },
  { id: "ETH", ticker: "ETH", label: "Ethereum", network: "Ethereum" },
  { id: "LTC", ticker: "LTC", label: "Litecoin", network: "Litecoin" },
  { id: "TRX", ticker: "TRX", label: "Tron", network: "Tron" },
  { id: "TON", ticker: "TON", label: "Toncoin", network: "TON" },
  { id: "SOL", ticker: "SOL", label: "Solana", network: "Solana" },
  { id: "DOGE", ticker: "DOGE", label: "Dogecoin", network: "Dogecoin" },
] as const;

export const DEFAULT_COIN = "USDT_TRX";

const BY_ID = new Map(COINS.map((c) => [c.id, c]));

export function coinById(id: string): Coin | null {
  return BY_ID.get(id) ?? null;
}

export function assertCoin(id: string): Coin {
  const coin = coinById(id);
  if (!coin) throw new Error("That coin is not on the desk.");
  return coin;
}
