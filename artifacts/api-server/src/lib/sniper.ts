import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createCloseAccountInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import bs58 from "bs58";
import WebSocket from "ws";
import { logger } from "./logger";

export type EngineState = "armed" | "stopped" | "blocked";
export type ActivityKind = "detection" | "filter" | "buy" | "sell" | "stop" | "error";
export type ActivityStatus = "pending" | "confirmed" | "rejected" | "failed";

export interface SniperConfig {
  minMarketCap: number;
  maxMarketCap: number;
  minLiquidity: number;
  requireSocials: boolean;
  minSocialScore: number;
  maxPositionSol: number;
  maxOpenPositions: number;
  takeProfitPercent: number;
  stopLossPercent: number;
  minimumHoldSeconds: number;
  jitoTipSol: number;
  slippageBps: number;
  sellOnFirstBuyer: boolean;
  maxDailyLossSol: number;
  blocklist: string[];
}

export interface TokenCandidate {
  mint: string;
  name: string;
  symbol: string;
  imageUrl: string | null;
  createdAt: Date;
  marketCap: number;
  liquidity: number;
  socialScore: number;
  socials: string[];
  riskFlags: string[];
  status: "scanning" | "eligible" | "rejected" | "entered" | "exited";
  firstBuyerAt: string | null;
  creator: string;
}

export interface SniperActivity {
  id: string;
  timestamp: Date;
  kind: ActivityKind;
  message: string;
  mint: string | null;
  signature: string | null;
  status: ActivityStatus;
  feeSol?: number;
  tipSol?: number;
}

export interface SniperPosition {
  id: string;
  mint: string;
  symbol: string;
  entryPrice: number;
  currentPrice: number;
  amountSol: number;
  tokenAmount?: number;
  pnlSol: number;
  pnlPercent: number;
  feesSol?: number;
  tipSol?: number;
  openedAt?: Date;
  state: "open" | "selling" | "closed";
}

export interface SniperStatus {
  mode: "live";
  engine: EngineState;
  rpc: "connected" | "disconnected";
  wallet: "configured" | "missing" | "invalid";
  walletAddress: string | null;
  lastBlock: number;
  latencyMs: number;
  message: string;
}

export interface SniperMetrics {
  walletBalanceSol: number;
  realizedPnlSol: number;
  unrealizedPnlSol: number;
  totalFeesSol: number;
  totalTipsSol: number;
  winRate: number;
  trades: number;
  blocksToEntry: number;
  uptimeSeconds?: number;
}

type PumpEvent = {
  txType?: string;
  mint?: string;
  name?: string;
  symbol?: string;
  uri?: string;
  traderPublicKey?: string;
  marketCapSol?: number;
  vSolInBondingCurve?: number;
  initialBuy?: number;
  solAmount?: number;
  tokenAmount?: number;
  bondingCurveKey?: string;
  pool?: string;
};

const DEFAULT_CONFIG: SniperConfig = {
  minMarketCap: 0,
  maxMarketCap: 100_000,
  minLiquidity: 4,
  requireSocials: true,
  minSocialScore: 40,
  maxPositionSol: 0.05,
  maxOpenPositions: 2,
  takeProfitPercent: 35,
  stopLossPercent: 18,
  minimumHoldSeconds: 10,
  jitoTipSol: 0.0005,
  slippageBps: 1_000,
  sellOnFirstBuyer: true,
  maxDailyLossSol: 0.25,
  blocklist: [],
};

const JITO_BUNDLE_URL =
  process.env.JITO_BUNDLE_URL ?? "https://mainnet.block-engine.jito.wtf/api/v1/bundles";
const PUMPPORTAL_TRADE_URL = "https://pumpportal.fun/api/trade-local";

