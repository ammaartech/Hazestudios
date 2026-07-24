/**
 * Help content.
 *
 * Kept as data rather than markup so the same articles can later back a search
 * box, a checkout-side FAQ, or a metaobject-driven CMS without rewriting the
 * page. Plain data, no "use client" — the help page renders on the server.
 */

export interface HelpArticle {
  slug: string;
  question: string;
  answer: string;
  /** Grouping shown as a section heading. */
  topic: "Orders & delivery" | "Returns & refunds" | "Sizing & product" | "Account";
}

export const HELP_ARTICLES: HelpArticle[] = [
  {
    slug: "where-is-my-order",
    topic: "Orders & delivery",
    question: "Where is my order?",
    answer:
      "Open Orders in your account. Anything still on its way is listed under “In progress”, and once a parcel is dispatched the shipment and tracking number appear on the order itself.",
  },
  {
    slug: "delivery-times",
    topic: "Orders & delivery",
    question: "How long does delivery take?",
    answer:
      "Orders are packed within one to two working days. Delivery then depends on your address and the service chosen at checkout — the estimate shown at checkout is the one to go by.",
  },
  {
    slug: "change-order",
    topic: "Orders & delivery",
    question: "Can I change or cancel my order?",
    answer:
      "If the order has not shipped yet we can usually still amend it. Get in touch with your order number as soon as you can — once it is marked as shipped it has left us and a return is the way to go.",
  },
  {
    slug: "returns-window",
    topic: "Returns & refunds",
    question: "What is your returns policy?",
    answer:
      "Unworn items in their original condition can be returned within 14 days of delivery. Email us with your order number and we will send return instructions.",
  },
  {
    slug: "refund-timing",
    topic: "Returns & refunds",
    question: "When will I get my refund?",
    answer:
      "Refunds are issued to the original payment method once the return arrives and is checked. Your bank usually takes a further three to five working days to show it.",
  },
  {
    slug: "sizing",
    topic: "Sizing & product",
    question: "How do I find the right size?",
    answer:
      "Every product page has a Size guide button next to the size selector, with garment measurements taken flat. You can switch between inches and centimetres. If you are between sizes we recommend sizing up.",
  },
  {
    slug: "restock",
    topic: "Sizing & product",
    question: "Will sold-out items come back?",
    answer:
      "Sometimes. Sizes that sell out early are often restocked once; full drops rarely return. Turn on email updates in Your details to hear about restocks first.",
  },
  {
    slug: "order-history-missing",
    topic: "Account",
    question: "My past orders are not showing",
    answer:
      "Order history is connected to your account only once your email address is confirmed — that check is what stops someone else claiming your orders. Confirm the link we emailed you and your history will appear. If you ordered with a different address, get in touch and we will merge it.",
  },
  {
    slug: "guest-order",
    topic: "Account",
    question: "I ordered without an account",
    answer:
      "Create an account with the same email address you used at checkout. Once you confirm it, those orders are attached to your account automatically.",
  },
];

export const HELP_TOPICS = [
  "Orders & delivery",
  "Returns & refunds",
  "Sizing & product",
  "Account",
] as const;
