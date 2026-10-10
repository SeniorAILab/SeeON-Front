import type { Role } from "@/types";

export interface CreateUserRequestDto {
  name: string;
  email: string;
  role: Exclude<Role, "SUPER_ADMIN">;
}
