export type WsLifecycleState =
  | "IDLE"
  | "CONNECTING"
  | "CONNECTED"
  | "DEGRADED"
  | "RECONNECTING"
  | "STALE"
  | "FAILED";

export type MarketSocketLike = {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: string, listener: (event: { data?: unknown }) => void): void;
  removeEventListener?(type: string, listener: (event: { data?: unknown }) => void): void;
  readyState?: number;
};

export type SocketFactory = (url: string) => MarketSocketLike;

export type WsConnectionOptions = {
  url: string;
  name: string;
  socketRole?: string;
  factory?: SocketFactory;
  staleMs?: number;
  maxBackoffMs?: number;
  onMessage: (raw: unknown, receiveTime: number) => void;
  onOpen?: (meta: { connectionId: string; at: number; reconnect: boolean }) => void;
  onClose?: (meta: {
    connectionId: string;
    socketRole: string;
    at: number;
    closeCode?: number;
    closeReason?: string;
    uptimeMs: number;
  }) => void;
  onReconnectAttempt?: (meta: { attempt: number; delayMs: number }) => void;
  onReconnectSuccess?: (meta: { connectionId: string; at: number; reconnectCount: number }) => void;
  onPlannedRotation?: (meta: { connectionId: string; at: number; reason: string }) => void;
  onState?: (state: WsLifecycleState) => void;
};

const OPEN = 1;

export class WsConnection {
  state: WsLifecycleState = "IDLE";
  reconnectCount = 0;
  connectedAt = 0;
  lastMessageAt = 0;
  lastError: string | null = null;
  private socket: MarketSocketLike | null = null;
  private stopped = true;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private staleTimer: ReturnType<typeof setInterval> | null = null;
  private readonly staleMs: number;
  private readonly maxBackoffMs: number;
  private plannedReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connectionId: string | null = null;
  private lastCloseCode: number | null = null;

  constructor(private readonly options: WsConnectionOptions) {
    this.staleMs = options.staleMs ?? 15_000;
    this.maxBackoffMs = options.maxBackoffMs ?? 30_000;
  }

  get uptimeMs() {
    return this.connectedAt > 0 && this.state === "CONNECTED" ? Date.now() - this.connectedAt : 0;
  }

  start() {
    this.stopped = false;
    this.connect();
  }

  stop() {
    this.stopped = true;
    this.clearTimers();
    this.socket?.close(1000, "shutdown");
    this.socket = null;
    this.setState("IDLE");
  }

  send(payload: unknown) {
    if (!this.socket || this.socket.readyState !== undefined && this.socket.readyState !== OPEN) {
      return false;
    }
    this.socket.send(typeof payload === "string" ? payload : JSON.stringify(payload));
    return true;
  }