function parseSecretKey(value: string): Keypair {
  const trimmed = value.trim();
  if (trimmed.startsWith("[")) {
    const bytes = JSON.parse(trimmed) as unknown;
    if (!Array.isArray(bytes) || !bytes.every((item) => Number.isInteger(item))) {
      throw new Error("SOLANA_PRIVATE_KEY must be base58 or a JSON byte array");
    }
    return Keypair.fromSecretKey(Uint8Array.from(bytes as number[]));
  }
  return Keypair.fromSecretKey(bs58.decode(trimmed));
}

function shorten(value: string): string {
  return value.length > 12 ? `${value.slice(0, 5)}…${value.slice(-5)}` : value;
}

function toNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function activity(
  kind: ActivityKind,
  message: string,
  options: Partial<SniperActivity> = {},
): SniperActivity {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date(),
    kind,
    message,
    mint: null,
    signature: null,
    status: "confirmed",
    ...options,
  };
}

export class LiveSniper {
  private readonly rpcUrl = process.env.SOLANA_RPC_URL ?? "";
  private readonly connection = this.rpcUrl
    ? new Connection(this.rpcUrl, { commitment: "confirmed" })
    : null;
  private readonly keypair = process.env.SOLANA_PRIVATE_KEY
    ? (() => {
        try {
          return parseSecretKey(process.env.SOLANA_PRIVATE_KEY as string);
        } catch (error) {
          logger.error({ err: error }, "Invalid SOLANA_PRIVATE_KEY");
          return null;
        }
      })()
    : null;
  private socket: WebSocket | null = null;
  private config: SniperConfig = { ...DEFAULT_CONFIG };
  private engine: EngineState = "stopped";
  private lastBlock = 0;
  private latencyMs = 0;
  private startedAt: number | null = null;
  private candidates: TokenCandidate[] = [];
  private activities: SniperActivity[] = [];
  private positions: SniperPosition[] = [];
  private realizedPnlSol = 0;
  private totalFeesSol = 0;
  private totalTipsSol = 0;
  private winningTrades = 0;
  private completedTrades = 0;
  private dailyLossSol = 0;
  private blockedReason: string | null = null;
  private tokenSubscriptions = new Set<string>();
  private automaticSellTimers = new Map<string, NodeJS.Timeout>();
  private tipAccount: PublicKey | null = null;
  private tipAccountPromise: Promise<PublicKey> | null = null;
  private rpcPoll: NodeJS.Timeout | null = null;

  constructor() {
    this.pushActivity(
      this.keypair && this.connection
        ? activity("detection", `Live wallet ready: ${shorten(this.keypair.publicKey.toBase58())}`)
        : activity("error", "Live wallet is not configured. Add SOLANA_RPC_URL and SOLANA_PRIVATE_KEY."),
    );
  }

  getConfig(): SniperConfig {
    return { ...this.config, blocklist: [...this.config.blocklist] };
  }

  updateConfig(next: SniperConfig): SniperConfig {
    this.config = { ...next, blocklist: [...next.blocklist] };
    this.pushActivity(activity("detection", "Live filter and execution configuration updated"));
    return this.getConfig();
  }

  getStatus(): SniperStatus {
    const wallet = this.keypair ? "configured" : process.env.SOLANA_PRIVATE_KEY ? "invalid" : "missing";
    const rpc = this.connection ? "connected" : "disconnected";
    const engine = wallet === "configured" && rpc === "connected" ? this.engine : "blocked";
    return {
      mode: "live",
      engine,
      rpc,
      wallet,
      walletAddress: this.keypair?.publicKey.toBase58() ?? null,
      lastBlock: this.lastBlock,
      latencyMs: this.latencyMs,
      message:
        engine === "armed"
          ? "Live execution is armed. New eligible tokens may trigger real transactions."
          : engine === "blocked"
            ? this.blockedReason ?? "Live execution is blocked until the RPC and wallet are valid."
            : "Live execution is stopped. Arm it to submit real transactions.",
    };
  }

