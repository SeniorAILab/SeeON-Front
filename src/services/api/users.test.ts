import { beforeEach, describe, expect, it, vi } from "vitest";
import { createUser, listUsers, updateUserRole } from "./users";

const user = {
  id: "user-1",
  name: "관리자",
  email: "admin@example.test",
  role: "ADMIN",
  facilityId: "facility-1",
};

function respond(body: unknown) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

describe("user endpoint mapping", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("preserves returned user fields and normalizes an absent facility to null", async () => {
    const unassignedUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    };
    respond([user, unassignedUser]);

    expect(await listUsers()).toEqual([
      user,
      { ...unassignedUser, facilityId: null },
    ]);
  });

  it.each([null, {}, "users"])("rejects a non-array users response: %j", async (body) => {
    respond(body);

    await expect(listUsers()).rejects.toThrow("Invalid users response");
  });

  it.each([
    null,
    [],
    { ...user, id: 1 },
    { ...user, name: null },
    { ...user, email: false },
    { ...user, role: "UNKNOWN" },
  ])("rejects a malformed user: %j", async (body) => {
    respond([body]);

    await expect(listUsers()).rejects.toThrow("Invalid user response");
  });

  it("sends the creation payload unchanged and returns the initial password", async () => {
    const fetchMock = respond({ user, initialPassword: "one-time-password" });
    const input = { name: user.name, email: user.email, role: "ADMIN" } as const;

    expect(await createUser(input)).toEqual({
      user,
      initialPassword: "one-time-password",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/v1\/users$/),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(input),
        credentials: "include",
      }),
    );
  });

  it.each([{}, { user, initialPassword: null }, { user, initialPassword: 123 }])(
    "rejects a non-string initial password: %j",
    async (body) => {
      respond(body);

      await expect(createUser({ name: user.name, email: user.email, role: "ADMIN" }))
        .rejects.toThrow("Invalid create user response");
    },
  );

  it("encodes the user id and preserves PATCH role semantics", async () => {
    const fetchMock = respond({ ...user, role: "STAFF" });

    expect(await updateUserRole("user/a b", "STAFF")).toEqual({
      ...user,
      role: "STAFF",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/users\/user%2Fa%20b\/role$/),
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ role: "STAFF" }),
        credentials: "include",
      }),
    );
  });

  it("propagates transport errors without replacing them", async () => {
    const error = new Error("connection failed");
    vi.spyOn(globalThis, "fetch").mockRejectedValue(error);

    await expect(listUsers()).rejects.toBe(error);
  });
});
