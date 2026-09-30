import {
  uploadImage,
  uploadMerchantImage,
  type MerchantImageSlot,
  type RequestOptions,
  type UploadImageParams,
  type UploadMerchantImageOptions,
  type UploadedImage,
} from "../core";
import { useMutation, type MutationState } from "./shared";

/**
 * Manually-triggered image upload. Resolves to `{ id, url }`, or `null` on
 * error (then `error` / `errorStatus` are set).
 *
 * @example
 * const { mutate: upload, loading: uploading } = useUploadImage();
 * const image = await upload(file, { kind: "merchant" });
 */
export function useUploadImage(options?: RequestOptions): MutationState<UploadedImage, [Blob, UploadImageParams]> {
  return useMutation<UploadedImage, [Blob, UploadImageParams]>(
    (file, params) => uploadImage(file, params, options),
    [options?.baseUrl, options?.token]
  );
}

/**
 * Manually-triggered upload for a merchant image slot (`receipt`, `square`,
 * `featured`): fits the image to the slot's exact size, uploads it with the
 * slot's kind, and resolves to `{ id, url }`. Put `id` into `imageIds` with
 * `setMerchantImage`.
 *
 * @example
 * const { mutate: upload } = useUploadMerchantImage();
 * const image = await upload(file, "square");
 */
export function useUploadMerchantImage(
  options?: UploadMerchantImageOptions
): MutationState<UploadedImage, [Blob, MerchantImageSlot]> {
  return useMutation<UploadedImage, [Blob, MerchantImageSlot]>(
    (file, slot) => uploadMerchantImage(file, slot, options),
    [options?.baseUrl, options?.token, options?.fit]
  );
}

export default useUploadImage;
