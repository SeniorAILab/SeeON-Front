export interface CameraResponseDto {
  id: string;
  facilityId: string;
  spaceId: string;
  online: boolean;
  lastSeenAt: string | null;
}
