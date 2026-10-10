export interface CreateFacilityInput {
  readonly facilityName: string;
}

export interface LoginInput {
  readonly email: string;
  readonly password: string;
}

export interface RegisterInput {
  readonly name: string;
  readonly email: string;
  readonly password: string;
  readonly phone: string;
  readonly facilityName: string;
}
