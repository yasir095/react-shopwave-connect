/**
 * @shopwave/sdk — hooks layer.
 *
 * Thin React wrappers around the `core` API functions. Every hook imports its
 * logic from `core`; none of it is duplicated here. React / react-dom are peer
 * dependencies and are never bundled.
 */

export type { QueryState, MutationState } from "./shared";

export { useCategory } from "./useCategory";
export { useConsumer } from "./useConsumer";
export { useEmployee } from "./useEmployee";
export { useProduct } from "./useProduct";
export { usePromotion } from "./usePromotion";
export { useStore } from "./useStore";
export { useReport } from "./useReport";
export { useDelete } from "./useDelete";
export { useSubmit } from "./useSubmit";
export { useLogout } from "./useLogout";
export { useBasketReport, type UseBasketReportReturn } from "./useBasketReport";
