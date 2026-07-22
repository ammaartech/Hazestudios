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
  { label: "Home", href: "/admin", icon: Home },
  {
    label: "Orders",
    href: "/admin/orders",
    icon: ShoppingCart,
    children: [
      { label: "Drafts", href: "/admin/orders/drafts" },
      { label: "Abandoned checkouts", href: "/admin/orders/abandoned" },
    ],
  },
  {
    label: "Products",
    href: "/admin/products",
    icon: Tag,
    children: [
      { label: "Collections", href: "/admin/products/collections" },
      { label: "Inventory", href: "/admin/products/inventory" },
      { label: "Gift cards", href: "/admin/products/gift-cards" },
      { label: "Purchase orders", href: "/admin/products/purchase-orders" },
      { label: "Transfers", href: "/admin/products/transfers" },
      { label: "Price lists", href: "/admin/products/price-lists" },
    ],
  },
  {
    label: "Customers",
    href: "/admin/customers",
    icon: Users,
    children: [
      { label: "Segments", href: "/admin/customers/segments" },
      { label: "Companies", href: "/admin/customers/companies" },
    ],
  },
  {
    label: "Content",
    href: "/admin/content/files",
    icon: FileText,
    children: [
      { label: "Files", href: "/admin/content/files" },
      { label: "Metaobjects", href: "/admin/content/metaobjects" },
    ],
  },
  {
    label: "Analytics",
    href: "/admin/analytics",
    icon: BarChart3,
    children: [
      { label: "Reports", href: "/admin/analytics/reports" },
      { label: "Live View", href: "/admin/analytics/live" },
    ],
  },
  {
    label: "Marketing",
    href: "/admin/marketing",
    icon: Megaphone,
    children: [{ label: "Automations", href: "/admin/marketing/automations" }],
  },
  { label: "Discounts", href: "/admin/discounts", icon: BadgePercent },
];

export const salesChannelNav: NavItem[] = [
  { label: "Online Store", href: "/admin/online-store", icon: Globe },
  { label: "Point of Sale", href: "/admin/pos", icon: MonitorSmartphone },
  { label: "Social channels", href: "/admin/social-channels", icon: Share2 },
];