  private connect() {
    if (this.stopped) return;
    this.setState(this.attempt > 0 ? "RECONNECTING" : "CONNECTING");
    try {
      const factory = this.options.factory ?? defaultSocketFactory;
      this.socket = factory(this.options.url);
      this.socket.addEventListener("open", () => {
        this.attempt = 0;
        this.connectedAt = Date.now();
        this.lastMessageAt = Date.now();
        this.connectionId = `${this.options.name}-${this.connectedAt}`;
        this.setState("CONNECTED");
        this.armStaleWatch();
        this.armPlannedReconnect();
        this.options.onOpen?.({
          connectionId: this.connectionId,
          at: this.connectedAt,
          reconnect: this.reconnectCount > 0,
        });
        if (this.reconnectCount > 0) {
          this.options.onReconnectSuccess?.({
            connectionId: this.connectionId,
            at: this.connectedAt,
            reconnectCount: this.reconnectCount,
          });
        }
      });
      this.socket.addEventListener("message", (event) => {
        const receiveTime = Date.now();
        this.lastMessageAt = receiveTime;
        if (this.state === "STALE" || this.state === "DEGRADED") this.setState("CONNECTED");
        let parsed: unknown = event.data;
        if (typeof event.data === "string") {
          try {
            parsed = JSON.parse(event.data);
          } catch {
            parsed = event.data;
          }
        }
        this.options.onMessage(parsed, receiveTime);
      });
      this.socket.addEventListener("error", () => {
        this.lastError = "socket_error";
        this.setState("DEGRADED");
      });
      this.socket.addEventListener("close", (event) => {
        const uptimeMs = this.connectedAt > 0 ? Date.now() - this.connectedAt : 0;
        this.options.onClose?.({
          connectionId: this.connectionId ?? `${this.options.name}-unknown`,
          socketRole: this.options.socketRole ?? this.options.name,
          at: Date.now(),
          closeCode: (event as { code?: number }).code,
          closeReason: String((event as { reason?: string }).reason ?? ""),
          uptimeMs,
        });
        this.lastCloseCode = Number((event as { code?: number }).code ?? 0) || null;
        this.connectedAt = 0;
        if (this.stopped) return;
        this.scheduleReconnect();
      });
    } catch (error) {
      this.lastError = (error as Error).message;
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.stopped) return;
    this.attempt += 1;
    this.reconnectCount += 1;
    if (this.attempt > 40) {
      this.setState("FAILED");
      return;
    }
    this.setState("RECONNECTING");
    const exp = Math.min(this.maxBackoffMs, 400 * 2 ** Math.min(this.attempt, 8));
    const jitter = Math.floor(Math.random() * Math.max(120, exp * 0.3));
    const closeCodePenalty = this.lastCloseCode === 1008 ? 5000 : 0;
    const delayMs = exp + jitter + closeCodePenalty;
    this.options.onReconnectAttempt?.({ attempt: this.attempt, delayMs });
    this.clearTimers();
    this.reconnectTimer = setTimeout(() => this.connect(), delayMs);
  }

  private armStaleWatch() {
    if (this.staleTimer) clearInterval(this.staleTimer);
    this.staleTimer = setInterval(() => {
      if (this.stopped || this.state !== "CONNECTED") return;
      if (Date.now() - this.lastMessageAt > this.staleMs) this.setState("STALE");
    }, 1_000);
  }

  private armPlannedReconnect() {
    if (this.plannedReconnectTimer) clearTimeout(this.plannedReconnectTimer);
    this.plannedReconnectTimer = setTimeout(
      () => {
        if (this.stopped) return;
        this.options.onPlannedRotation?.({
          connectionId: this.connectionId ?? `${this.options.name}-unknown`,
          at: Date.now(),
          reason: "planned_24h_reconnect",
        });
        this.socket?.close(1000, "planned_24h_reconnect");
      },
      23 * 60 * 60 * 1000,
    );
  }

  private clearTimers() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.staleTimer) clearInterval(this.staleTimer);
    if (this.plannedReconnectTimer) clearTimeout(this.plannedReconnectTimer);
    this.reconnectTimer = null;
    this.staleTimer = null;
    this.plannedReconnectTimer = null;
  }

  private setState(next: WsLifecycleState) {
    this.state = next;
    this.options.onState?.(next);
  }
}

export function defaultSocketFactory(url: string): MarketSocketLike {
  const WS = (globalThis as { WebSocket?: new (url: string) => MarketSocketLike }).WebSocket;
  if (!WS) {
    throw new Error("WebSocket is not available in this runtime");
  }
  return new WS(url);
}

export class FakeMarketSocket implements MarketSocketLike {
  readyState = 0;
  readonly listeners = new Map<string, Array<(event: { data?: unknown }) => void>>();
  sent: string[] = [];
  closed = false;

  addEventListener(type: string, listener: (event: { data?: unknown }) => void) {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close(code?: number, reason?: string) {
    this.closed = true;
    this.readyState = 3;
    this.emit("close", { code, reason });
  }

  open() {
    this.readyState = 1;
    this.emit("open", {});
  }

  emitMessage(data: unknown) {
    this.emit("message", { data: typeof data === "string" ? data : JSON.stringify(data) });
  }

  private emit(type: string, event: { data?: unknown; code?: number; reason?: string }) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}