  getCandidates(filters: {
    minMarketCap: number;
    maxMarketCap: number;
    requireSocials: boolean;
    minSocialScore: number;
    limit: number;
  }): TokenCandidate[] {
    return this.candidates
      .filter(
        (candidate) =>
          candidate.marketCap >= filters.minMarketCap &&
          candidate.marketCap <= filters.maxMarketCap &&
          (!filters.requireSocials || candidate.socials.length > 0) &&
          candidate.socialScore >= filters.minSocialScore,
      )
      .slice(0, filters.limit);
  }

  getActivities(limit: number): SniperActivity[] {
    return this.activities.slice(0, limit);
  }

  getPositions(): SniperPosition[] {
    return this.positions.slice();
  }

  async getMetrics(): Promise<SniperMetrics> {
    let walletBalanceSol = 0;
    if (this.connection && this.keypair) {
      try {
        walletBalanceSol = (await this.connection.getBalance(this.keypair.publicKey)) / LAMPORTS_PER_SOL;
      } catch (error) {
        logger.warn({ err: error }, "Unable to read wallet balance");
      }
    }
    const unrealizedPnlSol = this.positions.reduce((sum, position) => sum + position.pnlSol, 0);
    return {
      walletBalanceSol,
      realizedPnlSol: this.realizedPnlSol,
      unrealizedPnlSol,
      totalFeesSol: this.totalFeesSol,
      totalTipsSol: this.totalTipsSol,
      winRate: this.completedTrades ? (this.winningTrades / this.completedTrades) * 100 : 0,
      trades: this.completedTrades,
      blocksToEntry: 1,
      uptimeSeconds: this.startedAt ? Math.floor((Date.now() - this.startedAt) / 1000) : 0,
    };
  }

  async arm(acknowledgeLiveTrading: boolean, acknowledgeRisk: boolean): Promise<SniperStatus> {
    if (!acknowledgeLiveTrading || !acknowledgeRisk) {
      throw new Error("Both live trading and risk acknowledgements are required");
    }
    if (!this.keypair || !this.connection) {
      this.engine = "blocked";
      this.blockedReason = "Live execution is blocked until the RPC and wallet are valid.";
      return this.getStatus();
    }
    if (this.config.maxDailyLossSol > 0 && this.dailyLossSol >= this.config.maxDailyLossSol) {
      this.engine = "blocked";
      this.blockedReason = "Live execution is blocked because the daily loss limit has been reached.";
      throw new Error("Daily loss limit has already been reached");
    }
    this.engine = "armed";
    this.blockedReason = null;
    this.startedAt ??= Date.now();
    this.connectStream();
    this.startRpcPoll();
    void this.getTipAccount().catch((error) => {
      logger.warn({ err: error }, "Unable to prefetch Jito tip account");
    });
    this.pushActivity(activity("detection", "Live engine armed; scanning new pump.fun token creation events"));
    return this.getStatus();
  }

  stop(): SniperStatus {
    this.engine = "stopped";
    this.socket?.close();
    this.socket = null;
    if (this.rpcPoll) clearInterval(this.rpcPoll);
    this.rpcPoll = null;
    this.pushActivity(activity("stop", "Live engine stopped; no new entries will be submitted"));
    return this.getStatus();
  }

  async sellPosition(positionId: string, percentage: number): Promise<SniperActivity> {
    const position = this.positions.find((item) => item.id === positionId);
    if (!position || position.state === "closed") {
      throw new Error("Position is not open");
    }
    if (!this.keypair || !this.connection) {
      throw new Error("Live wallet or RPC is not configured");
    }
    const automaticSellTimer = this.automaticSellTimers.get(positionId);
    if (automaticSellTimer) {
      clearTimeout(automaticSellTimer);
      this.automaticSellTimers.delete(positionId);
    }
    position.state = "selling";
    const result = await this.executeTrade("sell", position.mint, percentage >= 100 ? "100%" : `${percentage}%`, false);
    if (result.status === "confirmed") {
      position.state = percentage >= 100 ? "closed" : "open";
      if (percentage >= 100) {
        this.completedTrades += 1;
        this.realizedPnlSol += position.pnlSol;
        if (position.pnlSol > 0) this.winningTrades += 1;
        await this.closeAtaIfEmpty(position.mint);
      }
    } else {
      position.state = "open";
    }
    return result;
  }

