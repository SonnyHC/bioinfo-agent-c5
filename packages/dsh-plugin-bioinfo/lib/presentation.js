// Public deployment defaults for the pinned Harness release. Credentials and
// model providers remain entirely owned by the official Models settings.
export const presentationOverlay = `- id: agent-preset-registry
  config:
    default: bioinfo-c5
- id: ui-settings-models
  config:
    credentialOnboarding: true
- id: ui-settings-account
  disabled: true
- id: ui-brand-official
  disabled: true
- id: ui-settings-general
  config:
    welcomeNoticeVersion: "2026-09-28.1"
`;
