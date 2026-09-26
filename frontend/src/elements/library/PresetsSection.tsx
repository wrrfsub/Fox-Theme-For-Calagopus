import { faFloppyDisk, faPen, faTrash } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useEffect, useState } from 'react';
import { httpErrorToHuman } from '@/api/axios.ts';
import ActionIcon from '@/elements/ActionIcon.tsx';
import Button from '@/elements/Button.tsx';
import Card from '@/elements/Card.tsx';
import Group from '@/elements/Group.tsx';
import Switch from '@/elements/input/Switch.tsx';
import TextInput from '@/elements/input/TextInput.tsx';
import ConfirmationModal from '@/elements/modals/ConfirmationModal.tsx';
import { Modal, ModalFooter } from '@/elements/modals/Modal.tsx';
import Stack from '@/elements/Stack.tsx';
import Text from '@/elements/Text.tsx';
import Tooltip from '@/elements/Tooltip.tsx';
import { useToast } from '@/providers/ToastProvider.tsx';
import { createPreset, deletePreset, getPresets, updatePreset } from '../../api/library.ts';
import {
  builtinId,
  type CustomPreset,
  MAX_CUSTOM_PRESETS,
  PRESET_NAME_MAX,
  type PresetLibrary,
  presetNameProblem,
} from '../../lib/library.ts';
import { type NebulaTheme, normalizeTheme, PRESETS, pickUserTheme } from '../../lib/theme.ts';
import { useExtTranslations } from '../../translations.ts';
import Swatches from './Swatches.tsx';

// the toggle and buttons sit inside the clickable card; clicks on them must not apply the preset
const CONTROL = 'data-preset-control';

function NameModal({
  opened,
  title,
  initial,
  onClose,
  onSubmit,
}: {
  opened: boolean;
  title: string;
  initial: string;
  onClose: () => void;
  onSubmit: (name: string) => Promise<unknown>;
}) {
  const { t } = useExtTranslations();
  const [name, setName] = useState(initial);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (opened) setName(initial);
  }, [opened, initial]);

  const problem = presetNameProblem(name);
  const submit = () => {
    if (problem) return;
    setSaving(true);
    onSubmit(name.trim())
      .then(onClose)
      .catch(() => {
        // the caller already showed the error; the modal stays open to fix the name
      })
      .finally(() => setSaving(false));
  };

  return (
    <Modal opened={opened} onClose={onClose} title={title}>
      <TextInput
        label={t('library.name', {})}
        value={name}
        maxLength={PRESET_NAME_MAX}
        data-autofocus
        error={name && problem ? t(`library.nameProblem.${problem}`, { max: PRESET_NAME_MAX }) : undefined}
        onChange={(e) => setName(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
        }}
      />
      <ModalFooter>
        <Button disabled={!!problem} loading={saving} onClick={submit}>
          {t('library.save', {})}
        </Button>
        <Button variant='default' onClick={onClose}>
          {t('library.cancel', {})}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

function PresetCard({
  name,
  theme,
  users,
  disabled,
  onApply,
  onUsers,
  children,
}: {
  name: string;
  theme: Partial<NebulaTheme>;
  users: boolean;
  disabled: boolean;
  onApply: () => void;
  onUsers: (users: boolean) => void;
  children?: React.ReactNode;
}) {
  const { t } = useExtTranslations();

  return (
    <Card
      hoverable
      p='sm'
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest(`[${CONTROL}]`)) onApply();
      }}
    >
      <Group justify='space-between' wrap='nowrap'>
        <Text fw={600} truncate>
          {name}
        </Text>
        <Swatches theme={theme} />
      </Group>
      <Group justify='space-between' wrap='nowrap' mt='xs' gap='xs' {...{ [CONTROL]: true }}>
        <Switch
          size='xs'
          label={t('library.users', {})}
          checked={users}
          disabled={disabled}
          onChange={(e) => onUsers(e.currentTarget.checked)}
        />
        {children && (
          <Group gap={2} wrap='nowrap'>
            {children}
          </Group>
        )}
      </Group>
    </Card>
  );
}

/**
 * The editor's Presets section: the admin's own presets (full themes kept server side, applied as a look
 * over the draft) above the built-in colour sets, each with the toggle that offers it to users.
 */
