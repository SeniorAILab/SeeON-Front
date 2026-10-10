import { requestJson } from "@/services/apiClient";
import type { CreateUserRequestDto } from "./users/dto/create-user-request.dto";
import type { UpdateUserRoleRequestDto } from "./users/dto/update-user-role-request.dto";
import type { CreateUserResponseDto, UserDto } from "./users/dto/user-response.dto";
import type { Role, User } from "@/types";
import type { CreateUserResult } from "@/types/user";

function isRole(value: unknown): value is Role {
  return value === "SUPER_ADMIN" || value === "ADMIN" || value === "STAFF";
}

function mapUser(value: unknown): User {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    typeof (value as UserDto).id !== "string" ||
    typeof (value as UserDto).name !== "string" ||
    typeof (value as UserDto).email !== "string" ||
    !isRole((value as UserDto).role)
  ) {
    throw new Error("Invalid user response");
  }
  const dto = value as UserDto;
  return {
    id: dto.id,
    name: dto.name,
    email: dto.email,
    role: dto.role,
    facilityId: dto.facilityId ?? null,
  };
}

export async function listUsers(): Promise<User[]> {
  const body = await requestJson("/users");
  if (!Array.isArray(body)) throw new Error("Invalid users response");
  return body.map(mapUser);
}

export async function createUser(input: CreateUserRequestDto): Promise<CreateUserResult> {
  const body = await requestJson("/users", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (
    typeof body !== "object" ||
    body === null ||
    Array.isArray(body)
  ) {
    throw new Error("Invalid create user response");
  }
  const dto = body as CreateUserResponseDto;
  if (typeof dto.initialPassword !== "string") {
    throw new Error("Invalid create user response");
  }
  return {
    user: mapUser(dto.user),
    initialPassword: dto.initialPassword,
  };
}

export async function updateUserRole(id: string, role: Exclude<Role, "SUPER_ADMIN">): Promise<User> {
  return mapUser(
    await requestJson(`/users/${encodeURIComponent(id)}/role`, {
      method: "PATCH",
      body: JSON.stringify({ role } satisfies UpdateUserRoleRequestDto),
    }),
  );
}
