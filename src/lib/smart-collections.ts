import type { CollectionRule, Product } from "./types";

export function productMatchesRules(product: Product, rules: CollectionRule[]) {
  if (!rules.length) return false;
  return rules.every((rule) => {
    switch (rule.field) {
      case "tag": {
        const v = rule.value.toLowerCase();
        if (rule.operator === "equals")
          return product.tags.some((t) => t.toLowerCase() === v);
        return product.tags.some((t) => t.toLowerCase().includes(v));
      }
      case "title":
        return compareText(product.title, rule);
      case "vendor":
        return compareText(product.vendor, rule);
      case "product_type":
        return compareText(product.product_type, rule);
      case "price": {
        const target = parseFloat(rule.value);
        if (!Number.isFinite(target)) return false;
        const price = Number(product.price);
        if (rule.operator === "greater_than") return price > target;
        if (rule.operator === "less_than") return price < target;
        return price === target;
      }
      default:
        return false;
    }
  });
}

function compareText(value: string, rule: CollectionRule) {
  const a = value.toLowerCase();
  const b = rule.value.toLowerCase();
  switch (rule.operator) {
    case "equals":
      return a === b;
    case "contains":
      return a.includes(b);
    case "starts_with":
      return a.startsWith(b);
    default:
      return false;
  }
}
