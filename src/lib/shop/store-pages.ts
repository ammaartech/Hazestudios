/**
 * Static storefront pages: the content pages under `/pages/…` and the four
 * legal policies under `/policies/…`.
 *
 * Kept as data rather than markup for the same reason as `help-articles.ts` —
 * the same copy can later back a metaobject-driven CMS or a checkout-side
 * summary without rewriting a page component.
 *
 * The policies here are defaults. `shop_settings.policies` wins when an admin
 * has written something there (see the policies route), so editing a policy in
 * the admin does not require a deploy. Keeping the copy in code as well means
 * the links work on a fresh install with an empty settings row, rather than
 * 404ing until someone fills the form in.
 */

export interface PageBlock {
  /** Sub-heading above the block. Omit for a run-on paragraph group. */
  heading?: string;
  body?: string[];
  /** Rendered as a bulleted list under `body`. */
  list?: string[];
}

export interface StorePage {
  slug: string;
  title: string;
  /** Sits under the title as a lede. */
  description?: string;
  blocks: PageBlock[];
}

/* -------------------------------------------------------------------------- */
/* Content pages — /pages/<slug>                                               */
/* -------------------------------------------------------------------------- */

export const STORE_PAGES: StorePage[] = [
  {
    slug: "shipping-policy",
    title: "Shipping Policy",
    blocks: [
      {
        heading: "In-stock timeline",
        body: [
          "Orders for in-stock items are processed typically within 48–72 hours of purchase. Following processing, delivery to your designated address is estimated to take between 6–12 days.",
        ],
      },
      {
        heading: "Pre-order timeline",
        body: [
          "For items available for pre-order, fulfillment aligns with the specified pre-order timeline unique to each product. This ensures transparent expectations regarding the processing and delivery of pre-order items.",
        ],
        list: [
          "Standard pre-order: requires 7 days for processing, followed by an estimated 35 days for delivery.",
          "Extended pre-order: entails a 7-day processing period, with delivery anticipated within 45 days.",
        ],
      },
      {
        heading: "Delay policy",
        body: [
          "While every effort is made to adhere to the provided timelines, we acknowledge that unforeseen circumstances may arise. In the event of a delay beyond the specified timeframe, customers are entitled to exercise their right to cancel their order and receive a full refund promptly. Should a delay be attributable to logistical challenges, please note that delivery may require an additional 1–2 weeks to ensure completion.",
          "We are committed to maintaining transparency and ensuring your satisfaction throughout the ordering and delivery process. Should you have any questions or concerns regarding your order, please do not hesitate to contact our customer service team for assistance at +91 96060 22206 or +91 96060 22208.",
        ],
      },
    ],
  },
  {
    slug: "cash-on-delivery-policy",
    title: "Cash On Delivery Policy",
    blocks: [
      {
        body: [
          "Cash on Delivery is available all over India. However, a small advance payment might be requested from our dispatch team for difficult-to-service areas or for other reasons.",
          "Don't worry, we'll always make sure to keep things easy and straightforward for you. Shop now with confidence.",
        ],
      },
    ],
  },
];

/* -------------------------------------------------------------------------- */
/* Policies — /policies/<slug>                                                 */
/* -------------------------------------------------------------------------- */

/** Maps a policy URL slug to its key in `shop_settings.policies`. */
export const POLICY_SETTING_KEY = {
  "privacy-policy": "privacy",
  "refund-policy": "refund",
  "shipping-policy": "shipping",
  "terms-of-service": "terms",
} as const;

export type PolicySlug = keyof typeof POLICY_SETTING_KEY;

