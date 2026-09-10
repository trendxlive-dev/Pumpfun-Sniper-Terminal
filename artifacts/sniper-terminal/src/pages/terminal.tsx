import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  BellRing,
  Blocks,
  Check,
  ChevronRight,
  CircleStop,
  Clock3,
  ExternalLink,
  Gauge,
  GitCommitHorizontal,
  LayoutDashboard,
  Link2,
  LockKeyhole,
  Radio,
  RefreshCw,
  Rocket,
  Settings2,
  ShieldAlert,
  Sparkles,
  TerminalSquare,
  TriangleAlert,
  WalletCards,
  Wifi,
  Zap,
} from 'lucide-react';
import {
  getGetSniperMetricsQueryKey,
  getGetSniperStatusQueryKey,
  getListSniperActivityQueryKey,
  getListSniperPositionsQueryKey,
  getListTokenCandidatesQueryKey,
  useArmSniperEngine,
  useGetSniperMetrics,
  useGetSniperStatus,
  useListSniperActivity,
  useListSniperPositions,
  useListTokenCandidates,
  useSellSniperPosition,
  useStopSniperEngine,
} from '@workspace/api-client-react';
import type {
  SniperActivity,
  SniperMetrics,
  SniperPosition,
  SniperStatus,
  TokenCandidate,
} from '@workspace/api-client-react';

const ACCENT = '#53e0aa';

function compactAddress(value?: string | null) {
  if (!value) return 'not configured';
  return `${value.slice(0, 5)}…${value.slice(-4)}`;
}

function formatSol(value = 0) {
  return `${value >= 0 ? '' : '−'}${Math.abs(value).toFixed(3)} SOL`;
}

