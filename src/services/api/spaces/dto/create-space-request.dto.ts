import type { SpaceType } from "@/types";

export interface CreateSpaceRequestDto {
  floorId: string;
  name: string;
  type?: SpaceType;
  capacity?: number;
  isActive?: boolean;
  assignedStaff?: string | null;
}
