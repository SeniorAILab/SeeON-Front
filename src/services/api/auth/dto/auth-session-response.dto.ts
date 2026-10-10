export interface AuthUserResponseDto {
  id: string;
  email?: string | null;
  nickname?: string | null;
  role?: string | null;
  facilityId?: string | null;
}

export interface AuthSessionResponseDto {
  user?: AuthUserResponseDto | null;
}
