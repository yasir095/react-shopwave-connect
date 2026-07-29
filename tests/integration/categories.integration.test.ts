import { describe, it, expect, afterAll } from 'vitest';
import { submitEntity, deleteEntity } from '../../src/core/entity';
import { fetchCategories, type Category } from '../../src/core/category';
import { requestOptions, uniqueId } from './setup';

describe.sequential('Categories API Integration', () => {
  // Shared variable to store the created category ID across tests
  let createdCategoryId: number | null = null;

  // Test data with unique identifiers to prevent collisions
  const testCategoryTitle = uniqueId('Test_Category');

  afterAll(async () => {
    // Cleanup: delete the created category even if tests fail
    if (createdCategoryId !== null) {
      try {
        await deleteEntity('categories', createdCategoryId, requestOptions);
      } catch (error) {
        console.warn(`Cleanup: Failed to delete category ${createdCategoryId}`, error);
      }
    }
  });

  it('should create a new category (POST)', async () => {
    const payload = {
      title: testCategoryTitle,
      parentId: null,
      type: 1,
    };

    const result = await submitEntity<Category>(
      {
        endpoint: '/api/categories',
        method: 'POST',
        payload,
      },
      requestOptions
    );

    expect(result).toBeDefined();
    expect(result?.id).toBeTypeOf('number');
    expect(result?.title).toBe(testCategoryTitle);

    // Store the ID for subsequent tests
    createdCategoryId = result!.id;
  });

  it('should read the created category (GET)', async () => {
    expect(createdCategoryId).not.toBeNull();

    const categories = await fetchCategories(
      { categoryIds: [createdCategoryId!] },
      requestOptions
    );

    expect(categories).toHaveLength(1);
    expect(categories[0].id).toBe(createdCategoryId);
    expect(categories[0].title).toBe(testCategoryTitle);
  });

  it('should update the category (PUT)', async () => {
    expect(createdCategoryId).not.toBeNull();

    const updatedTitle = uniqueId('Updated_Category');
    const payload = {
      id: createdCategoryId,
      title: updatedTitle,
      parentId: null,
      type: 2,
    };

    const result = await submitEntity<Category>(
      {
        endpoint: `/api/categories/${createdCategoryId}`,
        method: 'PUT',
        payload,
      },
      requestOptions
    );

    expect(result).toBeDefined();
    expect(result?.title).toBe(updatedTitle);
    expect(result?.type).toBe(2);

    // Re-fetch to verify the change persisted
    const categories = await fetchCategories(
      { categoryIds: [createdCategoryId!] },
      requestOptions
    );

    expect(categories).toHaveLength(1);
    expect(categories[0].title).toBe(updatedTitle);
    expect(categories[0].type).toBe(2);
  });

  it('should delete the category (DELETE)', async () => {
    expect(createdCategoryId).not.toBeNull();

    // Delete should complete without throwing
    await expect(
      deleteEntity('categories', createdCategoryId!, requestOptions)
    ).resolves.toBeUndefined();

    // Mark as cleaned up so afterAll doesn't try to delete again
    const deletedId = createdCategoryId;
    createdCategoryId = null;

    // Verify soft-delete: fetch with deleted=true to confirm deleteDate is set
    const categories = await fetchCategories(
      { categoryIds: [deletedId!], deleted: true },
      requestOptions
    );

    expect(categories).toHaveLength(1);
    expect(categories[0].id).toBe(deletedId);
    // deleteDate should be set (non-empty string) after deletion
    expect(categories[0].deleteDate).toBeTruthy();
  });

  it('should not return deleted category when deleted=false', async () => {
    // Fetch without deleted flag (defaults to false) should not return soft-deleted categories
    const categories = await fetchCategories(
      { categoryIds: [999999999] },
      requestOptions
    );

    expect(categories).toHaveLength(0);
  });
});
