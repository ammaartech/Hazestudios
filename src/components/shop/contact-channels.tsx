import { Mail, MessageCircle } from "lucide-react";

/**
 * Contact options.
 *
 * Email is live now. The WhatsApp tile renders only when
 * NEXT_PUBLIC_WHATSAPP_NUMBER is set, so switching it on later is one env var
 * and no code change — it is deliberately not a placeholder button that goes
 * nowhere in the meantime.
 *
 * Set it in E.164 without punctuation, e.g. 919812345678.
 */
export function ContactChannels({
  supportEmail,
  storeName,
  orderNumber,
}: {
  supportEmail: string;
  storeName: string;
  orderNumber?: string;
}) {
  const subject = orderNumber
    ? `Help with order #${orderNumber}`
    : `Help — ${storeName}`;
  const body = orderNumber
    ? `Hi ${storeName},\n\nI need help with order #${orderNumber}.\n\n`
    : `Hi ${storeName},\n\n`;

  const mailto = `mailto:${supportEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  const whatsapp = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER?.replace(/\D/g, "");
  const whatsappHref = whatsapp
    ? `https://wa.me/${whatsapp}?text=${encodeURIComponent(
        orderNumber ? `Hi, I need help with order #${orderNumber}.` : "Hi, I need some help."
      )}`
    : null;

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <a
        href={mailto}
        className="glass glass-on-light glass-panel glass-press flex items-start gap-4 p-5"
      >
        <Mail className="mt-0.5 size-5 shrink-0 text-(--shop-ink)" aria-hidden />
        <span>
          <span className="block text-[15px] font-medium text-(--shop-ink)">
            Email us
          </span>
          <span className="mt-1 block text-sm text-(--shop-mute)">
            {supportEmail} · we reply within one working day
          </span>
        </span>
      </a>

      {whatsappHref && (
        <a
          href={whatsappHref}
          target="_blank"
          rel="noreferrer"
          className="glass glass-on-light glass-panel glass-press flex items-start gap-4 p-5"
        >
          <MessageCircle
            className="mt-0.5 size-5 shrink-0 text-(--shop-success)"
            aria-hidden
          />
          <span>
            <span className="block text-[15px] font-medium text-(--shop-ink)">
              Chat on WhatsApp
            </span>
            <span className="mt-1 block text-sm text-(--shop-mute)">
              Opens a chat with our team
            </span>
          </span>
        </a>
      )}
    </div>
  );
}
