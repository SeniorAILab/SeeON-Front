import {
  createUser as createUserEndpoint,
  listUsers,
  updateUserRole,
} from "@/services/api/users";
import type { CreateUserInput, CreateUserResult } from "@/types/user";

export const userService = {
  createUser(input: CreateUserInput): Promise<CreateUserResult> {
    return createUserEndpoint(input);
  },
  listUsers,
  updateUserRole,
};