  private connectStream(): void {
    if (this.socket || this.engine !== "armed") return;
    this.socket = new WebSocket("wss://pumpportal.fun/api/data");
    this.socket.on("open", () => {
      this.socket?.send(JSON.stringify({ method: "subscribeNewToken" }));
      this.pushActivity(activity("detection", "PumpPortal creation stream connected"));
    });
    this.socket.on("message", (raw) => {
      void this.handlePumpEvent(JSON.parse(raw.toString()) as PumpEvent);
    });
    this.socket.on("error", (error) => {
      logger.warn({ err: error }, "PumpPortal stream error");
      this.pushActivity(activity("error", "PumpPortal stream error; reconnecting"));
    });
    this.socket.on("close", () => {
      this.socket = null;
      if (this.engine === "armed") {
        setTimeout(() => this.connectStream(), 1_000);
      }
    });
  }

  private startRpcPoll(): void {
    if (this.rpcPoll || !this.connection) return;
    const poll = async () => {
      const started = Date.now();
      try {
        this.lastBlock = await this.connection!.getSlot("processed");
        this.latencyMs = Date.now() - started;
      } catch (error) {
        logger.warn({ err: error }, "RPC block poll failed");
      }
    };
    void poll();
    this.rpcPoll = setInterval(() => void poll(), 2_000);
  }

  private async handlePumpEvent(event: PumpEvent): Promise<void> {
    if (event.txType === "create" && event.mint) {
      await this.handleNewToken(event);
      return;
    }
    if ((event.txType === "buy" || event.txType === "sell") && event.mint) {
      const position = this.positions.find((item) => item.mint === event.mint && item.state === "open");
      if (position && event.txType === "buy" && this.config.sellOnFirstBuyer) {
        position.currentPrice = Math.max(position.currentPrice, this.priceFromEvent(event));
        position.pnlSol = position.amountSol * ((position.currentPrice - position.entryPrice) / Math.max(position.entryPrice, 0.00000001));
        this.queueAutomaticSell(position, "first buyer detected");
      }
    }
  }

  private async handleNewToken(event: PumpEvent): Promise<void> {
    if (!event.mint || this.candidates.some((candidate) => candidate.mint === event.mint)) return;
    const metadata = await this.readMetadata(event.uri);
    const socials = [metadata.twitter, metadata.telegram, metadata.website].filter(
      (value): value is string => Boolean(value),
    );
    const marketCap = toNumber(event.marketCapSol);
    const liquidity = toNumber(event.vSolInBondingCurve) || marketCap;
    const socialScore = Math.min(100, socials.length * 28 + (metadata.description ? 12 : 0));
    const riskFlags = this.riskFlags(event, metadata, liquidity);
    const candidate: TokenCandidate = {
      mint: event.mint,
      name: event.name ?? "Unknown token",
      symbol: event.symbol ?? "???",
      imageUrl: metadata.image ?? null,
      createdAt: new Date(),
      marketCap,
      liquidity,
      socialScore,
      socials,
      riskFlags,
      status: "scanning",
      firstBuyerAt: null,
      creator: event.traderPublicKey ?? "unknown",
    };
    this.candidates.unshift(candidate);
    this.candidates = this.candidates.slice(0, 100);
    this.pushActivity(activity("detection", `New ${candidate.symbol} creation detected at ${marketCap.toFixed(2)} SOL MC`, { mint: candidate.mint }));
    const eligible =
      this.engine === "armed" &&
      marketCap >= this.config.minMarketCap &&
      marketCap <= this.config.maxMarketCap &&
      liquidity >= this.config.minLiquidity &&
      (!this.config.requireSocials || socials.length > 0) &&
      socialScore >= this.config.minSocialScore &&
      riskFlags.length === 0 &&
      !this.config.blocklist.some((term) =>
        `${candidate.name} ${candidate.symbol} ${candidate.mint}`.toLowerCase().includes(term.toLowerCase()),
      ) &&
      this.positions.filter((position) => position.state === "open").length < this.config.maxOpenPositions &&
       (this.config.maxDailyLossSol <= 0 || this.dailyLossSol < this.config.maxDailyLossSol);
    candidate.status = eligible ? "eligible" : "rejected";
    if (!eligible) {
      this.pushActivity(activity("filter", `Rejected ${candidate.symbol}: ${riskFlags[0] ?? "filter conditions not met"}`, { mint: candidate.mint, status: "rejected" }));
      return;
    }
    this.subscribeToToken(candidate.mint);
    candidate.status = "entered";
    const result = await this.executeTrade("buy", candidate.mint, this.config.maxPositionSol.toString(), true);
    if (result.status === "confirmed") {
      candidate.firstBuyerAt = new Date().toISOString();
      const entryPrice = this.priceFromEvent(event);
      this.positions.unshift({
        id: `${candidate.mint}-${Date.now()}`,
        mint: candidate.mint,
        symbol: candidate.symbol,
        entryPrice,
        currentPrice: entryPrice,
        amountSol: this.config.maxPositionSol,
        pnlSol: 0,
        pnlPercent: 0,
        feesSol: result.feeSol,
        tipSol: result.tipSol,
        openedAt: new Date(),
        state: "open",
      });
    } else {
      candidate.status = "rejected";
    }
  }

