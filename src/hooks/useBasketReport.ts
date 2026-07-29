import { useCallback, useEffect, useMemo, useState } from "react";
import {
  buildBasketReportQuery,
  buildConsumerMap,
  collectConsumerIds,
  collectProductIds,
  combineBasketRows,
  computeBasketSummary,
  fetchProductsMap,
  parseBasketReportData,
  DEFAULT_BASKET_FILTERS,
  DEFAULT_PAGINATION,
  type BasketFilters,
  type BasketPagination,
  type BasketReportRow,
  type BasketSummary,
  type Product,
  type RequestOptions,
} from "../core";
import useReport from "./useReport";
import useConsumer from "./useConsumer";

export interface UseBasketReportReturn {
  rows: BasketReportRow[];
  summary: BasketSummary;
  loading: boolean;
  error: string | null;
  filters: BasketFilters;
  setFilters: (filters: Partial<BasketFilters>) => void;
  pagination: BasketPagination;
  setPagination: (page: number, pageSize: number) => void;
  refresh: () => void;
}

/**
 * Composite hook that orchestrates the report → consumers → products pipeline
 * for the basket report screen. All the data-shaping logic now lives in the
 * framework-agnostic `core/basket` helpers; this hook is the thin React glue
 * (state, memoisation, effects) on top of them.
 */
export function useBasketReport(
  options?: RequestOptions
): UseBasketReportReturn {
  const [filters, setFiltersState] = useState<BasketFilters>(
    DEFAULT_BASKET_FILTERS
  );
  const [pagination, setPaginationState] = useState<BasketPagination>(
    DEFAULT_PAGINATION
  );
  const [refreshFlag, setRefreshFlag] = useState(0);

  // Build the report query from filters (core helper).
  const reportQuery = useMemo(
    () => buildBasketReportQuery(filters),
    // refreshFlag forces a new object identity to re-trigger the fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filters, refreshFlag]
  );

  const {
    data: reports,
    loading: basketLoading,
    error: basketError,
  } = useReport(reportQuery, options);

  // Flatten raw report rows into structured baskets (core helper).
  const basketData = useMemo(() => parseBasketReportData(reports), [reports]);

  // Derive id sets for the dependent fetches (core helpers).
  const consumerIds = useMemo(
    () => collectConsumerIds(basketData),
    [basketData]
  );
  const productIds = useMemo(
    () => collectProductIds(basketData),
    [basketData]
  );

  const {
    data: consumers,
    loading: consumerLoading,
    error: consumerError,
  } = useConsumer(consumerIds, options);

  // Batched product fetch (core helper handles the 200-per-request batching).
  const [productMap, setProductMap] = useState<{ [id: number]: Product }>({});
  const [productLoading, setProductLoading] = useState(false);
  const [productError, setProductError] = useState<string | null>(null);

  useEffect(() => {
    if (!productIds || productIds.length === 0) {
      setProductMap({});
      return;
    }

    let active = true;
    setProductLoading(true);
    setProductError(null);

    fetchProductsMap(productIds, options)
      .then((map) => {
        if (active) setProductMap(map);
      })
      .catch((e) => {
        if (active) {
          setProductError(
            e instanceof Error ? e.message : "Failed to fetch products"
          );
        }
      })
      .finally(() => {
        if (active) setProductLoading(false);
      });

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(productIds), options?.baseUrl, options?.token]);

  // Consumer lookup (core helper).
  const consumerMap = useMemo(() => buildConsumerMap(consumers), [consumers]);

  // Combine into final rows (core helper: join + search + sort).
  const rows: BasketReportRow[] = useMemo(
    () =>
      combineBasketRows({
        baskets: basketData,
        consumerMap,
        productMap,
        search: filters.search,
      }),
    [basketData, consumerMap, productMap, filters.search]
  );

  // Summary (core helper).
  const summary: BasketSummary = useMemo(
    () => computeBasketSummary(rows),
    [rows]
  );

  // Keep pagination total in sync with fetched data.
  useEffect(() => {
    if (rows.length > 0 && rows.length === pagination.pageSize) {
      setPaginationState((prev) => ({
        ...prev,
        total: (pagination.page + 2) * pagination.pageSize,
      }));
    } else if (rows.length > 0) {
      setPaginationState((prev) => ({
        ...prev,
        total: pagination.page * pagination.pageSize + rows.length,
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.length, pagination.page, pagination.pageSize]);

  const setFilters = useCallback((newFilters: Partial<BasketFilters>) => {
    setFiltersState((prev) => ({ ...prev, ...newFilters }));
    setPaginationState((prev) => ({ ...prev, page: 0 }));
  }, []);

  const setPagination = useCallback((page: number, pageSize: number) => {
    setPaginationState((prev) => ({ ...prev, page, pageSize }));
  }, []);

  const refresh = useCallback(() => {
    setRefreshFlag((prev) => prev + 1);
  }, []);

  const loading = basketLoading || consumerLoading || productLoading;
  const error = basketError || consumerError || productError;

  return {
    rows,
    summary,
    loading,
    error,
    filters,
    setFilters,
    pagination,
    setPagination,
    refresh,
  };
}

export default useBasketReport;