function formatMarketCapSol(value = 0) {
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k SOL`;
  return `${value.toFixed(1)} SOL`;
}

function ago(value?: string) {
  if (!value) return '—';
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

function shortMint(mint?: string | null) {
  if (!mint) return '—';
  return `${mint.slice(0, 4)}…${mint.slice(-4)}`;
}

function statusTone(status?: string) {
  if (status === 'confirmed' || status === 'eligible' || status === 'armed' || status === 'open') return 'green';
  if (status === 'pending' || status === 'scanning' || status === 'selling') return 'amber';
  if (status === 'failed' || status === 'rejected' || status === 'blocked' || status === 'invalid') return 'red';
  return 'blue';
}

function ToneDot({ tone = 'blue', pulse = false }: { tone?: string; pulse?: boolean }) {
  return <span className={`inline-block h-1.5 w-1.5 rounded-full ${pulse ? 'live-pulse' : ''} ${tone === 'green' ? 'bg-primary' : tone === 'amber' ? 'bg-accent' : tone === 'red' ? 'bg-destructive' : 'bg-secondary'}`} />;
}

function Badge({ children, tone = 'blue' }: { children: ReactNode; tone?: string }) {
  const styles = tone === 'green'
    ? 'border-primary/25 bg-primary/10 text-primary'
    : tone === 'amber'
      ? 'border-accent/25 bg-accent/10 text-accent'
      : tone === 'red'
        ? 'border-destructive/25 bg-destructive/10 text-destructive'
        : 'border-secondary/25 bg-secondary/10 text-secondary';
  return <span className={`inline-flex items-center gap-1.5 rounded-sm border px-2 py-1 text-[10px] font-bold uppercase tracking-[.12em] ${styles}`}><ToneDot tone={tone} />{children}</span>;
}

function Panel({ title, eyebrow, action, children, className = '' }: { title: string; eyebrow?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`panel overflow-hidden rounded-sm ${className}`}>
      <div className="panel-header flex min-h-12 items-center justify-between gap-3 px-4 py-3">
        <div>
          {eyebrow && <p className="mono mb-1 text-[9px] font-medium uppercase tracking-[.2em] text-muted-foreground">{eyebrow}</p>}
          <h2 className="text-[13px] font-extrabold uppercase tracking-[.13em] text-foreground">{title}</h2>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function QuerySkeleton({ rows = 4 }: { rows?: number }) {
  return <div className="space-y-2 p-3" data-testid="loading-skeleton">
    {Array.from({ length: rows }).map((_, index) => <div className="loading-bar h-11 rounded-sm" key={index} />)}
  </div>;
}

function EmptyState({ title, detail, icon: Icon = Radio }: { title: string; detail: string; icon?: typeof Radio }) {
  return <div className="flex min-h-48 flex-col items-center justify-center px-5 text-center" data-testid="empty-state">
    <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-sm border border-border bg-muted text-muted-foreground"><Icon size={17} /></div>
    <p className="text-sm font-bold text-foreground">{title}</p>
    <p className="mt-1 max-w-xs text-xs leading-5 text-muted-foreground">{detail}</p>
  </div>;
}

function ErrorState({ label, onRetry }: { label: string; onRetry?: () => void }) {
  return <div className="flex min-h-36 flex-col items-center justify-center gap-2 px-5 text-center" data-testid="error-state">
    <TriangleAlert size={17} className="text-destructive" />
    <p className="text-xs text-destructive">{label}</p>
    {onRetry && <button onClick={onRetry} className="text-[10px] font-bold uppercase tracking-widest text-foreground underline underline-offset-4" data-testid="button-retry">retry query</button>}
  </div>;
}

function Shell({ status, children }: { status?: SniperStatus; children: ReactNode }) {
  const engineTone = status?.engine === 'armed' ? 'green' : status?.engine === 'blocked' ? 'red' : 'amber';
  return (
    <div className="scanline terminal-grid min-h-[100dvh] bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b border-border bg-sidebar/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1680px] items-center justify-between gap-5 px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-sm border border-primary/35 bg-primary/10 text-primary"><TerminalSquare size={18} /></div>
            <div>
              <div className="flex items-center gap-2">
                <p className="text-sm font-extrabold tracking-[.12em] text-foreground">MINT//WATCH</p>
                <span className="rounded-sm border border-secondary/25 bg-secondary/10 px-1.5 py-0.5 text-[8px] font-bold tracking-[.16em] text-secondary">SOLANA</span>
              </div>
              <p className="mono mt-0.5 text-[9px] uppercase tracking-[.14em] text-muted-foreground">live execution terminal</p>
            </div>
          </div>
          <div className="hidden items-center gap-5 text-[10px] uppercase tracking-[.15em] text-muted-foreground md:flex">
            <div className="flex items-center gap-2"><ToneDot tone={status?.rpc === 'connected' ? 'green' : 'red'} pulse={status?.rpc === 'connected'} /><span>rpc {status?.rpc ?? 'connecting'}</span></div>
            <div className="flex items-center gap-2"><Blocks size={13} className="text-muted-foreground" /><span className="mono">block {status?.lastBlock?.toLocaleString() ?? '—'}</span></div>
            <div className="flex items-center gap-2"><Gauge size={13} className="text-muted-foreground" /><span className="mono">{status?.latencyMs ?? '—'}ms</span></div>
          </div>
          <div className="flex items-center gap-2">
            <Badge tone={engineTone}>{status?.engine ?? 'loading'}</Badge>
            <Link href="/settings" className="flex h-8 w-8 items-center justify-center rounded-sm border border-border bg-card text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary" data-testid="link-settings"><Settings2 size={15} /></Link>
          </div>
        </div>
      </header>
      <div className="mx-auto grid max-w-[1680px] grid-cols-1 lg:grid-cols-[208px_minmax(0,1fr)]">
        <aside className="hidden min-h-[calc(100dvh-4rem)] border-r border-border bg-sidebar/80 p-3 lg:block">
          <p className="mono mb-3 px-2 pt-2 text-[9px] uppercase tracking-[.2em] text-muted-foreground">workspace</p>
          <nav className="space-y-1">
            <Link href="/" className="flex items-center gap-3 rounded-sm border border-primary/20 bg-primary/10 px-3 py-2.5 text-xs font-bold text-primary" data-testid="link-overview"><LayoutDashboard size={15} />Overview</Link>
            <Link href="/settings" className="flex items-center gap-3 rounded-sm px-3 py-2.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" data-testid="link-config"><Settings2 size={15} />Execution config</Link>
          </nav>
          <div className="mt-8 border-t border-border pt-5">
            <p className="mono mb-3 px-2 text-[9px] uppercase tracking-[.2em] text-muted-foreground">live-only policy</p>
            <div className="space-y-3 px-2 text-[11px] leading-5 text-muted-foreground">
              <div className="flex gap-2"><LockKeyhole size={13} className="mt-0.5 shrink-0 text-primary" /><span>No paper execution</span></div>
              <div className="flex gap-2"><ShieldAlert size={13} className="mt-0.5 shrink-0 text-accent" /><span>Every entry respects current risk limits</span></div>
              <div className="flex gap-2"><Wifi size={13} className="mt-0.5 shrink-0 text-secondary" /><span>RPC health gates execution</span></div>
            </div>
          </div>
          <div className="mt-auto pt-10">
            <div className="rounded-sm border border-border bg-card/70 p-3">
              <p className="mono text-[9px] uppercase tracking-[.15em] text-muted-foreground">connected wallet</p>
              <p className="mono mt-2 truncate text-[11px] text-foreground" data-testid="text-wallet-address">{compactAddress(status?.walletAddress)}</p>
              <p className="mt-1 text-[10px] text-muted-foreground">{status?.wallet === 'configured' ? 'signer ready' : status?.wallet ?? 'checking signer'}</p>
            </div>
          </div>
        </aside>
        <main className="min-w-0 p-3 sm:p-5 xl:p-6">{children}</main>
      </div>
    </div>
  );
}

function StatusBanner({ status, onArm, onStop, armPending, stopPending }: { status?: SniperStatus; onArm: () => void; onStop: () => void; armPending: boolean; stopPending: boolean }) {
  const [ack, setAck] = useState(false);
  const blocked = status?.engine === 'blocked' || status?.rpc === 'disconnected' || status?.wallet !== 'configured';
  const armed = status?.engine === 'armed';
  return (
    <div className={`mb-4 rounded-sm border px-4 py-3 ${armed ? 'border-primary/35 bg-primary/[.07]' : blocked ? 'border-destructive/35 bg-destructive/[.07]' : 'border-accent/35 bg-accent/[.06]'}`} data-testid="status-banner">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex items-start gap-3">
          <div className={`mt-0.5 rounded-sm p-2 ${armed ? 'bg-primary/15 text-primary' : blocked ? 'bg-destructive/15 text-destructive' : 'bg-accent/15 text-accent'}`}>{armed ? <Radio size={17} /> : blocked ? <ShieldAlert size={17} /> : <AlertTriangle size={17} />}</div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-extrabold">{armed ? 'Engine armed — listening for entries' : blocked ? 'Execution blocked — operator action required' : 'Engine stopped — live execution is idle'}</p>
              <span className="mono text-[10px] text-muted-foreground">{status?.mode ?? 'live'} / {status?.message ?? 'awaiting status'}</span>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">{armed ? 'New eligible mints can trigger real SOL transactions. Monitor the feed below.' : blocked ? 'Resolve RPC or wallet health before arming the live engine.' : 'Filters are loaded. Arm only when you are ready to send live transactions.'}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 pl-11 xl:pl-0">
          {!armed && !blocked && (
            <>
              <label className="flex cursor-pointer items-center gap-2 rounded-sm border border-border bg-background/50 px-2.5 py-2 text-[10px] text-muted-foreground">
                <input type="checkbox" checked={ack} onChange={(event) => setAck(event.target.checked)} className="accent-primary" data-testid="checkbox-live-ack" />
                <span>I acknowledge live trading risk</span>
              </label>
              <button disabled={!ack || armPending} onClick={onArm} className="flex items-center gap-2 rounded-sm bg-primary px-3 py-2 text-[10px] font-extrabold uppercase tracking-[.12em] text-primary-foreground transition-transform hover:translate-y-[-1px] disabled:cursor-not-allowed disabled:opacity-40" data-testid="button-arm-engine"><Rocket size={13} />{armPending ? 'arming…' : 'arm engine'}</button>
            </>
          )}
          {armed && <button onClick={onStop} disabled={stopPending} className="flex items-center gap-2 rounded-sm border border-destructive/50 bg-destructive/10 px-3 py-2 text-[10px] font-extrabold uppercase tracking-[.12em] text-destructive transition-colors hover:bg-destructive/20 disabled:opacity-50" data-testid="button-emergency-stop"><CircleStop size={13} />{stopPending ? 'stopping…' : 'emergency stop'}</button>}
        </div>
      </div>
    </div>
  );
}

function MetricStrip({ metrics, loading }: { metrics?: SniperMetrics; loading?: boolean }) {
  const items = [
    { label: 'wallet balance', value: formatSol(metrics?.walletBalanceSol), sub: 'available', icon: WalletCards, tone: 'text-primary' },
    { label: 'realized P&L', value: formatSol(metrics?.realizedPnlSol), sub: `${metrics?.trades ?? 0} closed trades`, icon: BarChart3, tone: metrics?.realizedPnlSol && metrics.realizedPnlSol < 0 ? 'text-destructive' : 'text-primary' },
    { label: 'unrealized P&L', value: formatSol(metrics?.unrealizedPnlSol), sub: 'open exposure', icon: Activity, tone: metrics?.unrealizedPnlSol && metrics.unrealizedPnlSol < 0 ? 'text-destructive' : 'text-secondary' },
    { label: 'hit rate', value: `${(metrics?.winRate ?? 0).toFixed(1)}%`, sub: 'winning exits', icon: TargetIcon, tone: 'text-accent' },
    { label: 'execution cost', value: formatSol((metrics?.totalFeesSol ?? 0) + (metrics?.totalTipsSol ?? 0)), sub: `${(metrics?.blocksToEntry ?? 0).toFixed(1)} blocks to entry`, icon: Zap, tone: 'text-secondary' },
  ];
  return <div className="mb-4 grid grid-cols-2 gap-2 xl:grid-cols-5">{items.map((item) => {
    const Icon = item.icon;
    return <div className="panel rounded-sm p-3" key={item.label} data-testid={`metric-${item.label.replaceAll(' ', '-')}`}>
      <div className="flex items-center justify-between"><p className="text-[9px] font-bold uppercase tracking-[.15em] text-muted-foreground">{item.label}</p><Icon size={14} className={item.tone} /></div>
      {loading ? <div className="loading-bar mt-3 h-6 w-24 rounded-sm" /> : <p className={`mono mt-2 text-lg font-medium tracking-tight ${item.tone}`}>{item.value}</p>}
      <p className="mt-1 text-[10px] text-muted-foreground">{item.sub}</p>
    </div>;
  })}</div>;
}

function TargetIcon({ size, className }: { size?: number; className?: string }) {
  return <span className={className}><Sparkles size={size} /></span>;
}

function CandidateRow({ candidate }: { candidate: TokenCandidate }) {
  const tone = statusTone(candidate.status);
  const initials = candidate.symbol.slice(0, 2).toUpperCase();
  return <div className={`row-in grid grid-cols-[minmax(150px,1.7fr)_85px_85px_72px_105px] items-center gap-3 border-b border-border/70 px-4 py-3 transition-colors last:border-0 hover:bg-muted/45 ${candidate.status === 'rejected' ? 'opacity-65' : ''}`} data-testid={`row-candidate-${candidate.mint}`}>
    <div className="flex min-w-0 items-center gap-3">
      {candidate.imageUrl ? <img src={candidate.imageUrl} alt="" className="h-8 w-8 rounded-sm border border-border bg-muted object-cover" /> : <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm border border-secondary/20 bg-secondary/10 text-[10px] font-extrabold text-secondary">{initials}</div>}
      <div className="min-w-0">
        <div className="flex items-center gap-2"><p className="truncate text-xs font-extrabold text-foreground">{candidate.name}</p><span className="mono text-[9px] text-muted-foreground">${candidate.symbol}</span></div>
        <div className="mt-1 flex items-center gap-2"><span className="mono text-[9px] text-muted-foreground">{shortMint(candidate.mint)}</span><span className="text-[9px] text-muted-foreground">{ago(candidate.createdAt)}</span></div>
      </div>
    </div>
    <div><p className="mono text-xs text-foreground">{formatMarketCapSol(candidate.marketCap)}</p><p className="mt-1 text-[9px] uppercase tracking-wider text-muted-foreground">mcap</p></div>
    <div><p className="mono text-xs text-foreground">{formatMarketCapSol(candidate.liquidity)}</p><p className="mt-1 text-[9px] uppercase tracking-wider text-muted-foreground">liq</p></div>
    <div><p className={`mono text-xs ${candidate.socialScore >= 60 ? 'text-primary' : 'text-accent'}`}>{candidate.socialScore}</p><p className="mt-1 text-[9px] uppercase tracking-wider text-muted-foreground">social</p></div>
    <div className="flex justify-end"><Badge tone={tone}>{candidate.status}</Badge></div>
  </div>;
}

function CandidateFeed({ candidates, loading, error, retry }: { candidates?: TokenCandidate[]; loading: boolean; error: boolean; retry: () => void }) {
  return <Panel title="New token radar" eyebrow="01 / discovery" action={<div className="flex items-center gap-2"><span className="flex items-center gap-1.5 text-[9px] uppercase tracking-wider text-primary"><ToneDot tone="green" pulse />live stream</span><span className="rounded-sm border border-border px-2 py-1 text-[9px] text-muted-foreground">{candidates?.length ?? 0} seen</span></div>}>
    <div className="hidden grid-cols-[minmax(150px,1.7fr)_85px_85px_72px_105px] gap-3 border-b border-border bg-background/30 px-4 py-2 text-[9px] font-bold uppercase tracking-[.16em] text-muted-foreground sm:grid"><span>candidate / age</span><span>market cap</span><span>liquidity</span><span>signal</span><span className="text-right">decision</span></div>
    {loading ? <QuerySkeleton /> : error ? <ErrorState label="Candidate stream is unavailable" onRetry={retry} /> : candidates?.length ? candidates.map((candidate) => <CandidateRow candidate={candidate} key={candidate.mint} />) : <EmptyState title="No candidates in the window" detail="The radar is live, but no token has crossed your current discovery filters." icon={Radio} />}
    <div className="border-t border-border bg-background/25 px-4 py-2 text-[10px] text-muted-foreground"><span className="text-primary">◆</span> eligible candidates are evaluated against execution config before any entry.</div>
  </Panel>;
}

function PositionRow({ position, onSell, pending }: { position: SniperPosition; onSell: (id: string) => void; pending: boolean }) {
  const positive = position.pnlSol >= 0;
  return <div className="grid grid-cols-[minmax(100px,1.2fr)_90px_90px_80px_74px] items-center gap-2 border-b border-border/70 px-4 py-3 last:border-0 hover:bg-muted/40" data-testid={`row-position-${position.id}`}>
    <div><div className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-primary live-pulse" /><p className="text-xs font-extrabold">${position.symbol}</p></div><p className="mono mt-1 text-[9px] text-muted-foreground">{shortMint(position.mint)} · {ago(position.openedAt)}</p></div>
    <div><p className="mono text-xs">{formatSol(position.amountSol)}</p><p className="mt-1 text-[9px] uppercase text-muted-foreground">size</p></div>
    <div><p className={`mono text-xs ${positive ? 'text-primary' : 'text-destructive'}`}>{positive ? '+' : ''}{position.pnlPercent.toFixed(1)}%</p><p className="mt-1 text-[9px] uppercase text-muted-foreground">{formatSol(position.pnlSol)}</p></div>
    <div><Badge tone={statusTone(position.state)}>{position.state}</Badge></div>
    <div className="flex justify-end"><button onClick={() => onSell(position.id)} disabled={pending || position.state !== 'open'} className="rounded-sm border border-destructive/35 px-2 py-1.5 text-[9px] font-bold uppercase tracking-wider text-destructive transition-colors hover:bg-destructive/15 disabled:cursor-not-allowed disabled:opacity-40" data-testid={`button-sell-${position.id}`}>{pending ? 'selling…' : 'sell 100%'}</button></div>
  </div>;
}

function PositionsPanel({ positions, loading, error, retry, onSell, pendingId }: { positions?: SniperPosition[]; loading: boolean; error: boolean; retry: () => void; onSell: (id: string) => void; pendingId?: string }) {
  const open = positions?.filter((position) => position.state === 'open' || position.state === 'selling') ?? [];
  return <Panel title="Open positions" eyebrow="02 / exposure" action={<span className="mono text-[10px] text-muted-foreground">{open.length} / active</span>}>
    <div className="hidden grid-cols-[minmax(100px,1.2fr)_90px_90px_80px_74px] gap-2 border-b border-border bg-background/30 px-4 py-2 text-[9px] font-bold uppercase tracking-[.16em] text-muted-foreground sm:grid"><span>asset</span><span>size</span><span>return</span><span>state</span><span /></div>
    {loading ? <QuerySkeleton rows={3} /> : error ? <ErrorState label="Positions could not be loaded" onRetry={retry} /> : open.length ? open.map((position) => <PositionRow key={position.id} position={position} onSell={onSell} pending={pendingId === position.id} />) : <EmptyState title="No open exposure" detail="When the engine confirms an entry, the position and its live return will appear here." icon={WalletCards} />}
  </Panel>;
}

function ActivityRow({ item }: { item: SniperActivity }) {
  const icon = item.kind === 'buy' ? <ArrowDownRight size={13} /> : item.kind === 'sell' ? <ArrowUpRight size={13} /> : item.kind === 'error' ? <TriangleAlert size={13} /> : item.kind === 'filter' ? <ShieldAlert size={13} /> : <GitCommitHorizontal size={13} />;
  const tone = statusTone(item.status);
  return <div className="flex gap-3 border-b border-border/70 px-4 py-3 last:border-0" data-testid={`row-activity-${item.id}`}>
    <div className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-sm border ${tone === 'green' ? 'border-primary/25 bg-primary/10 text-primary' : tone === 'red' ? 'border-destructive/25 bg-destructive/10 text-destructive' : 'border-accent/25 bg-accent/10 text-accent'}`}>{icon}</div>
    <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-2"><p className="truncate text-[11px] font-semibold text-foreground">{item.message}</p><span className="mono shrink-0 text-[9px] text-muted-foreground">{ago(item.timestamp)}</span></div><div className="mt-1 flex items-center gap-2 text-[9px] text-muted-foreground"><Badge tone={tone}>{item.status}</Badge>{item.mint && <span className="mono">{shortMint(item.mint)}</span>}{item.signature && <a href={`https://solscan.io/tx/${item.signature}`} target="_blank" rel="noreferrer" className="text-secondary hover:underline" data-testid={`link-signature-${item.id}`}><ExternalLink size={10} /></a>}</div></div>
  </div>;
}

