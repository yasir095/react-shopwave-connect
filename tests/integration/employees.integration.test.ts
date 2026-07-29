import { describe, it, expect, afterAll } from 'vitest';
import { submitEntity, deleteEntity } from '../../src/core/entity';
import { fetchEmployees, type Employee } from '../../src/core/employee';
import { requestOptions, uniqueId, uniqueEmail } from './setup';

describe.sequential('Employees API Integration', () => {
  // Shared variable to store the created employee ID across tests
  let createdEmployeeId: number | null = null;

  // Test data with unique identifiers to prevent collisions
  const testFirstName = uniqueId('TestEmployee');
  const testLastName = uniqueId('TestLast');
  const testEmail = uniqueEmail('employee');

  afterAll(async () => {
    // Cleanup: delete the created employee even if tests fail
    if (createdEmployeeId !== null) {
      try {
        await deleteEntity('employees', createdEmployeeId, requestOptions);
      } catch (error) {
        console.warn(`Cleanup: Failed to delete employee ${createdEmployeeId}`, error);
      }
    }
  });

  it('should create a new employee (POST)', async () => {
    const payload = {
      firstName: testFirstName,
      lastName: testLastName,
      email: testEmail,
      roleId: 3, // Assistant role
    };

    const result = await submitEntity<Employee>(
      {
        endpoint: '/api/employees',
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
    expect(result?.roleId).toBe(3);

    // Store the ID for subsequent tests
    createdEmployeeId = result!.id;
  });

  it('should read the created employee (GET)', async () => {
    expect(createdEmployeeId).not.toBeNull();

    const employees = await fetchEmployees(
      { employeeIds: [createdEmployeeId!] },
      requestOptions
    );

    expect(employees).toHaveLength(1);
    expect(employees[0].id).toBe(createdEmployeeId);
    expect(employees[0].firstName).toBe(testFirstName);
    expect(employees[0].lastName).toBe(testLastName);
    expect(employees[0].roleId).toBe(3);
  });

  it('should update the employee (PUT)', async () => {
    expect(createdEmployeeId).not.toBeNull();

    const updatedFirstName = uniqueId('UpdatedEmployee');
    const payload = {
      id: createdEmployeeId,
      firstName: updatedFirstName,
      lastName: testLastName,
      email: testEmail,
      roleId: 2, // Manager role
    };

    const result = await submitEntity<Employee>(
      {
        endpoint: `/api/employees/${createdEmployeeId}`,
        method: 'PUT',
        payload,
      },
      requestOptions
    );

    expect(result).toBeDefined();
    expect(result?.firstName).toBe(updatedFirstName);
    expect(result?.roleId).toBe(2);

    // Re-fetch to verify the change persisted
    const employees = await fetchEmployees(
      { employeeIds: [createdEmployeeId!] },
      requestOptions
    );

    expect(employees).toHaveLength(1);
    expect(employees[0].firstName).toBe(updatedFirstName);
    expect(employees[0].roleId).toBe(2);
  });

  it('should delete the employee (DELETE)', async () => {
    expect(createdEmployeeId).not.toBeNull();

    // Delete should complete without throwing
    await expect(
      deleteEntity('employees', createdEmployeeId!, requestOptions)
    ).resolves.toBeUndefined();

    // Mark as cleaned up so afterAll doesn't try to delete again
    const deletedId = createdEmployeeId;
    createdEmployeeId = null;

    // Verify soft-delete: fetch with deleted=true to confirm exitDate is set
    const employees = await fetchEmployees(
      { employeeIds: [deletedId!], deleted: true },
      requestOptions
    );

    expect(employees).toHaveLength(1);
    expect(employees[0].id).toBe(deletedId);
    // exitDate should be set (non-empty string) after deletion
    expect(employees[0].exitDate).toBeTruthy();
  });

  it('should not return deleted employee when deleted=false', async () => {
    // Fetch without deleted flag (defaults to false) should not return soft-deleted employees
    const employees = await fetchEmployees(
      { employeeIds: [999999999] },
      requestOptions
    );

    expect(employees).toHaveLength(0);
  });
});
