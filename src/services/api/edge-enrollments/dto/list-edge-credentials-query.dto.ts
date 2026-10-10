import type { EdgeCredentialLifecycle } from "@/types/edgeEnrollment";

export interface ListEdgeCredentialsQueryDto {
  facilityId?: string;
  lifecycle?: EdgeCredentialLifecycle;
}
