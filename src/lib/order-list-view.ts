import type { OrderRouteMode } from "./order-routes";

export function getOrderListPrimaryDisplayValue(mode: OrderRouteMode, row: Record<string, unknown>) {
  return String(mode === "purchase" ? row.poNo ?? "" : row.requestNo ?? "");
}

export function getOrderListColumnKeys(mode: OrderRouteMode) {
  if (mode === "requests") {
    return [
      "requestNo",
      "countryCode",
      "batchName",
      "status",
      "totalQuantity",
      "plannedDeliveryDate",
      "createdAt",
      "updatedAt",
      "actions",
    ];
  }

  return [
    "poNo",
    "requestNo",
    "countryCode",
    "batchName",
    "status",
    "currency",
    "totalQuantity",
    "purchaseTotalAmount",
    "createdAt",
    "updatedAt",
    "actions",
  ];
}

export function shouldShowPurchaseSourceGenerator(_mode: OrderRouteMode) {
  return false;
}
