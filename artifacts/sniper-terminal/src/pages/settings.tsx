import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CircleHelp,
  Gauge,
  Info,
  ListFilter,
  LockKeyhole,
  Save,
  ShieldAlert,
  SlidersHorizontal,
  Target,
  Zap,
} from 'lucide-react';
import {
  getGetSniperConfigQueryKey,
  getGetSniperStatusQueryKey,
  useGetSniperConfig,
  useGetSniperStatus,
  useUpdateSniperConfig,
} from '@workspace/api-client-react';
import type { SniperConfig } from '@workspace/api-client-react';

function Field({ label, hint, value, onChange, suffix, type = 'number', min = 0, step = 'any', testId }: { label: string; hint?: string; value: string | number; onChange: (value: string) => void; suffix?: string; type?: string; min?: number; step?: string; testId: string }) {
  return <label className="block">
    <span className="mb-1.5 flex items-center justify-between gap-2 text-[10px] font-bold uppercase tracking-[.14em] text-muted-foreground"><span>{label}</span>{hint && <span className="normal-case tracking-normal text-muted-foreground/70">{hint}</span>}</span>
    <span className="relative block">
      <input value={value} onChange={(event) => onChange(event.target.value)} type={type} min={min} step={step} className="mono h-10 w-full rounded-sm border border-input bg-background px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary/30" data-testid={testId} />
      {suffix && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{suffix}</span>}
    </span>
  </label>;
}

function Toggle({ label, detail, checked, onChange, testId }: { label: string; detail: string; checked: boolean; onChange: (value: boolean) => void; testId: string }) {
  return <label className="flex cursor-pointer items-center justify-between gap-5 rounded-sm border border-border bg-background/40 px-3 py-3 transition-colors hover:border-primary/30">
    <span><span className="block text-xs font-bold text-foreground">{label}</span><span className="mt-1 block text-[10px] leading-4 text-muted-foreground">{detail}</span></span>
    <span className={`relative h-5 w-9 shrink-0 rounded-full border transition-colors ${checked ? 'border-primary/50 bg-primary/25' : 'border-border bg-muted'}`}>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="sr-only" data-testid={testId} />
      <span className={`absolute top-0.5 h-3.5 w-3.5 rounded-full transition-transform ${checked ? 'translate-x-[17px] bg-primary' : 'translate-x-0.5 bg-muted-foreground'}`} />
    </span>
  </label>;
}

function SettingsPanel({ title, eyebrow, icon: Icon, children }: { title: string; eyebrow: string; icon: typeof Gauge; children: ReactNode }) {
  return <section className="panel overflow-hidden rounded-sm">
    <div className="panel-header flex items-center gap-3 px-4 py-3"><div className="flex h-8 w-8 items-center justify-center rounded-sm border border-secondary/25 bg-secondary/10 text-secondary"><Icon size={15} /></div><div><p className="mono text-[9px] uppercase tracking-[.18em] text-muted-foreground">{eyebrow}</p><h2 className="mt-0.5 text-[13px] font-extrabold uppercase tracking-[.13em]">{title}</h2></div></div>
    <div className="space-y-4 p-4">{children}</div>
  </section>;
}

