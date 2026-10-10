import type { Role } from "@/types";

export interface UserDto {
  id: string;
  name: string;
  email: string;
  role: Role;
  facilityId?: string | null;
}

export interface CreateUserResponseDto {
  user?: unknown;
  initialPassword?: unknown;
}
