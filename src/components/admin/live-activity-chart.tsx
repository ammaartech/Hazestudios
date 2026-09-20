"use client";

import { useState, useSyncExternalStore } from "react";
import { useReducedMotion } from "motion/react";
import { Pause, Play } from "lucide-react";
import { LiveLineChart } from "@/components/charts/live-line-chart";
import { LiveLine } from "@/components/charts/live-line";
import { LiveXAxis } from "@/components/charts/live-x-axis";
import { LiveYAxis } from "@/components/charts/live-y-axis";
import { ChartTooltip } from "@/components/charts/tooltip/chart-tooltip";
import { AnalyticsTrend } from "@/components/admin/bklit-analytics";

function subscribe(callback: () => void) { document.addEventListener("visibilitychange", callback); return () => document.removeEventListener("visibilitychange", callback); }
const hidden = () => document.visibilityState !== "visible";
const serverHidden = () => true;

export function LiveActivityChart({ data }: { data: { time: number; value: number }[] }) {
  const [paused, setPaused] = useState(false);
  const [frozen, setFrozen] = useState(data);
  const reduced = useReducedMotion();
  const isHidden = useSyncExternalStore(subscribe, hidden, serverHidden);
  const shown = paused ? frozen : data;
  const staticChart = paused || isHidden || Boolean(reduced) || shown.every(point => point.value === 0);
  return <section className="analytics-panel"><header className="analytics-panel-heading"><div><h2>Visitors over time</h2><p>Observed every 10 seconds while this page is open</p></div><button className="analytics-view-toggle" type="button" onClick={() => { if (!paused) setFrozen(data); setPaused(!paused); }} aria-pressed={paused}>{paused ? <Play size={14} /> : <Pause size={14} />}{paused ? "Resume" : "Pause"}</button></header>
    {shown.length < 2 ? <p className="analytics-empty !min-h-36">Collecting visitor observations…</p> : staticChart ? <AnalyticsTrend label="Visitors" height={180} timeOnly data={shown.map(point => ({ date: new Date(point.time * 1000).toISOString(), label: new Date(point.time * 1000).toLocaleTimeString("en-IN"), value: point.value }))} /> : <div role="img" aria-label={`Live visitor history. Latest observation: ${shown.at(-1)?.value ?? 0} visitors.`}><LiveLineChart data={shown} value={shown.at(-1)?.value ?? 0} window={300} lerpSpeed={0.15} style={{ height: 180 }} margin={{ top: 12, right: 48, bottom: 30, left: 8 }}>
      <LiveLine dataKey="value" stroke="#635bdb" formatValue={value => String(Math.round(value))} />
      <LiveXAxis />
      <LiveYAxis position="right" formatValue={value => Number.isInteger(value) && value >= 0 ? String(value) : ""} />
      <ChartTooltip showDatePill={false} content={({ point }) => <div className="analytics-tooltip"><p>{new Date(point.date as Date).toLocaleTimeString("en-IN")}</p><strong>{Math.round(Number(point.value))} visitors</strong></div>} />
    </LiveLineChart></div>}
    <details className="mt-3 text-xs"><summary className="cursor-pointer text-muted-foreground">Observed values</summary><ul className="mt-2 max-h-40 overflow-auto">{shown.map(point => <li key={point.time} className="flex justify-between py-1"><span>{new Date(point.time * 1000).toLocaleTimeString("en-IN")}</span><span>{point.value} visitors</span></li>)}</ul></details>
  </section>;
}
