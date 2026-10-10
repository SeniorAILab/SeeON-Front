import type { Role, User } from "@/types";

export interface CreateUserInput {
  name: string;
  email: string;
  role: Exclude<Role, "SUPER_ADMIN">;
}

export interface CreateUserResult {
  user: User;
  initialPassword: string;
}
