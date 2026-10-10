import {
  getAlertSettings as getAlertSettingsEndpoint,
  updateAlertSettings as updateAlertSettingsEndpoint,
} from "./api/alertSettings";
import type { AlertSettings, UpdateAlertSettingsInput } from "@/types/alertSettings";

export type { AlertSettings, UpdateAlertSettingsInput } from "@/types/alertSettings";

export function getAlertSettings(): Promise<AlertSettings> {
  return getAlertSettingsEndpoint();
}

export function updateAlertSettings(
  input: UpdateAlertSettingsInput,
): Promise<AlertSettings> {
  return updateAlertSettingsEndpoint(input);
}
