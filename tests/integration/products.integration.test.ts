import { describe, it, expect, afterAll } from 'vitest';
import { saveProduct, deleteProduct, fetchProduct, fetchProducts } from '../../src/core';
import { requestOptions, uniqueId, uniqueBarcode } from './setup';

describe.sequential('Products API Integration', () => {
  let createdProductId: number | null = null;
  const testProductName = uniqueId('Test_Product');
  const testBarcode = uniqueBarcode();

  afterAll(async () => {
    if (createdProductId !== null) {
      try {
        await deleteProduct(createdProductId, requestOptions);
      } catch (error) {
        console.warn(`Cleanup: Failed to delete product ${createdProductId}`, error);
      }
    }
  });

  it('creates a product and returns it with its id (saveProduct)', async () => {
    const saved = await saveProduct(
      {
        barcode: testBarcode,
        name: testProductName,
        details: 'Integration test product',
        tags: 'test,integration',
        unit: 1,
        categories: [],
        instances: {},
      },
      requestOptions
    );

    expect(saved.id).toBeTypeOf('number');
    expect(saved.name).toBe(testProductName);
    expect(saved.barcode).toBe(testBarcode);
    createdProductId = saved.id;
  });

  it('reads it back by id and by filter', async () => {
    expect(createdProductId).not.toBeNull();

    const one = await fetchProduct(createdProductId!, {}, requestOptions);
    expect(one?.id).toBe(createdProductId);
    expect(one?.name).toBe(testProductName);
    expect(one?.barcode).toBe(testBarcode);

    const list = await fetchProducts({ productIds: [createdProductId!] }, requestOptions);
    expect(list).toHaveLength(1);
  });

  it('updates it and returns the saved values', async () => {
    expect(createdProductId).not.toBeNull();
    const updatedName = uniqueId('Updated_Product');

    const saved = await saveProduct(
      {
        id: createdProductId!,
        barcode: testBarcode,
        name: updatedName,
        details: 'Updated integration test product',
        tags: 'test,integration,updated',
        unit: 2,
      },
      requestOptions
    );
    expect(saved.id).toBe(createdProductId);
    expect(saved.name).toBe(updatedName);
    expect(saved.unit).toBe(2);

    const reread = await fetchProduct(createdProductId!, {}, requestOptions);
    expect(reread?.name).toBe(updatedName);
    expect(reread?.unit).toBe(2);
  });

  it('deletes it (205, soft delete)', async () => {
    expect(createdProductId).not.toBeNull();
    const deletedId = createdProductId!;

    await expect(deleteProduct(deletedId, requestOptions)).resolves.toBeUndefined();
    createdProductId = null;

    const products = await fetchProducts({ productIds: [deletedId], deleted: true }, requestOptions);
    expect(products).toHaveLength(1);
    expect(products[0].deleteDate).toBeTruthy();
  });

  it('does not return unknown ids', async () => {
    const products = await fetchProducts({ productIds: [999999999] }, requestOptions);
    expect(products).toHaveLength(0);
    await expect(fetchProduct(999999999, {}, requestOptions)).resolves.toBeNull();
  });
});
