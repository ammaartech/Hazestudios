import type { Customer, SegmentFilter } from "./types";

/**
 * The only fields a filter actually reads — same idea as `MatchableProduct` in
 * smart-collections.ts. A full `Customer` still satisfies this, so callers with
 * whole rows are unaffected, and the segments list can count matches without
 * fetching every column of every customer.
 */
export type MatchableCustomer = Pick<
  Customer,
  "total_spent" | "orders_count" | "default_address" | "accepts_marketing" | "tags"
>;

export function customerMatchesFilters(
  customer: MatchableCustomer,
  filters: SegmentFilter[]
) {
  if (!filters.length) return false;
  return filters.every((filter) => {
    switch (filter.field) {
      case "total_spent": {
        const target = parseFloat(filter.value);
        if (!Number.isFinite(target)) return false;
        const spent = Number(customer.total_spent);
        if (filter.operator === "greater_than") return spent > target;
        if (filter.operator === "less_than") return spent < target;
        return spent === target;
      }
      case "orders_count": {
        const target = parseInt(filter.value);
        if (!Number.isFinite(target)) return false;
        if (filter.operator === "greater_than")
          return customer.orders_count > target;
        if (filter.operator === "less_than")
          return customer.orders_count < target;
        return customer.orders_count === target;
      }
      case "country": {
        const country = (customer.default_address?.country ?? "").toLowerCase();
        const v = filter.value.toLowerCase();
        return filter.operator === "contains"
          ? country.includes(v)
          : country === v;
      }
      case "accepts_marketing":
        return (
          customer.accepts_marketing === (filter.value.toLowerCase() === "true")
        );
      case "tag": {
        const v = filter.value.toLowerCase();
        return filter.operator === "contains"
          ? customer.tags.some((t) => t.toLowerCase().includes(v))
          : customer.tags.some((t) => t.toLowerCase() === v);
      }
      default:
        return false;
    }
  });
}
