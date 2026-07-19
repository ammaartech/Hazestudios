import {
  Home,
  ShoppingCart,
  Tag,
  Users,
  FileText,
  BarChart3,
  Megaphone,
  BadgePercent,
  Globe,
  MonitorSmartphone,
  Share2,
  type LucideIcon,
} from "lucide-react";

export interface NavChild {
  label: string;
  href: string;
}

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  children?: NavChild[];
}

export const mainNav: NavItem[] = [
  { label: "Home", href: "/", icon: Home },
  {
    label: "Orders",
    href: "/orders",
    icon: ShoppingCart,
    children: [
      { label: "Drafts", href: "/orders/drafts" },
      { label: "Abandoned checkouts", href: "/orders/abandoned" },
    ],
  },
  {
    label: "Products",
    href: "/products",
    icon: Tag,
    children: [
      { label: "Collections", href: "/products/collections" },
      { label: "Inventory", href: "/products/inventory" },
      { label: "Gift cards", href: "/products/gift-cards" },
      { label: "Purchase orders", href: "/products/purchase-orders" },
      { label: "Transfers", href: "/products/transfers" },
      { label: "Price lists", href: "/products/price-lists" },
    ],
  },
  {
    label: "Customers",
    href: "/customers",
    icon: Users,
    children: [
      { label: "Segments", href: "/customers/segments" },
      { label: "Companies", href: "/customers/companies" },
    ],
  },
  {
    label: "Content",
    href: "/content/files",
    icon: FileText,
    children: [
      { label: "Files", href: "/content/files" },
      { label: "Metaobjects", href: "/content/metaobjects" },
    ],
  },
  {
    label: "Analytics",
    href: "/analytics",
    icon: BarChart3,
    children: [
      { label: "Reports", href: "/analytics/reports" },
      { label: "Live View", href: "/analytics/live" },
    ],
  },
  {
    label: "Marketing",
    href: "/marketing",
    icon: Megaphone,
    children: [{ label: "Automations", href: "/marketing/automations" }],
  },
  { label: "Discounts", href: "/discounts", icon: BadgePercent },
];

export const salesChannelNav: NavItem[] = [
  { label: "Online Store", href: "/online-store", icon: Globe },
  { label: "Point of Sale", href: "/pos", icon: MonitorSmartphone },
  { label: "Social channels", href: "/social-channels", icon: Share2 },
];
