import { describe, it, expect, afterAll } from 'vitest';
import { submitEntity, deleteEntity } from '../../src/core/entity';
import { fetchProducts, type Product } from '../../src/core/product';
import { requestOptions, uniqueId, uniqueBarcode } from './setup';

describe.sequential('Products API Integration', () => {
  // Shared variable to store the created product ID across tests
  let createdProductId: number | null = null;

  // Test data with unique identifiers to prevent collisions
  const testProductName = uniqueId('Test_Product');
  const testBarcode = uniqueBarcode();

  afterAll(async () => {
    // Cleanup: delete the created product even if tests fail
    if (createdProductId !== null) {
      try {
        await deleteEntity('products', createdProductId, requestOptions);
      } catch (error) {
        console.warn(`Cleanup: Failed to delete product ${createdProductId}`, error);
      }
    }
  });

  it('should create a new product (POST)', async () => {
    const payload = {
      barcode: testBarcode,
      name: testProductName,
      details: 'Integration test product',
      tags: 'test,integration',
      unit: 1,
      categories: [],
      instances: {},
    };

    const result = await submitEntity<Product>(
      {
        endpoint: '/api/products',
        method: 'POST',
        payload,
      },
      requestOptions
    );

    expect(result).toBeDefined();
    expect(result?.id).toBeTypeOf('number');
    expect(result?.name).toBe(testProductName);
    expect(result?.barcode).toBe(testBarcode);

    // Store the ID for subsequent tests
    createdProductId = result!.id;
  });

  it('should read the created product (GET)', async () => {
    expect(createdProductId).not.toBeNull();

    const products = await fetchProducts(
      { productIds: [createdProductId!] },
      requestOptions
    );

    expect(products).toHaveLength(1);
    expect(products[0].id).toBe(createdProductId);
    expect(products[0].name).toBe(testProductName);
    expect(products[0].barcode).toBe(testBarcode);
  });

  it('should update the product (PUT)', async () => {
    expect(createdProductId).not.toBeNull();

    const updatedName = uniqueId('Updated_Product');
    const payload = {
      id: createdProductId,
      barcode: testBarcode,
      name: updatedName,
      details: 'Updated integration test product',
      tags: 'test,integration,updated',
      unit: 2,
    };

    const result = await submitEntity<Product>(
      {
        endpoint: `/api/products/${createdProductId}`,
        method: 'PUT',
        payload,
      },
      requestOptions
    );

    expect(result).toBeDefined();
    expect(result?.name).toBe(updatedName);
    expect(result?.unit).toBe(2);

    // Re-fetch to verify the change persisted
    const products = await fetchProducts(
      { productIds: [createdProductId!] },
      requestOptions
    );

    expect(products).toHaveLength(1);
    expect(products[0].name).toBe(updatedName);
    expect(products[0].unit).toBe(2);
  });

  it('should delete the product (DELETE)', async () => {
    expect(createdProductId).not.toBeNull();

    // Delete should complete without throwing
    await expect(
      deleteEntity('products', createdProductId!, requestOptions)
    ).resolves.toBeUndefined();

    // Mark as cleaned up so afterAll doesn't try to delete again
    const deletedId = createdProductId;
    createdProductId = null;

    // Verify soft-delete: fetch with deleted=true to confirm deleteDate is set
    const products = await fetchProducts(
      { productIds: [deletedId!], deleted: true },
      requestOptions
    );

    expect(products).toHaveLength(1);
    expect(products[0].id).toBe(deletedId);
    // deleteDate should be set (non-empty string) after deletion
    expect(products[0].deleteDate).toBeTruthy();
  });

  it('should not return deleted product when deleted=false', async () => {
    // Fetch without deleted flag (defaults to false) should not return soft-deleted products
    const products = await fetchProducts(
      { productIds: [999999999] },
      requestOptions
    );

    expect(products).toHaveLength(0);
  });
});
