import type { Consumer } from "./consumer";
import type { Product } from "./product";
import type { ReportQueryMap, ReportResponse } from "./report";

// ── Basket Report Types (preserved from the original `types/basket.ts`) ──────

export interface BasketItem {
  productId: number;
  productName: string;
  quantity: number;
  price: number;
  tax: number;
}

export interface Basket {
  id: number;
  name: string;
  consumerId: number;
  products: BasketItem[];
  total: number;
  taxTotal: number;
  status: "pending" | "completed" | "cancelled";
  completeDate: string;
}

export interface BasketReportRow {
  id: number;
  basketId: number;
  basketName: string;
  consumerId: number;
  consumerName: string;
  consumerEmail: string;
  products: BasketItem[];
  basketTotal: number;
  tax: number;
  dateTime: string;
  status: string;
}

export interface BasketSummary {
  totalBaskets: number;
  totalRevenue: number;
  totalTax: number;
  uniqueConsumers: number;
}

export interface BasketFilters {
  search: string;
  dateRange: {
    start: Date | null;
    end: Date | null;
  };
  consumerId: number | null;
  status: "all" | "pending" | "completed" | "cancelled";
}

export interface BasketPagination {
  page: number;
  pageSize: number;
  total: number;
}

export const DEFAULT_BASKET_FILTERS: BasketFilters = {
  search: "",
  dateRange: {
    start: null,
    end: null,
  },
  consumerId: null,
  status: "all",
};

export const DEFAULT_PAGINATION: BasketPagination = {
  page: 0,
  pageSize: 25,
  total: 0,
};

/** Intermediate shape produced by {@link parseBasketReportData}. */
export interface ParsedBasket {
  id: number;
  name: string;
  consumerId: number;
  products: BasketItem[];
  total: number;
  taxTotal: number;
  status: "completed";
  completeDate: string;
}

// ── Pure transform helpers (extracted from the original `useBasketReport`) ────

/** Formats a date as `YYYY-MM-DD HH:mm:ss` for the report query. */
export function formatDateForQuery(date: Date, isEndOfDay = false): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const time = isEndOfDay ? "23:59:59" : "00:00:00";
  return `${year}-${month}-${day} ${time}`;
}

/** Builds the `Basket` report query from a set of filters. */
export function buildBasketReportQuery(filters: BasketFilters): ReportQueryMap {
  const whereConditions: string[] = [];

  const today = new Date();
  const startDate = filters.dateRange.start ?? today;
  const endDate = filters.dateRange.end ?? today;

  whereConditions.push(
    `Basket.completeDate > '${formatDateForQuery(startDate, false)}'`
  );
  whereConditions.push(
    `Basket.completeDate < '${formatDateForQuery(endDate, true)}'`
  );

  if (filters.consumerId) {
    whereConditions.push(`Basket.consumerId = ${filters.consumerId}`);
  }

  if (filters.status !== "all") {
    whereConditions.push(`Basket.status = '${filters.status}'`);
  }

  return {
    baskets: {
      FROM: "Basket",
      WHERE: whereConditions.length > 0 ? { AND: whereConditions } : undefined,
    },
  };
}

/** Flattens the raw report rows/keys into structured baskets. */
export function parseBasketReportData(
  reports: ReportResponse["reports"] | null | undefined
): ParsedBasket[] {
  if (!reports?.baskets?.data || !reports?.baskets?.keys) {
    return [];
  }

  const { keys, data } = reports.baskets;

  const keyIndices: { [key: string]: number } = {};
  keys.forEach((key, index) => {
    keyIndices[key.name] = index;
  });

  const productKey = keys.find((k) => k.name === "Basket.Product");
  const productSubKeys: { [key: string]: number } = {};
  if (productKey?.item) {
    productKey.item.forEach((subKey, index) => {
      productSubKeys[subKey.name] = index;
    });
  }

  return data.map((row) => {
    const productsArray = (row[keyIndices["Basket.Product"]] as any[][]) || [];
    const products: BasketItem[] = productsArray.map((productRow) => ({
      productId: productRow[productSubKeys["Basket.Product.productId"]] as number,
      productName: `Product #${productRow[productSubKeys["Basket.Product.productId"]]}`,
      quantity:
        (productRow[productSubKeys["Basket.Product.quantity"]] as number) || 1,
      price:
        (productRow[productSubKeys["Basket.Product.productPrice"]] as number) ||
        0,
      tax:
        (productRow[
          productSubKeys["Basket.Product.productTaxPercentage"]
        ] as number) || 0,
    }));

    const total = products.reduce((sum, p) => sum + p.price * p.quantity, 0);
    const taxTotal = products.reduce(
      (sum, p) => sum + p.price * p.quantity * p.tax,
      0
    );

    const completeDateTimestamp = row[keyIndices["Basket.completeDate"]] as number;
    const completeDate = completeDateTimestamp
      ? new Date(completeDateTimestamp).toISOString()
      : "";

    return {
      id: row[keyIndices["Basket.id"]] as number,
      name: row[keyIndices["Basket.name"]] as string,
      consumerId: row[keyIndices["Basket.consumerId"]] as number,
      products,
      total,
      taxTotal,
      status: "completed" as const,
      completeDate,
    };
  });
}

