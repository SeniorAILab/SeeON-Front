export interface RevokeEdgeCredentialRequestDto {
  schemaVersion: 1;
  expectedLifecycle: "ACTIVE" | "GRACE";
  reason: "ADMIN_REVOKED";
}