export default function PresetsSection({
  theme,
  set,
}: {
  theme: NebulaTheme;
  set: (patch: Partial<NebulaTheme>) => void;
}) {
  const { t } = useExtTranslations();
  const { addToast } = useToast();
  const [library, setLibrary] = useState<PresetLibrary | null>(null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<CustomPreset | null>(null);
  const [deleting, setDeleting] = useState<CustomPreset | null>(null);

  useEffect(() => {
    getPresets()
      .then(setLibrary)
      .catch((err) => addToast(httpErrorToHuman(err), 'error'));
  }, []);

  /** Every change answers with the stored library; a failure is shown and rethrown for the modals. */
  const run = (request: Promise<PresetLibrary>) => {
    setBusy(true);
    return request
      .then(setLibrary)
      .catch((err) => {
        addToast(httpErrorToHuman(err), 'error');
        throw err;
      })
      .finally(() => setBusy(false));
  };

  const full = (library?.custom.length ?? 0) >= MAX_CUSTOM_PRESETS;

  return (
    <Stack gap='md'>
      <Button
        variant='light'
        leftSection={<FontAwesomeIcon icon={faFloppyDisk} />}
        disabled={!library || full}
        onClick={() => setCreating(true)}
      >
        {t('library.saveAsPreset', {})}
      </Button>
      {full && (
        <Text size='xs' c='dimmed'>
          {t('library.limit', { max: MAX_CUSTOM_PRESETS })}
        </Text>
      )}

      {library && (
        <Stack gap='xs'>
          <Text size='xs' fw={600} tt='uppercase' c='dimmed' className='tracking-wider'>
            {t('library.custom', {})}
          </Text>
          {library.custom.length === 0 && (
            <Text size='sm' c='dimmed'>
              {t('library.empty', {})}
            </Text>
          )}
          {library.custom.map((preset) => (
            <PresetCard
              key={preset.id}
              name={preset.name}
              theme={preset.theme}
              users={preset.users}
              disabled={busy}
              onApply={() => set(pickUserTheme(preset.theme))}
              onUsers={(users) =>
                run(updatePreset(preset.id, { users })).catch(() => {
                  // run() already showed the error
                })
              }
            >
              <Tooltip label={t('library.rename', {})}>
                <ActionIcon
                  variant='subtle'
                  color='gray'
                  size='sm'
                  aria-label={t('library.rename', {})}
                  onClick={() => setRenaming(preset)}
                >
                  <FontAwesomeIcon icon={faPen} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label={t('library.delete', {})}>
                <ActionIcon
                  variant='subtle'
                  color='red'
                  size='sm'
                  aria-label={t('library.delete', {})}
                  onClick={() => setDeleting(preset)}
                >
                  <FontAwesomeIcon icon={faTrash} />
                </ActionIcon>
              </Tooltip>
            </PresetCard>
          ))}
        </Stack>
      )}

      <Stack gap='xs'>
        <Text size='xs' fw={600} tt='uppercase' c='dimmed' className='tracking-wider'>
          {t('library.builtin', {})}
        </Text>
        {PRESETS.map((preset) => {
          const id = builtinId(preset.name);
          return (
            <PresetCard
              key={id}
              name={preset.name}
              theme={preset.theme}
              users={library?.builtin.includes(id) ?? false}
              disabled={!library || busy}
              onApply={() => set(preset.theme)}
              onUsers={(users) =>
                run(updatePreset(id, { users })).catch(() => {
                  // run() already showed the error
                })
              }
            />
          );
        })}
      </Stack>

      <Text size='xs' c='dimmed'>
        {t('library.saveAsPresetDescription', {})}
      </Text>

      <NameModal
        opened={creating}
        title={t('library.saveAsPreset', {})}
        initial=''
        onClose={() => setCreating(false)}
        onSubmit={(name) =>
          run(createPreset(name, normalizeTheme(theme))).then(() => addToast(t('library.created', {}), 'success'))
        }
      />
      <NameModal
        opened={!!renaming}
        title={t('library.renameTitle', {})}
        initial={renaming?.name ?? ''}
        onClose={() => setRenaming(null)}
        onSubmit={(name) => (renaming ? run(updatePreset(renaming.id, { name })) : Promise.resolve())}
      />
      <ConfirmationModal
        opened={!!deleting}
        onClose={() => setDeleting(null)}
        title={t('library.deleteTitle', {})}
        confirm={t('library.delete', {})}
        onConfirmed={() => {
          if (!deleting) return;
          run(deletePreset(deleting.id))
            .then(() => setDeleting(null))
            .catch(() => {
              // run() already showed the error; the modal stays open
            });
        }}
      >
        {t('library.deleteConfirm', { name: deleting?.name ?? '' })}
      </ConfirmationModal>
    </Stack>
  );
}
