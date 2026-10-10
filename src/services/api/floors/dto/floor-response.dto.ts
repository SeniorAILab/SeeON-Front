import type { ProvisioningSource } from "@/types";

export interface BackendFloorDto {
  id: string;
  facilityId: string;
  name: string;
  orderIndex: number;
  provisioningSource: ProvisioningSource;
}
