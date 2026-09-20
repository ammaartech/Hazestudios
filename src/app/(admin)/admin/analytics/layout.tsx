import "./analytics.css";

export default function AnalyticsLayout({ children }: { children: React.ReactNode }) {
  return <div className="analytics-scope contents">{children}</div>;
}
