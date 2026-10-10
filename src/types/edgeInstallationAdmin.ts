import type {
  EdgeOperationSummary,
  OwnershipTransferKind,
} from "./edgeEnrollment";
import type { OneTimeCredential } from "@/lib/edgeCredential";

type ReplacementBase = {
  readonly operation: EdgeOperationSummary;
  readonly edgeInstallationId: string;
  readonly previousEnrollmentGeneration: number;
  readonly enrollmentGeneration: number;
  readonly installationState: "PENDING_CLAIM";
};

export type ReplacedEdgeInstallation =
  | (ReplacementBase & {
      readonly kind: "initial";
      readonly oneTimeCredential: OneTimeCredential;
    })
  | (ReplacementBase & {
      readonly kind: "replay";
      readonly replacementTokenId: string;
      readonly replacementPrefix: string;
    });

export type OwnershipTransferManifestItem = {
  readonly kind: OwnershipTransferKind;
  readonly edgeRef: string;
  readonly canonicalId: string;
  readonly parentCanonicalId: string | null;
};

export type InstallationMutationRequest = {
  readonly edgeInstallationId: string;
  readonly idempotencyKey: string;
  readonly signal?: AbortSignal;
};

export type ReplaceEdgeInstallationRequest = InstallationMutationRequest & {
  readonly expectedEnrollmentGeneration: number;
  readonly newClientInstallationRef: string;
};

export type TransferEdgeOwnershipRequest = InstallationMutationRequest & {
  readonly expectedEnrollmentGeneration: number;
  readonly expectedServerRevision: number;
  readonly manifestDigest: string;
  readonly manifest: readonly OwnershipTransferManifestItem[];
};

export type EdgeOwnershipTransfer = {
  readonly operation: EdgeOperationSummary;
  readonly edgeInstallationId: string;
  readonly enrollmentGeneration: number;
  readonly serverRevision: number;
  readonly transferred: {
    readonly floors: number;
    readonly rooms: number;
    readonly cameras: number;
  };
  readonly appliedAt: string;
};
