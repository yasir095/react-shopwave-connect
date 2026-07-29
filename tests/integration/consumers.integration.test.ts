import { describe, it, expect, afterAll } from 'vitest';
import { submitEntity, deleteEntity } from '../../src/core/entity';
import { fetchConsumers, type Consumer } from '../../src/core/consumer';
import { requestOptions, uniqueId, uniqueEmail } from './setup';

describe.sequential('Consumers API Integration', () => {
  // Shared variable to store the created consumer ID across tests
  let createdConsumerId: number | null = null;

  // Test data with unique identifiers to prevent collisions
  const testFirstName = uniqueId('TestFirst');
  const testLastName = uniqueId('TestLast');
  const testEmail = uniqueEmail('consumer');

  afterAll(async () => {
    // Cleanup: delete the created consumer even if tests fail
    if (createdConsumerId !== null) {
      try {
        await deleteEntity('consumer', createdConsumerId, requestOptions);
      } catch (error) {
        console.warn(`Cleanup: Failed to delete consumer ${createdConsumerId}`, error);
      }
    }
  });

  it('should create a new consumer (POST)', async () => {
    const payload = {
      firstName: testFirstName,
      lastName: testLastName,
      email: testEmail,
    };

    const result = await submitEntity<Consumer>(
      {
        endpoint: '/api/consumer',
        method: 'POST',
        payload,
      },
      requestOptions
    );

    expect(result).toBeDefined();
    expect(result?.id).toBeTypeOf('number');
    expect(result?.firstName).toBe(testFirstName);
    expect(result?.lastName).toBe(testLastName);
    expect(result?.email).toBe(testEmail);

    // Store the ID for subsequent tests
    createdConsumerId = result!.id;
  });

  it('should read the created consumer (GET)', async () => {
    expect(createdConsumerId).not.toBeNull();

    const consumers = await fetchConsumers(
      [createdConsumerId!],
      requestOptions
    );

    expect(consumers).toHaveLength(1);
    expect(consumers[0].id).toBe(createdConsumerId);
    expect(consumers[0].firstName).toBe(testFirstName);
    expect(consumers[0].lastName).toBe(testLastName);
    expect(consumers[0].email).toBe(testEmail);
  });

  it('should update the consumer (PUT)', async () => {
    expect(createdConsumerId).not.toBeNull();

    const updatedFirstName = uniqueId('UpdatedFirst');
    const payload = {
      id: createdConsumerId,
      firstName: updatedFirstName,
      lastName: testLastName,
      email: testEmail,
    };

    const result = await submitEntity<Consumer>(
      {
        endpoint: `/api/consumer/${createdConsumerId}`,
        method: 'PUT',
        payload,
      },
      requestOptions
    );

    expect(result).toBeDefined();
    expect(result?.firstName).toBe(updatedFirstName);

    // Re-fetch to verify the change persisted
    const consumers = await fetchConsumers(
      [createdConsumerId!],
      requestOptions
    );

    expect(consumers).toHaveLength(1);
    expect(consumers[0].firstName).toBe(updatedFirstName);
  });

  it('should delete the consumer (DELETE)', async () => {
    expect(createdConsumerId).not.toBeNull();

    // Delete should complete without throwing
    await expect(
      deleteEntity('consumer', createdConsumerId!, requestOptions)
    ).resolves.toBeUndefined();

    // Mark as cleaned up so afterAll doesn't try to delete again
    const deletedId = createdConsumerId;
    createdConsumerId = null;

    // Verify deletion: fetching deleted consumer should return empty array
    const consumers = await fetchConsumers(
      [deletedId!],
      requestOptions
    );

    expect(consumers).toHaveLength(0);
  });
});
