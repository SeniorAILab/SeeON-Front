export interface AlertSettings {
  notificationEmail: string | null;
  emailAlertsEnabled: boolean;
  effectiveEmail: string | null;
}

export type UpdateAlertSettingsInput = Partial<{
  notificationEmail: string | null;
  emailAlertsEnabled: boolean;
}>;