/** Unique non-null consumer ids referenced by a set of baskets. */
export function collectConsumerIds(baskets: ParsedBasket[]): number[] | null {
  if (!baskets.length) return null;
  const ids = baskets
    .map((b) => b.consumerId)
    .filter((id): id is number => id != null);
  return ids.length > 0 ? [...new Set(ids)] : null;
}

/** Unique product ids referenced by a set of baskets. */
export function collectProductIds(baskets: ParsedBasket[]): number[] | null {
  if (!baskets.length) return null;
  const ids = new Set<number>();
  baskets.forEach((basket) => {
    basket.products.forEach((product) => {
      if (product.productId) {
        ids.add(product.productId);
      }
    });
  });
  return ids.size > 0 ? [...ids] : null;
}

export interface CombineBasketRowsParams {
  baskets: ParsedBasket[];
  consumerMap: { [id: number]: Consumer };
  productMap: { [id: number]: Product };
  search?: string;
}

/** Joins baskets with consumer + product lookups, applies search, sorts. */
export function combineBasketRows({
  baskets,
  consumerMap,
  productMap,
  search,
}: CombineBasketRowsParams): BasketReportRow[] {
  if (!baskets.length) return [];

  let combinedRows: BasketReportRow[] = baskets.map((basket) => {
    const consumer = basket.consumerId ? consumerMap[basket.consumerId] : null;

    const productsWithNames: BasketItem[] = basket.products.map((p) => {
      const product = productMap[p.productId];
      return {
        ...p,
        productName: product?.name || `Product #${p.productId}`,
      };
    });

    return {
      id: basket.id,
      basketId: basket.id,
      basketName: basket.name || `Basket #${basket.id}`,
      consumerId: basket.consumerId,
      consumerName: consumer
        ? `${consumer.firstName} ${consumer.lastName}`
        : "Unknown",
      consumerEmail: consumer?.email || "-",
      products: productsWithNames,
      basketTotal: (basket.total || 0) / 100,
      tax: basket.taxTotal || 0,
      dateTime: basket.completeDate,
      status: basket.status || "pending",
    };
  });

  if (search) {
    const searchLower = search.toLowerCase();
    combinedRows = combinedRows.filter(
      (row) =>
        row.basketId.toString().includes(searchLower) ||
        row.basketName.toLowerCase().includes(searchLower) ||
        row.consumerName.toLowerCase().includes(searchLower) ||
        row.consumerEmail.toLowerCase().includes(searchLower)
    );
  }

  combinedRows.sort((a, b) => {
    const dateA = new Date(a.dateTime).getTime();
    const dateB = new Date(b.dateTime).getTime();
    return dateB - dateA;
  });

  return combinedRows;
}

/** Aggregate totals for a set of report rows. */
export function computeBasketSummary(rows: BasketReportRow[]): BasketSummary {
  const uniqueConsumerIds = new Set(rows.map((row) => row.consumerId));
  return {
    totalBaskets: rows.length,
    totalRevenue: rows.reduce((sum, row) => sum + row.basketTotal, 0),
    totalTax: rows.reduce((sum, row) => sum + row.tax, 0),
    uniqueConsumers: uniqueConsumerIds.size,
  };
}

/** Builds a consumer id → consumer lookup. */
export function buildConsumerMap(consumers: Consumer[] | null | undefined): {
  [id: number]: Consumer;
} {
  const map: { [id: number]: Consumer } = {};
  if (consumers) {
    consumers.forEach((consumer) => {
      map[consumer.id] = consumer;
    });
  }
  return map;
}
