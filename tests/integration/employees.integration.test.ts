import { describe, it, expect, afterAll } from 'vitest';
import { saveEmployee, deleteEmployee, fetchEmployee, fetchEmployees } from '../../src/core';
import { requestOptions, uniqueId, uniqueEmail } from './setup';

// Shopwave employees: POST creates (no id) or updates roleId / joinedDate /
// exitDate (with id) — names and email can't be changed. There is no DELETE:
// deleteEmployee retires the employee by setting exitDate.
describe.sequential('Employees API Integration', () => {
  let createdEmployeeId: number | null = null;
  const testFirstName = uniqueId('TestEmployee');
  const testLastName = uniqueId('TestLast');
  const testEmail = uniqueEmail('employee');

  afterAll(async () => {
    if (createdEmployeeId !== null) {
      try {
        await deleteEmployee(createdEmployeeId, requestOptions);
      } catch (error) {
        console.warn(`Cleanup: Failed to retire employee ${createdEmployeeId}`, error);
      }
    }
  });

  it('creates an employee and returns it with its id (saveEmployee)', async () => {
    const saved = await saveEmployee(
      { firstName: testFirstName, lastName: testLastName, email: testEmail, roleId: 3 }, // Assistant
      requestOptions
    );

    expect(saved.id).toBeTypeOf('number');
    expect(saved.id).toBeGreaterThan(0);
    createdEmployeeId = saved.id;
  });

  it('reads it back by id and by filter', async () => {
    expect(createdEmployeeId).not.toBeNull();

    const one = await fetchEmployee(createdEmployeeId!, {}, requestOptions);
    expect(one?.id).toBe(createdEmployeeId);
    expect(one?.firstName).toBe(testFirstName);
    expect(one?.lastName).toBe(testLastName);

    const list = await fetchEmployees({ employeeIds: [createdEmployeeId!] }, requestOptions);
    expect(list).toHaveLength(1);
    expect(Number(list[0].roleId)).toBe(3);
  });

  it('updates the role (the updatable fields are roleId, joinedDate, exitDate)', async () => {
    expect(createdEmployeeId).not.toBeNull();

    const saved = await saveEmployee({ id: createdEmployeeId!, roleId: 2 }, requestOptions); // Manager
    expect(saved.id).toBe(createdEmployeeId);

    const reread = await fetchEmployee(createdEmployeeId!, {}, requestOptions);
    expect(Number(reread?.roleId)).toBe(2);
    expect(reread?.firstName).toBe(testFirstName); // unchanged
  });

  it('retires it (deleteEmployee sets exitDate; the API has no employee DELETE)', async () => {
    expect(createdEmployeeId).not.toBeNull();
    const retiredId = createdEmployeeId!;

    await expect(deleteEmployee(retiredId, requestOptions)).resolves.toBeUndefined();
    createdEmployeeId = null;

    const reread = await fetchEmployee(retiredId, { deleted: true }, requestOptions);
    expect(reread?.id).toBe(retiredId);
    expect(reread?.exitDate).toBeTruthy();
  });

  it('does not return unknown ids', async () => {
    const employees = await fetchEmployees({ employeeIds: [999999999] }, requestOptions);
    expect(employees).toHaveLength(0);
    await expect(fetchEmployee(999999999, {}, requestOptions)).resolves.toBeNull();
  });
});