  private subscribeToToken(mint: string): void {
    if (this.tokenSubscriptions.has(mint) || !this.socket) return;
    this.tokenSubscriptions.add(mint);
    this.socket.send(JSON.stringify({ method: "subscribeTokenTrade", keys: [mint] }));
  }

  private queueAutomaticSell(position: SniperPosition, reason: string): void {
    if (this.automaticSellTimers.has(position.id)) return;
    const minimumHoldMs = Math.max(10, this.config.minimumHoldSeconds) * 1_000;
    const openedAt = position.openedAt?.getTime() ?? Date.now();
    const delayMs = Math.max(0, minimumHoldMs - (Date.now() - openedAt));
    if (delayMs > 0) {
      this.pushActivity(
        activity("sell", `${reason}; 100% sell queued until the ${Math.ceil(minimumHoldMs / 1_000)}s minimum hold elapses`, {
          mint: position.mint,
          status: "pending",
        }),
      );
    }
    const timer = setTimeout(() => {
      this.automaticSellTimers.delete(position.id);
      const currentPosition = this.positions.find((item) => item.id === position.id);
      if (!currentPosition || currentPosition.state !== "open") return;
      this.pushActivity(
        activity("sell", `Minimum hold elapsed; submitting 100% sell for ${currentPosition.symbol}`, {
          mint: currentPosition.mint,
          status: "pending",
        }),
      );
      void this.sellPosition(currentPosition.id, 100).catch((error) => {
        logger.warn({ err: error, mint: currentPosition.mint }, "Automatic sell failed");
        this.pushActivity(
          activity("error", "Automatic sell failed after the minimum hold", {
            mint: currentPosition.mint,
            status: "failed",
          }),
        );
      });
    }, delayMs);
    this.automaticSellTimers.set(position.id, timer);
  }

