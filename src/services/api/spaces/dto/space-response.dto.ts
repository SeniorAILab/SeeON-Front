import type { ProvisioningSource, SpaceType } from "@/types";

export interface BackendSpaceDto {
  id: string;
  facilityId: string;
  floorId: string;
  name: string;
  type: SpaceType;
  capacity: number;
  isActive: boolean;
  assignedStaff?: string | null;
  provisioningSource: ProvisioningSource;
}
