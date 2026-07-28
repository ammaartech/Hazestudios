import { Gem, Heart, Package } from "lucide-react";
import type { Announcement, AnnouncementIcon } from "@/lib/shop/home-content";
import { ANNOUNCEMENTS } from "@/lib/shop/home-content";

const ICONS: Record<AnnouncementIcon, typeof Package> = {
  package: Package,
  gem: Gem,
  heart: Heart,
};

function Track({ messages, "aria-hidden": hidden }: {
  messages: Announcement[];
  "aria-hidden"?: boolean;
}) {
  return (
    <div className="marquee__track" aria-hidden={hidden}>
      {messages.map(({ icon, text }, i) => {
        const Icon = ICONS[icon];
        return (
          <span key={`${text}-${i}`} className="meta flex items-center gap-2.5 whitespace-nowrap">
            <Icon className="size-3.5 shrink-0 opacity-70" aria-hidden />
            {text}
          </span>
        );
      })}
    </div>
  );
}

/**
 * The announcement marquee.
 *
 * The messages are repeated until they comfortably overflow the widest viewport
 * — a track shorter than the screen would leave a visible gap on each loop. The
 * duplicate track is hidden from assistive tech so the offers are announced once
 * rather than four times over.
 */
export function AnnouncementBar() {
  const messages = Array.from({ length: 4 }, () => ANNOUNCEMENTS).flat();

  return (
    <div className="bg-[var(--shop-ink)] py-2.5 text-white">
      <div className="marquee" style={{ ["--marquee-gap" as string]: "3rem" }}>
        <Track messages={messages} />
        <Track messages={messages} aria-hidden />
      </div>
    </div>
  );
}
