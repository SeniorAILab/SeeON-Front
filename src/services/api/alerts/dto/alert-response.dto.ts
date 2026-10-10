import type { AlertStatus } from "@/types";

export interface BackendAlertDto {
  alertSeq: string | number;
  id: string;
  backendEventId?: string | null;
  facilityId: string;
  residentId: string | null;
  cameraId: string | null;
  spaceId: string | null;
  room?: string | null;
  space?: { name?: string | null } | null;
  type: string;
  probability: number;
  snapshotKey?: string | null;
  detectedAt: string;
  status: string;
  resident?: unknown | null;
}

interface AlertActorDto {
  nickname: string;
}

interface AlertResidentDto {
  name: string;
}

interface AlertSpaceDto {
  name: string;
}

export interface AlertDto {
  alertSeq?: string;
  id: string;
  backendEventId?: string | null;
  facilityId: string;
  residentId?: string | null;
  cameraId?: string | null;
  spaceId: string;
  room?: string;
  type?: string;
  probability: number;
  snapshotKey?: string | null;
  detectedAt: string;
  status?: AlertStatus;
  ackedById?: string | null;
  ackedAt?: string | null;
  ackedBy?: AlertActorDto | null;
  resolvedById?: string | null;
  resolvedAt?: string | null;
  resolvedBy?: AlertActorDto | null;
  resident?: AlertResidentDto | null;
  space?: AlertSpaceDto;
  createdAt?: string;
}
