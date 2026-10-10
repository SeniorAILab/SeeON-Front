import type { OwnershipTransferKind } from "@/types/edgeEnrollment";

export interface OwnershipTransferManifestItemDto {
  readonly kind: OwnershipTransferKind;
  readonly edgeRef: string;
  readonly canonicalId: string;
  readonly parentCanonicalId: string | null;
}

export interface TransferEdgeOwnershipRequestDto {
  readonly schemaVersion: 1;
  readonly expectedEnrollmentGeneration: number;
  readonly expectedServerRevision: number;
  readonly manifestDigest: string;
  readonly manifest: readonly OwnershipTransferManifestItemDto[];
}
