import { describe, it, expect } from 'vitest';
import { fetchConsumers, fetchConsumer, submitEntity, deleteEntity, ShopwaveApiError } from '../../src/core';
import { requestOptions } from './setup';

// Consumers are read-only in the Shopwave API (GET /consumer with an `ids`
// header). The SDK has no save/delete for them and the routes answer 405.
describe.sequential('Consumers API Integration', () => {
  it('returns [] / null for unknown ids', async () => {
    await expect(fetchConsumers([999999999], requestOptions)).resolves.toEqual([]);
    await expect(fetchConsumer(999999999, {}, requestOptions)).resolves.toBeNull();
  });

  it('makes no request for an empty id list', async () => {
    await expect(fetchConsumers([], requestOptions)).resolves.toEqual([]);
  });

  it('rejects writes and deletes with 405 (read-only entity)', async () => {
    const write = await submitEntity(
      { endpoint: '/api/consumer', method: 'POST', payload: { firstName: 'Nope' } },
      requestOptions
    ).catch((e) => e);
    expect(write).toBeInstanceOf(ShopwaveApiError);
    expect(write.status).toBe(405);

    const del = await deleteEntity('consumer', 1, requestOptions).catch((e) => e);
    expect(del).toBeInstanceOf(ShopwaveApiError);
    expect(del.status).toBe(405);
  });
});