export const POLICY_PAGES: StorePage[] = [
  {
    slug: "refund-policy",
    title: "Refund policy",
    blocks: [
      {
        heading: "Exchange policy",
        body: [
          "Need to exchange? No problem. If we have the size you need, we'll swap it out. If not, we'll give you store credit instead. Just cover the return shipping, usually around 120–250 INR.",
        ],
      },
      {
        heading: "Return policy",
        body: [
          "Returns are case-by-case, but if approved, you'll get shop credit. It's calculated as (product value + taxes − return cost). Return cost is 180 INR. Once we get your return and check it, you'll get your credit in about 72 hours.",
        ],
      },
      {
        heading: "Delay policy",
        body: [
          "Sometimes things don't go as planned. If your order's delayed beyond our estimated timelines, you can cancel for a full refund — just let us know. And if it's a logistics hiccup, your delivery might take another 1–2 weeks.",
          "We're all about transparency and making sure you're happy. Got questions? Reach out to our customer service team anytime.",
        ],
      },
      {
        heading: "Damaged goods",
        body: [
          "You can get a full refund if the item is defective, damaged, or incorrect. Just let us know right away.",
          "Note: video evidence of opening the parcel is required.",
        ],
      },
      {
        heading: "Monetary refunds",
        body: [
          "Monetary refunds are rare and are issued only in exceptional cases such as damaged goods or manufacturing defects. If you're eligible, we'll process it back to your original payment method or Google Pay. Your bank might take 5–10 days to show it. Reach out if you need help.",
        ],
      },
    ],
  },
  {
    slug: "shipping-policy",
    title: "Shipping policy",
    blocks: STORE_PAGES[0].blocks,
  },
  {
    slug: "terms-of-service",
    title: "Terms of service",
    blocks: [
      {
        body: [
          "This website is operated by Fogstores. Throughout the site, the terms “we”, “us” and “our” refer to Fogstores. Fogstores offers this website, including all information, tools and services available from this site to you, the user, conditioned upon your acceptance of all terms, conditions, policies and notices stated here.",
          "By visiting our site and/or purchasing something from us, you engage in our “Service” and agree to be bound by the following terms and conditions (“Terms of Service”, “Terms”), including those additional terms and conditions and policies referenced herein and/or available by hyperlink. These Terms of Service apply to all users of the site, including without limitation users who are browsers, vendors, customers, merchants, and/or contributors of content.",
          "Please read these Terms of Service carefully before accessing or using our website. By accessing or using any part of the site, you agree to be bound by these Terms of Service. If you do not agree to all the terms and conditions of this agreement, then you may not access the website or use any services. If these Terms of Service are considered an offer, acceptance is expressly limited to these Terms of Service.",
          "Any new features or tools which are added to the current store shall also be subject to the Terms of Service. You can review the most current version of the Terms of Service at any time on this page. We reserve the right to update, change or replace any part of these Terms of Service by posting updates and/or changes to our website. It is your responsibility to check this page periodically for changes. Your continued use of or access to the website following the posting of any changes constitutes acceptance of those changes.",
        ],
      },
    ],
  },
  {
    slug: "privacy-policy",
    title: "Privacy policy",
    blocks: [
      {
        body: [
          "At Fogstores, one of our main priorities is the privacy of our visitors. This Privacy Policy document contains types of information that is collected and recorded by Fogstores and how we use it.",
          "If you have additional questions or require more information about our Privacy Policy, do not hesitate to contact us.",
          "This Privacy Policy applies only to our online activities and is valid for visitors to our website with regards to the information that they shared and/or collect in Fogstores. This policy is not applicable to any information collected offline or via channels other than this website.",
        ],
      },
      {
        heading: "Consent",
        body: ["By using our website, you hereby consent to our Privacy Policy and agree to its terms."],
      },
      {
        heading: "Information we collect",
        body: [
          "The personal information that you are asked to provide, and the reasons why you are asked to provide it, will be made clear to you at the point we ask you to provide your personal information.",
          "If you contact us directly, we may receive additional information about you such as your name, email address, phone number, the contents of the message and/or attachments you may send us, and any other information you may choose to provide.",
          "When you register for an account, we may ask for your contact information, including items such as name, company name, address, email address, and mobile number.",
        ],
      },
      {
        heading: "How we use your information",
        body: ["We use the information we collect in various ways, including to:"],
        list: [
          "Provide, operate, and maintain our website",
          "Improve, personalize, and expand our website",
          "Understand and analyze how you use our website",
          "Develop new products, services, features, and functionality",
          "Communicate with you, either directly or through one of our partners, including for customer service, to provide you with updates and other information relating to the website, and for marketing and promotional purposes",
          "Send you emails",
          "Find and prevent fraud",
        ],
      },
    ],
  },
];

/* -------------------------------------------------------------------------- */

export function getStorePage(slug: string): StorePage | undefined {
  return STORE_PAGES.find((p) => p.slug === slug);
}

export function getPolicyPage(slug: string): StorePage | undefined {
  return POLICY_PAGES.find((p) => p.slug === slug);
}