  private async executeTrade(
    action: "buy" | "sell",
    mint: string,
    amount: string,
    createPosition: boolean,
  ): Promise<SniperActivity> {
    if (!this.connection || !this.keypair) throw new Error("Live wallet or RPC is not configured");
    const started = Date.now();
    const publicKey = this.keypair.publicKey.toBase58();
    const response = await fetch(PUMPPORTAL_TRADE_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        publicKey,
        action,
        mint,
        amount,
        denominatedInSol: action === "buy" ? "true" : "false",
        slippage: this.config.slippageBps / 100,
        priorityFee: Math.max(0.00001, this.config.jitoTipSol),
        pool: "auto",
      }),
    });
    if (!response.ok) {
      const message = `PumpPortal rejected ${action}: ${response.status} ${response.statusText}`;
      this.pushActivity(activity(action, message, { mint, status: "failed" }));
      return this.activities[0];
    }
    const txBytes = new Uint8Array(await response.arrayBuffer());
    const tradeTx = VersionedTransaction.deserialize(txBytes);
    tradeTx.sign([this.keypair]);
    const tipAccount = await this.getTipAccount();
    const tipTx = await this.createTipTransaction(tipAccount, this.config.jitoTipSol);
    const bundleId = await this.sendJitoBundle([tradeTx, tipTx]);
    const tradeSignature = tradeTx.signatures[0]
      ? bs58.encode(tradeTx.signatures[0])
      : bundleId;
    const confirmed = await Promise.race([
      this.connection.confirmTransaction(tradeSignature, "confirmed").then(() => true).catch((error) => {
        logger.warn({ err: error, tradeSignature }, "Trade bundle confirmation failed");
        return false;
      }),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 4_000)),
    ]);
    const feeSol = 0.000005;
    this.totalFeesSol += feeSol;
    this.totalTipsSol += this.config.jitoTipSol;
    const result = activity(
      action,
      `${action === "buy" ? "Buy" : "Sell"} Jito bundle ${confirmed ? "confirmed" : "submitted"} in ${Date.now() - started}ms`,
      {
      mint,
      signature: tradeSignature,
      status: confirmed ? "confirmed" : "pending",
      feeSol,
      tipSol: this.config.jitoTipSol,
      },
    );
    this.pushActivity(result);
    if (!createPosition && action === "sell") {
      this.pushActivity(activity("sell", "100% sell submitted; checking for empty ATA to close and reclaim rent", { mint }));
    }
    return result;
  }

  private async createTipTransaction(tipAccount: PublicKey, tipSol: number): Promise<VersionedTransaction> {
    const { blockhash } = await this.connection!.getLatestBlockhash("processed");
    const message = new TransactionMessage({
      payerKey: this.keypair!.publicKey,
      recentBlockhash: blockhash,
      instructions: [
        SystemProgram.transfer({
          fromPubkey: this.keypair!.publicKey,
          toPubkey: tipAccount,
          lamports: Math.max(1, Math.round(tipSol * LAMPORTS_PER_SOL)),
        }),
      ],
    }).compileToV0Message();
    const transaction = new VersionedTransaction(message);
    transaction.sign([this.keypair!]);
    return transaction;
  }

  private async sendJitoBundle(transactions: VersionedTransaction[]): Promise<string> {
    const encoded = transactions.map((transaction) =>
      Buffer.from(transaction.serialize()).toString("base64"),
    );
    const response = await fetch(JITO_BUNDLE_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "sendBundle",
        params: [encoded, { encoding: "base64" }],
      }),
    });
    if (!response.ok) throw new Error(`Jito bundle rejected: ${response.status}`);
    const payload = (await response.json()) as { result?: string; error?: { message?: string } };
    if (!payload.result) throw new Error(payload.error?.message ?? "Jito did not return a bundle id");
    return payload.result;
  }

  private async getTipAccount(): Promise<PublicKey> {
    if (this.tipAccount) return this.tipAccount;
    if (this.tipAccountPromise) return this.tipAccountPromise;
    this.tipAccountPromise = (async () => {
      const response = await fetch(JITO_BUNDLE_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTipAccounts", params: [] }),
      });
      if (!response.ok) throw new Error(`Jito tip account request failed: ${response.status}`);
      const payload = (await response.json()) as { result?: string[] };
      const account = payload.result?.[Math.floor(Math.random() * (payload.result?.length ?? 1))];
      if (!account) throw new Error("Jito returned no tip accounts");
      this.tipAccount = new PublicKey(account);
      return this.tipAccount;
    })();
    try {
      return await this.tipAccountPromise;
    } finally {
      this.tipAccountPromise = null;
    }
  }

  private async closeAtaIfEmpty(mint: string): Promise<void> {
    if (!this.connection || !this.keypair) return;
    try {
      const mintKey = new PublicKey(mint);
      const ataCandidates = [
        {
          ata: getAssociatedTokenAddressSync(
            mintKey,
            this.keypair.publicKey,
            false,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID,
          ),
          tokenProgram: TOKEN_PROGRAM_ID,
        },
        {
          ata: getAssociatedTokenAddressSync(
            mintKey,
            this.keypair.publicKey,
            false,
            TOKEN_2022_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID,
          ),
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        },
      ];
      const candidate = (
        await Promise.all(
          ataCandidates.map(async (item) => ({
            ...item,
            info: await this.connection!.getAccountInfo(item.ata),
          })),
        )
      ).find((item) => item.info);
      if (!candidate) return;
      const ata = candidate.ata;
      const info = candidate.info!;
      const balance = await this.connection.getTokenAccountBalance(ata);
      if (balance.value.uiAmount !== 0) {
        this.pushActivity(activity("error", "ATA still holds token dust; rent was not reclaimed", { mint }));
        return;
      }
      const tokenProgram = info.owner.equals(TOKEN_2022_PROGRAM_ID)
        ? TOKEN_2022_PROGRAM_ID
        : candidate.tokenProgram;
      const { blockhash } = await this.connection.getLatestBlockhash("processed");
      const cleanup = new VersionedTransaction(
        new TransactionMessage({
          payerKey: this.keypair.publicKey,
          recentBlockhash: blockhash,
          instructions: [
            createCloseAccountInstruction(ata, this.keypair.publicKey, this.keypair.publicKey, [], tokenProgram),
          ],
        }).compileToV0Message(),
      );
      cleanup.sign([this.keypair]);
      const tip = await this.getTipAccount();
      const tipTx = await this.createTipTransaction(tip, this.config.jitoTipSol);
      const bundleId = await this.sendJitoBundle([cleanup, tipTx]);
      this.totalTipsSol += this.config.jitoTipSol;
      this.pushActivity(activity("sell", "Closed empty ATA and reclaimed rent in a Jito bundle", {
        mint,
        signature: bundleId,
        tipSol: this.config.jitoTipSol,
      }));
    } catch (error) {
      logger.warn({ err: error, mint }, "ATA cleanup failed");
      this.pushActivity(activity("error", "ATA cleanup failed after full sell; token sale remains complete", { mint, status: "failed" }));
    }
  }

  private riskFlags(event: PumpEvent, metadata: Record<string, string>, liquidity: number): string[] {
    const flags: string[] = [];
    if (liquidity < this.config.minLiquidity) flags.push("low liquidity");
    if (!event.traderPublicKey) flags.push("creator missing");
    if (!metadata.twitter && !metadata.telegram && !metadata.website) flags.push("no socials");
    if (event.name && /test|rug|scam|elon|moon/i.test(event.name)) flags.push("blocked name");
    return flags;
  }

  private async readMetadata(uri?: string): Promise<Record<string, string>> {
    if (!uri) return {};
    try {
      const response = await fetch(uri, { signal: AbortSignal.timeout(1_500) });
      if (!response.ok) return {};
      const payload = (await response.json()) as Record<string, unknown>;
      return Object.fromEntries(
        Object.entries(payload).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      );
    } catch {
      return {};
    }
  }

  private priceFromEvent(event: PumpEvent): number {
    const sol = toNumber(event.solAmount, toNumber(event.marketCapSol, 1));
    const tokens = toNumber(event.tokenAmount, toNumber(event.initialBuy, 1));
    return sol / Math.max(tokens, 1);
  }

  private pushActivity(entry: SniperActivity): void {
    this.activities.unshift(entry);
    this.activities = this.activities.slice(0, 150);
  }
}

export const sniper = new LiveSniper();