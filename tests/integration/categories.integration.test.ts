import { describe, it, expect, afterAll } from 'vitest';
import {
  saveCategory,
  deleteCategory,
  fetchCategory,
  fetchCategories,
  submitEntity,
  deleteEntity,
  ShopwaveApiError,
} from '../../src/core';
import { requestOptions, uniqueId } from './setup';

describe.sequential('Categories API Integration', () => {
  let createdCategoryId: number | null = null;
  let legacyCategoryId: number | null = null;
  const testCategoryTitle = uniqueId('Test_Category');

  afterAll(async () => {
    for (const id of [createdCategoryId, legacyCategoryId]) {
      if (id === null) continue;
      try {
        await deleteCategory(id, requestOptions);
      } catch (error) {
        console.warn(`Cleanup: Failed to delete category ${id}`, error);
      }
    }
  });

  it('creates a category and returns it with its id (saveCategory)', async () => {
    const saved = await saveCategory({ title: testCategoryTitle, parentId: null, type: 1 }, requestOptions);

    expect(saved.id).toBeTypeOf('number');
    expect(saved.id).toBeGreaterThan(0);
    expect(saved.title).toBe(testCategoryTitle);

    createdCategoryId = saved.id;
  });

  it('reads it back by id (GET /api/categories/:id) and by filter', async () => {
    expect(createdCategoryId).not.toBeNull();

    const one = await fetchCategory(createdCategoryId!, {}, requestOptions);
    expect(one?.id).toBe(createdCategoryId);
    expect(one?.title).toBe(testCategoryTitle);

    const list = await fetchCategories({ categoryIds: [createdCategoryId!] }, requestOptions);
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe(testCategoryTitle);
  });

  it('updates it and returns the saved values', async () => {
    expect(createdCategoryId).not.toBeNull();
    const updatedTitle = uniqueId('Updated_Category');

    const saved = await saveCategory(
      { id: createdCategoryId!, title: updatedTitle, parentId: null, type: 2 },
      requestOptions
    );
    expect(saved.id).toBe(createdCategoryId);
    expect(saved.title).toBe(updatedTitle);
    expect(saved.type).toBe(2);

    const reread = await fetchCategory(createdCategoryId!, {}, requestOptions);
    expect(reread?.title).toBe(updatedTitle);
    expect(reread?.type).toBe(2);
  });

  it('deletes it (205, soft delete)', async () => {
    expect(createdCategoryId).not.toBeNull();
    const deletedId = createdCategoryId!;

    await expect(deleteCategory(deletedId, requestOptions)).resolves.toBeUndefined();
    createdCategoryId = null;

    const deleted = await fetchCategories({ categoryIds: [deletedId], deleted: true }, requestOptions);
    expect(deleted).toHaveLength(1);
    expect(deleted[0].deleteDate).toBeTruthy();

    await expect(fetchCategory(deletedId, {}, requestOptions)).resolves.toBeNull();
    const withDeleted = await fetchCategory(deletedId, { deleted: true }, requestOptions);
    expect(withDeleted?.id).toBe(deletedId);
  });

  it('delete of an unknown id still resolves (the API answers 205)', async () => {
    await expect(deleteCategory(999999999, requestOptions)).resolves.toBeUndefined();
  });

  it('does not return unknown ids', async () => {
    const categories = await fetchCategories({ categoryIds: [999999999] }, requestOptions);
    expect(categories).toHaveLength(0);
  });

  it('still accepts the old { categories: { new } } body through submitEntity', async () => {
    const title = uniqueId('Legacy_Category');
    const body = await submitEntity<{ categories: Record<string, { id: number; title: string }> }>(
      { endpoint: '/api/categories', method: 'POST', payload: { categories: { new: { title, parentId: null, type: 1 } } } },
      requestOptions
    );
    const echoed = Object.values(body?.categories ?? {})[0];
    expect(echoed?.id).toBeTypeOf('number');
    expect(echoed?.title).toBe(title);
    legacyCategoryId = echoed.id;

    await deleteEntity('categories', legacyCategoryId, requestOptions);
    legacyCategoryId = null;
  });

  it('reports errors as ShopwaveApiError with an HTTP status', async () => {
    const error = await fetchCategories({}, { ...requestOptions, token: 'not-a-real-token' }).catch((e) => e);
    expect(error).toBeInstanceOf(ShopwaveApiError);
    expect(error.status).toBeGreaterThanOrEqual(200);
  });
});
