import type { SpaceType } from "@/types";

export interface UpdateSpaceRequestDto {
  floorId?: string;
  name?: string;
  type?: SpaceType;
  capacity?: number;
  isActive?: boolean;
  assignedStaff?: string | null;
}
