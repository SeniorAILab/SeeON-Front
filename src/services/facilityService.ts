import { listFacilities } from "@/services/api/dashboardEndpoints";
import { getFacility, getFacilityEdgeStatus, updateFacility } from "@/services/api/facilities";
import type { Facility, FacilityEdgeStatus, FacilitySummary } from "@/types";

export const facilityService = {
  listFacilities(): Promise<FacilitySummary[]> {
    return listFacilities();
  },

  getFacility(id: string): Promise<Facility> {
    return getFacility(id);
  },

  getFacilityEdgeStatus(id: string): Promise<FacilityEdgeStatus> {
    return getFacilityEdgeStatus(id);
  },

  updateFacility(
    id: string,
    input: Pick<Facility, "name" | "address" | "phone">,
  ): Promise<Facility> {
    return updateFacility(id, input);
  },
};
