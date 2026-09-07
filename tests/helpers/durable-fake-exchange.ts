import fs from "node:fs";
import path from "node:path";

export type DurableFakeExchangeOrder = {
  clientOrderId: string;
  exchangeOrderId: string;
  symbol: string;
  side: "BUY" | "SELL";
  status: "FILLED" | "NEW" | "PARTIALLY_FILLED";
  executedQty: number;
  price: number;
  submitCount: number;
  fills: Array<{ tradeId: string; qty: number; price: number; fee: number; filledAtMs: number }>;
};

type Store = {
  submitCount: number;
  orders: Record<string, DurableFakeExchangeOrder>;
};

function readStore(filePath: string): Store {
  if (!fs.existsSync(filePath)) return { submitCount: 0, orders: {} };
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as Store;
}

function writeStore(filePath: string, store: Store) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(store, null, 2), "utf8");
}

export function createDurableFakeExchange(filePath: string) {
  return {
    filePath,
    reset() {
      writeStore(filePath, { submitCount: 0, orders: {} });
    },
    recordSubmit(input: {
      clientOrderId: string;
      symbol: string;
      side: "BUY" | "SELL";
      quantity: number;
      price: number;
      tradeId: string;
      fee: number;
      filledAtMs: number;
    }) {
      const store = readStore(filePath);
      store.submitCount += 1;
      const exchangeOrderId = `dex-${store.submitCount}`;
      store.orders[input.clientOrderId] = {
        clientOrderId: input.clientOrderId,
        exchangeOrderId,
        symbol: input.symbol,
        side: input.side,
        status: "FILLED",
        executedQty: input.quantity,
        price: input.price,
        submitCount: store.submitCount,
        fills: [
          {
            tradeId: input.tradeId,
            qty: input.quantity,
            price: input.price,
            fee: input.fee,
            filledAtMs: input.filledAtMs,
          },
        ],
      };
      writeStore(filePath, store);
      return store.orders[input.clientOrderId];
    },
    getSubmitCount() {
      return readStore(filePath).submitCount;
    },
    getOrderByClientOrderId(clientOrderId: string) {
      const order = readStore(filePath).orders[clientOrderId];
      if (!order) return null;
      return {
        orderId: order.exchangeOrderId,
        clientOrderId: order.clientOrderId,
        symbol: order.symbol,
        status: order.status,
        side: order.side,
        type: "MARKET",
        executedQty: order.executedQty,
        price: order.price,
        raw: { fills: order.fills },
      };
    },
  };
}
