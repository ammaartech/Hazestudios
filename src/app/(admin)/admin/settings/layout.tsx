import { SettingsNav } from "./settings-nav";
import { SettingsTitle } from "./settings-title";

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-6 md:grid-cols-[220px_1fr]">
      <SettingsNav />
      <div className="min-w-0">
        {/* Lives in the layout rather than in each pane so every settings page
            gets a heading without eighteen pages having to remember to. */}
        <SettingsTitle />
        {children}
      </div>
    </div>
  );
}
