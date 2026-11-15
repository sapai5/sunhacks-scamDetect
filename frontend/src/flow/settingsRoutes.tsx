// Settings wiring: the onboarding forms, reused to edit settings after setup. Kept apart from
// flow/routes.tsx (the call flow) on purpose. Saving goes back to Settings instead of onward.
import { useNavigate } from 'react-router';
import { syncSettings } from '../lib/api';
import { loadSettings, saveSettings } from '../lib/settings';
import O1FamilyContacts from '../screens/onboarding/O1FamilyContacts';
import O2SecretQuestion from '../screens/onboarding/O2SecretQuestion';

export const SETTINGS = {
  home: '/elder/settings',
  family: '/elder/settings/family',
  question: '/elder/settings/question',
} as const;

export function SettingsFamilyRoute() {
  const nav = useNavigate();
  return (
    <O1FamilyContacts
      initial={loadSettings().family}
      submitLabel="Save"
      onNext={(family) => {
        void syncSettings(saveSettings({ family }));
        nav(SETTINGS.home);
      }}
    />
  );
}

export function SettingsQuestionRoute() {
  const nav = useNavigate();
  const s = loadSettings();
  return (
    <O2SecretQuestion
      initial={{ question: s.question, answer: s.answer }}
      submitLabel="Save"
      onNext={(v) => {
        void syncSettings(saveSettings(v));
        nav(SETTINGS.home);
      }}
    />
  );
}