function ActivityPanel({ activity, loading, error, retry }: { activity?: SniperActivity[]; loading: boolean; error: boolean; retry: () => void }) {
  return <Panel title="Execution tape" eyebrow="03 / activity" action={<button onClick={retry} className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wider text-muted-foreground hover:text-primary" data-testid="button-refresh-activity"><RefreshCw size={12} />refresh</button>}>
    {loading ? <QuerySkeleton rows={5} /> : error ? <ErrorState label="Activity tape is offline" onRetry={retry} /> : activity?.length ? activity.slice(0, 7).map((item) => <ActivityRow key={item.id} item={item} />) : <EmptyState title="Tape is quiet" detail="Detections, filters, entries, exits, and errors will stream here." icon={BellRing} />}
  </Panel>;
}

export default function TerminalPage() {
  const queryClient = useQueryClient();
  const statusQuery = useGetSniperStatus({ query: { queryKey: getGetSniperStatusQueryKey(), refetchInterval: 4000 } });
  const candidatesQuery = useListTokenCandidates({ limit: 20 }, { query: { queryKey: getListTokenCandidatesQueryKey({ limit: 20 }), refetchInterval: 2500 } });
  const activityQuery = useListSniperActivity({ limit: 30 }, { query: { queryKey: getListSniperActivityQueryKey({ limit: 30 }), refetchInterval: 3500 } });
  const positionsQuery = useListSniperPositions({ query: { queryKey: getListSniperPositionsQueryKey(), refetchInterval: 2500 } });
  const metricsQuery = useGetSniperMetrics({ query: { queryKey: getGetSniperMetricsQueryKey(), refetchInterval: 5000 } });
  const arm = useArmSniperEngine();
  const stop = useStopSniperEngine();
  const sell = useSellSniperPosition();
  const [pendingSell, setPendingSell] = useState<string>();

  const invalidateLive = () => {
    void queryClient.invalidateQueries({ queryKey: getGetSniperStatusQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getListTokenCandidatesQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getListSniperActivityQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getListSniperPositionsQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getGetSniperMetricsQueryKey() });
  };
  const armEngine = () => arm.mutate({ data: { acknowledgeLiveTrading: true, acknowledgeRisk: true } }, { onSuccess: invalidateLive });
  const stopEngine = () => stop.mutate(undefined, { onSuccess: invalidateLive });
  const sellPosition = (id: string) => {
    setPendingSell(id);
    sell.mutate({ positionId: id, data: { percentage: 100 } }, { onSuccess: () => { setPendingSell(undefined); invalidateLive(); }, onError: () => setPendingSell(undefined) });
  };
  const status = statusQuery.data;
  const counts = useMemo(() => {
    const all = candidatesQuery.data ?? [];
    return { eligible: all.filter((candidate) => candidate.status === 'eligible').length, rejected: all.filter((candidate) => candidate.status === 'rejected').length };
  }, [candidatesQuery.data]);
  useEffect(() => {
    document.title = status?.engine === 'armed' ? 'MINT//WATCH — ARMED' : 'MINT//WATCH — Sniper terminal';
  }, [status?.engine]);

  return <Shell status={status}>
    <div className="fade-up">
      <div className="mb-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div><p className="mono mb-2 text-[10px] uppercase tracking-[.24em] text-primary">operator console / 00</p><h1 className="text-2xl font-extrabold tracking-[-.04em] sm:text-3xl">Live sniper terminal</h1><p className="mt-1 text-xs text-muted-foreground">New token creation, filtered at the edge. Execution is live-only.</p></div>
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground"><span className="flex items-center gap-1.5"><Clock3 size={13} />uptime {status?.lastBlock ? `${status.lastBlock.toLocaleString()} last block` : 'syncing'}</span><span className="h-1 w-1 rounded-full bg-border" /><span className="mono">{counts.eligible} actionable / {counts.rejected} rejected</span></div>
      </div>
      <StatusBanner status={status} onArm={armEngine} onStop={stopEngine} armPending={arm.isPending} stopPending={stop.isPending} />
      {status?.rpc === 'disconnected' && <div className="mb-4 flex items-center gap-3 rounded-sm border border-destructive/30 bg-destructive/10 px-4 py-3 text-xs text-destructive" data-testid="warning-rpc"><Wifi size={15} /><span>RPC disconnected. New entries are blocked until a healthy endpoint is restored.</span></div>}
      {status?.wallet !== 'configured' && <div className="mb-4 flex items-center gap-3 rounded-sm border border-accent/30 bg-accent/10 px-4 py-3 text-xs text-accent" data-testid="warning-wallet"><WalletCards size={15} /><span>Signer is {status?.wallet ?? 'unavailable'}. Configure a valid wallet before arming.</span><Link href="/settings" className="ml-auto font-bold underline underline-offset-4" data-testid="link-wallet-settings">open settings</Link></div>}
      <MetricStrip metrics={metricsQuery.data} loading={metricsQuery.isLoading} />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(390px,.8fr)]">
        <CandidateFeed candidates={candidatesQuery.data} loading={candidatesQuery.isLoading} error={!!candidatesQuery.isError} retry={() => void candidatesQuery.refetch()} />
        <PositionsPanel positions={positionsQuery.data} loading={positionsQuery.isLoading} error={!!positionsQuery.isError} retry={() => void positionsQuery.refetch()} onSell={sellPosition} pendingId={pendingSell} />
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(280px,.48fr)]">
        <ActivityPanel activity={activityQuery.data} loading={activityQuery.isLoading} error={!!activityQuery.isError} retry={() => void activityQuery.refetch()} />
        <Panel title="Session guardrails" eyebrow="04 / risk controls" action={<Link href="/settings" className="text-secondary hover:text-foreground" data-testid="link-risk-settings"><ChevronRight size={15} /></Link>}>
          <div className="space-y-1 p-4">
            <div className="flex items-center justify-between border-b border-border/70 py-2"><span className="flex items-center gap-2 text-[11px] text-muted-foreground"><LockKeyhole size={13} />Mode</span><span className="mono text-[10px] text-primary">LIVE ONLY</span></div>
            <div className="flex items-center justify-between border-b border-border/70 py-2"><span className="flex items-center gap-2 text-[11px] text-muted-foreground"><ShieldAlert size={13} />Risk gate</span><span className="mono text-[10px] text-foreground">{status?.engine === 'armed' ? 'ENFORCING' : 'STANDBY'}</span></div>
            <div className="flex items-center justify-between border-b border-border/70 py-2"><span className="flex items-center gap-2 text-[11px] text-muted-foreground"><Zap size={13} />Jito path</span><span className="mono text-[10px] text-secondary">PRIORITY</span></div>
            <div className="flex items-center justify-between py-2"><span className="flex items-center gap-2 text-[11px] text-muted-foreground"><Link2 size={13} />wallet</span><span className="mono text-[10px] text-foreground">{compactAddress(status?.walletAddress)}</span></div>
          </div>
          <div className="border-t border-border bg-background/20 p-4"><p className="text-[10px] leading-5 text-muted-foreground">Emergency stop cancels new entries. It does not liquidate open positions.</p><button onClick={stopEngine} disabled={stop.isPending || status?.engine !== 'armed'} className="mt-3 flex w-full items-center justify-center gap-2 rounded-sm border border-destructive/35 bg-destructive/10 py-2 text-[10px] font-bold uppercase tracking-[.13em] text-destructive hover:bg-destructive/20 disabled:opacity-35" data-testid="button-risk-stop"><CircleStop size={13} />stop new entries</button></div>
        </Panel>
      </div>
      <footer className="flex flex-col gap-2 py-6 text-[9px] uppercase tracking-[.16em] text-muted-foreground sm:flex-row sm:items-center sm:justify-between"><span>mint//watch terminal · live feed refreshes automatically</span><span className="mono">latency {status?.latencyMs ?? '—'}ms · slot {status?.lastBlock?.toLocaleString() ?? '—'}</span></footer>
    </div>
  </Shell>;
}