function SettingsLoading() {
  return <div className="space-y-4" data-testid="settings-loading"><div className="loading-bar h-28 rounded-sm" /><div className="grid gap-4 md:grid-cols-2"><div className="loading-bar h-64 rounded-sm" /><div className="loading-bar h-64 rounded-sm" /></div></div>;
}

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const statusQuery = useGetSniperStatus({ query: { queryKey: getGetSniperStatusQueryKey(), refetchInterval: 4000 } });
  const configQuery = useGetSniperConfig({ query: { queryKey: getGetSniperConfigQueryKey() } });
  const updateConfig = useUpdateSniperConfig();
  const [form, setForm] = useState<SniperConfig>();
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (configQuery.data) setForm(configQuery.data);
  }, [configQuery.data]);
  const set = (key: keyof SniperConfig, value: string | number | boolean | string[]) => setForm((current) => current ? { ...current, [key]: value } : current);
  const save = () => {
    if (!form) return;
    updateConfig.mutate({
      data: {
        minMarketCap: Number(form.minMarketCap),
        maxMarketCap: Number(form.maxMarketCap),
        minLiquidity: Number(form.minLiquidity),
        requireSocials: Boolean(form.requireSocials),
        minSocialScore: Number(form.minSocialScore),
        maxPositionSol: Number(form.maxPositionSol),
        maxOpenPositions: Number(form.maxOpenPositions),
        takeProfitPercent: Number(form.takeProfitPercent),
        stopLossPercent: Number(form.stopLossPercent),
        jitoTipSol: Number(form.jitoTipSol),
        slippageBps: Number(form.slippageBps),
        sellOnFirstBuyer: Boolean(form.sellOnFirstBuyer),
        maxDailyLossSol: Number(form.maxDailyLossSol ?? 0),
        blocklist: form.blocklist ?? [],
      },
    }, {
      onSuccess: (next) => {
        setForm(next);
        setSaved(true);
        window.setTimeout(() => setSaved(false), 2600);
        void queryClient.invalidateQueries({ queryKey: getGetSniperConfigQueryKey() });
      },
    });
  };

  return <div className="scanline terminal-grid min-h-[100dvh] bg-background text-foreground">
    <header className="sticky top-0 z-20 border-b border-border bg-sidebar/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-[1680px] items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-sm border border-primary/35 bg-primary/10 text-primary"><SlidersHorizontal size={18} /></div><div><p className="text-sm font-extrabold tracking-[.12em]">MINT//WATCH</p><p className="mono text-[9px] uppercase tracking-[.14em] text-muted-foreground">execution configuration</p></div></div>
        <div className="flex items-center gap-3"><span className={`hidden items-center gap-2 text-[10px] uppercase tracking-[.15em] sm:flex ${statusQuery.data?.engine === 'armed' ? 'text-primary' : 'text-accent'}`}><span className={`h-1.5 w-1.5 rounded-full ${statusQuery.data?.engine === 'armed' ? 'bg-primary live-pulse' : 'bg-accent'}`} />{statusQuery.data?.engine ?? 'loading'}</span><Link href="/" className="flex items-center gap-2 rounded-sm border border-border bg-card px-3 py-2 text-[10px] font-bold uppercase tracking-[.13em] text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary" data-testid="link-back-terminal"><ArrowLeft size={13} />terminal</Link></div>
      </div>
    </header>
    <main className="mx-auto max-w-[1220px] p-4 sm:p-6">
      <div className="fade-up mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="mono mb-2 text-[10px] uppercase tracking-[.24em] text-primary">risk desk / 05</p><h1 className="text-2xl font-extrabold tracking-[-.04em] sm:text-3xl">Execution configuration</h1><p className="mt-1 max-w-xl text-xs leading-5 text-muted-foreground">These values gate live entries. Changes apply to the next detection cycle; existing positions are not rewritten.</p></div><div className="flex items-center gap-2 rounded-sm border border-accent/25 bg-accent/10 px-3 py-2 text-[10px] text-accent"><LockKeyhole size={13} /> live-only controls</div></div>
      {statusQuery.data?.engine === 'armed' && <div className="mb-5 flex items-center gap-3 rounded-sm border border-destructive/35 bg-destructive/10 px-4 py-3 text-xs text-destructive" data-testid="settings-live-warning"><AlertTriangle size={15} /><span>Engine is armed. Configuration updates can change the next live transaction.</span></div>}
      {!configQuery.isLoading && (configQuery.isError || !form) && configQuery.isError ? <div className="panel flex min-h-40 flex-col items-center justify-center gap-2 rounded-sm text-center"><AlertTriangle size={18} className="text-destructive" /><p className="text-sm font-bold">Configuration unavailable</p><button onClick={() => void configQuery.refetch()} className="text-[10px] font-bold uppercase tracking-widest underline underline-offset-4" data-testid="button-retry-config">retry query</button></div> : configQuery.isLoading || !form ? <SettingsLoading /> : <div className="fade-up space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <SettingsPanel title="Discovery filters" eyebrow="01 / candidate gate" icon={ListFilter}>
            <div className="grid gap-4 sm:grid-cols-2"><Field label="Minimum market cap" value={form.minMarketCap} onChange={(value) => set('minMarketCap', Number(value))} suffix="SOL" testId="input-min-market-cap" /><Field label="Maximum market cap" value={form.maxMarketCap} onChange={(value) => set('maxMarketCap', Number(value))} suffix="SOL" testId="input-max-market-cap" /><Field label="Minimum liquidity" value={form.minLiquidity} onChange={(value) => set('minLiquidity', Number(value))} suffix="SOL" testId="input-min-liquidity" /><Field label="Minimum social score" value={form.minSocialScore} onChange={(value) => set('minSocialScore', Number(value))} suffix="/ 100" testId="input-min-social-score" /></div>
            <Toggle label="Require social presence" detail="Reject mints without a detected social profile." checked={form.requireSocials} onChange={(value) => set('requireSocials', value)} testId="toggle-require-socials" />
            <div className="rounded-sm border border-border bg-muted/35 p-3 text-[10px] leading-5 text-muted-foreground"><Info size={13} className="mr-1 inline text-secondary" />Candidates outside this band are rejected before they can reach the execution queue.</div>
          </SettingsPanel>
          <SettingsPanel title="Execution limits" eyebrow="02 / position sizing" icon={Target}>
            <div className="grid gap-4 sm:grid-cols-2"><Field label="Max position" value={form.maxPositionSol} onChange={(value) => set('maxPositionSol', Number(value))} suffix="SOL" testId="input-max-position" /><Field label="Max open positions" value={form.maxOpenPositions} onChange={(value) => set('maxOpenPositions', Number(value))} suffix="slots" testId="input-max-open" min={1} step="1" /><Field label="Take profit" value={form.takeProfitPercent} onChange={(value) => set('takeProfitPercent', Number(value))} suffix="%" testId="input-take-profit" /><Field label="Stop loss" value={form.stopLossPercent} onChange={(value) => set('stopLossPercent', Number(value))} suffix="%" testId="input-stop-loss" /></div>
            <Toggle label="Sell on first buyer" detail="Exit the position when a first-buyer event is detected." checked={form.sellOnFirstBuyer} onChange={(value) => set('sellOnFirstBuyer', value)} testId="toggle-sell-first-buyer" />
            <div className="rounded-sm border border-accent/20 bg-accent/5 p-3 text-[10px] leading-5 text-muted-foreground"><CircleHelp size={13} className="mr-1 inline text-accent" />A stop-loss is a floor, not a guarantee. On-chain price movement can jump across it.</div>
          </SettingsPanel>
          <SettingsPanel title="Priority & slippage" eyebrow="03 / transaction path" icon={Zap}>
            <div className="grid gap-4 sm:grid-cols-2"><Field label="Jito tip" value={form.jitoTipSol} onChange={(value) => set('jitoTipSol', Number(value))} suffix="SOL" testId="input-jito-tip" /><Field label="Slippage tolerance" value={form.slippageBps} onChange={(value) => set('slippageBps', Number(value))} suffix="bps" testId="input-slippage" min={1} step="1" /></div>
            <div className="flex items-center gap-3 rounded-sm border border-secondary/20 bg-secondary/5 p-3"><Gauge size={15} className="shrink-0 text-secondary" /><p className="text-[10px] leading-5 text-muted-foreground">Priority route is active. Higher tips may improve inclusion but increase cost per execution.</p></div>
          </SettingsPanel>
          <SettingsPanel title="Loss guard & blocklist" eyebrow="04 / hard stops" icon={ShieldAlert}>
            <Field label="Maximum daily loss" value={form.maxDailyLossSol ?? 0} onChange={(value) => set('maxDailyLossSol', Number(value))} suffix="SOL" testId="input-max-daily-loss" />
            <label className="block"><span className="mb-1.5 flex items-center justify-between text-[10px] font-bold uppercase tracking-[.14em] text-muted-foreground"><span>Blocklist</span><span className="normal-case tracking-normal text-muted-foreground/70">one mint per line</span></span><textarea value={(form.blocklist ?? []).join('\n')} onChange={(event) => set('blocklist', event.target.value.split('\n').map((line) => line.trim()).filter(Boolean))} rows={4} className="mono w-full resize-none rounded-sm border border-input bg-background px-3 py-2 text-[11px] text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/30" placeholder="Mint addresses to reject" data-testid="textarea-blocklist" /></label>
            <div className="rounded-sm border border-destructive/20 bg-destructive/5 p-3 text-[10px] leading-5 text-muted-foreground"><AlertTriangle size={13} className="mr-1 inline text-destructive" />Daily loss guard stops new entries when realized loss reaches the threshold.</div>
          </SettingsPanel>
        </div>
        <div className="sticky bottom-3 z-10 flex flex-col gap-3 rounded-sm border border-border bg-sidebar/95 p-3 shadow-lg backdrop-blur sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-2 text-[10px] text-muted-foreground"><span className="h-1.5 w-1.5 rounded-full bg-accent" />Changes are local until saved to the live engine.</div><div className="flex items-center gap-3"><span className={`text-[10px] font-bold uppercase tracking-wider text-primary transition-opacity ${saved ? 'opacity-100' : 'opacity-0'}`}><Check size={13} className="mr-1 inline" />saved</span><button onClick={save} disabled={updateConfig.isPending} className="flex items-center justify-center gap-2 rounded-sm bg-primary px-4 py-2.5 text-[10px] font-extrabold uppercase tracking-[.13em] text-primary-foreground transition-transform hover:translate-y-[-1px] disabled:opacity-50" data-testid="button-save-config"><Save size={13} />{updateConfig.isPending ? 'saving…' : 'save live config'}</button></div></div>
      </div>}
    </main>
  </div>;
}