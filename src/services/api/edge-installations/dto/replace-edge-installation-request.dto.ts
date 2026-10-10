export interface ReplaceEdgeInstallationRequestDto {
  readonly schemaVersion: 1;
  readonly expectedEnrollmentGeneration: number;
  readonly newClientInstallationRef: string;
}
