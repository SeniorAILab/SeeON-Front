import type { CameraConnection } from "@/types";

export interface CameraStatus {
  id: string;
  facilityId: string;
  spaceId: string;
  online: boolean;
  lastSeenAt: string | null;
}

export interface SpaceFreshness {
  connection: CameraConnection;
  lastSeenAt: string | null;
}
