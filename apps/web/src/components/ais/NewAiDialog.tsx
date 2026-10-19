// effect-plain: the New AI wizard is plain React state over the shared hook; the orb PNG export is a browser promise edge.
import { Popover } from '@base-ui/react/popover';
import { Button } from '../ui/button';
import { Dialog } from '../ui/dialog';
import { DialogStepper } from '../ui/dialog-stepper';
import { KeyStep } from './new-ai/KeyStep';
import { ProviderStep } from './new-ai/ProviderStep';
import { Combobox } from '@/components/ui/combobox';
import { SegmentedControl, type SegmentedOption } from '@/components/ui/segmented-control';
import { useToast } from '@/components/ui/toast';
import { ApiError, listMachines, uploadAvatar, type PublicAi } from '@/lib/api';
import { callApi } from '@/lib/effect/api-client';
import { cn } from '@/lib/utils';
import { useChatStoreApi } from '@/store/ChatStoreProvider';
import {
  ORB_HUES,
  ORB_RIMS,
  type ChatSummary,
  AI_TEMPLATE_OPTIONS,
  clampOrbLight,
  orbDataUri,
  orbParamsFor,
  type OrbLight,
} from '@zilar/chat-core';
import {
  NEW_AI_STEPS,
  makeAisApi,
  useNewAiFlowState,
  type NewAiFlowPort,
  type NewAiStep,
} from '@zilar/client-core';
import { Cloud, Pencil, Power, RefreshCcw, Server, Shuffle, Sparkles } from 'lucide-react';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { describeAiError } from './errors';

const TEMPLATE_OPTIONS = AI_TEMPLATE_OPTIONS.filter((option) => option.id !== 'custom').map(
  (option) => ({ value: option.id, label: option.label }),
);

function ModelStep({ flow }: { flow: NewAiFlow }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end gap-3.5">
        <OrbPicker flow={flow} />
        <label className="flex min-w-0 flex-1 flex-col gap-2">
          <span className="text-[13px] font-medium">Name</span>
          <span className="well-surface flex h-10 items-center rounded-[10px] px-3">
            <input
              aria-label="Name"
              type="text"
              autoComplete="off"
              value={flow.name}
              maxLength={64}
              placeholder="Research helper"
              onChange={(event) => flow.setName(event.target.value)}
              className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-subtle-foreground"
            />
          </span>
        </label>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-[13px] font-medium">Model</span>
        {flow.modelOptions.length > 0 ? (
          <Combobox
            label="Model"
            options={flow.modelOptions}
            value={flow.model === '' ? null : flow.model}
            onValueChange={flow.setModel}
            placeholder="Search models"
            triggerPlaceholder="Choose a model"
          />
        ) : (
          <span className="well-surface flex h-10 items-center rounded-[10px] px-3">
            <input
              aria-label="Model"
              type="text"
              autoComplete="off"
              value={flow.model}
              maxLength={256}
              placeholder="Model id"
              onChange={(event) => flow.setModel(event.target.value)}
              className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-subtle-foreground"
            />
          </span>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-[13px] font-medium">Template</span>
        <SegmentedControl
          ariaLabel="Template"
          tone="choice"
          mode="radio"
          options={TEMPLATE_OPTIONS}
          value={flow.template}
          onChange={flow.setTemplate}
        />
      </div>
    </div>
  );
}

function computerOptions(cloudAvailable: boolean): SegmentedOption[] {
  return [
    { value: 'off', label: 'Off', icon: Power },
    { value: 'cloud', label: 'Zilar', icon: Cloud, disabled: !cloudAvailable },
    { value: 'runner', label: 'Machine', icon: Server },
    { value: 'auto', label: 'Auto', icon: Sparkles },
  ];
}

function MoneyField({
  label,
  value,
  error,
  onChange,
}: {
  label: string;
  value: string;
  error: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-[13px] font-medium">{label}</span>
      <span className="well-surface flex h-10 items-center gap-1.5 rounded-[10px] px-3">
        <span className="font-mono text-[14px] text-muted-foreground">$</span>
        <input
          aria-label={label}
          inputMode="decimal"
          value={value}
          placeholder="No limit"
          onChange={(event) => onChange(event.target.value)}
          className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-subtle-foreground"
        />
      </span>
      {error !== '' && (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      )}
    </label>
  );
}

function SetupStep({ flow }: { flow: NewAiFlow }) {
  const needsMachine = flow.computerMode === 'runner' || flow.computerMode === 'auto';

  return (
    <div className="flex flex-col gap-[18px]">
      <div className="flex flex-col gap-2">
        <span className="text-[13px] font-medium">Computer</span>
        <SegmentedControl
          ariaLabel="Computer"
          tone="choice"
          mode="radio"
          options={computerOptions(flow.cloudAvailable)}
          value={flow.computerMode}
          onChange={flow.setComputerMode}
        />
        {needsMachine && (
          <Combobox
            label="Machine"
            options={flow.machines
              .filter((machine) => machine.status === 'approved')
              .map((machine) => ({
                value: machine.id,
                label: machine.name,
                ...(machine.online === true ? { dot: 'online' as const } : {}),
              }))}
            value={flow.machineId}
            onValueChange={flow.setMachineId}
            placeholder="Search machines"
            triggerPlaceholder="Choose a machine"
          />
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <MoneyField label="Per day" value={flow.day} error={flow.dayError} onChange={flow.setDay} />
        <MoneyField
          label="Per month"
          value={flow.month}
          error={flow.monthError}
          onChange={flow.setMonth}
        />
      </div>
    </div>
  );
}

export function NewAiDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const storeApi = useChatStoreApi();

  const flow = useNewAiFlow({
    onClose,
    onCreated: (created: PublicAi) => {
      const summary: ChatSummary = {
        id: created.jid,
        title: created.name,
        kind: 'dm',
        isAI: true,
        space: 'personal',
        unread: 0,
        muted: false,
        online: false,
        createdAt: new Date(created.createdAt),
      };
      storeApi.setState((state) => ({
        chats: state.chats.some((chat) => chat.id === created.jid)
          ? state.chats
          : [summary, ...state.chats],
      }));
      onClose();
      navigate(`/c/${encodeURIComponent(created.jid)}`);
    },
  });

  return (
    <Dialog
      open
      onClose={flow.close}
      title="New AI"
      size="lg"
      busy={flow.busy}
      stepper={<DialogStepper steps={flow.steps} current={flow.step} onStep={flow.goToStep} />}
      error={flow.error === '' ? undefined : flow.error}
      onSubmit={(event) => {
        event.preventDefault();
        flow.primary();
      }}
      footer={
        <>
          {flow.step > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="lg"
              className="key-icon mr-auto text-foreground"
              disabled={flow.busy}
              onClick={flow.back}
            >
              Back
            </Button>
          )}
          <Button type="submit" size="lg" disabled={flow.primaryDisabled}>
            {flow.primaryLabel}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {flow.step === 0 && <ProviderStep keys={flow.keys} />}
        {flow.step === 1 && <KeyStep keys={flow.keys} />}
        {flow.step === 2 && <ModelStep flow={flow} />}
        {flow.step === 3 && <SetupStep flow={flow} />}
      </div>
    </Dialog>
  );
}

const ORB_PNG_SIDE = 256;
const CREATE_FAILED = 'Could not create the AI';
const PARTIAL_FAILURE =
  "AI created. Some settings could not be saved; change them in the AI's settings.";

type OrbParams = ReturnType<typeof orbParamsFor>;

const PORT: NewAiFlowPort = { ...makeAisApi(callApi), listMachines };

const STEP_INDEX: Record<NewAiStep, number> = { provider: 0, key: 1, model: 2, setup: 3 };

/** Renders the orb's SVG data URI to a 256×256 PNG; a null blob means the browser could not encode it. */
function orbPngBlob(params: OrbParams, idSeed: string): Promise<Blob | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = ORB_PNG_SIDE;
      canvas.height = ORB_PNG_SIDE;
      const context = canvas.getContext('2d');
      if (context === null) {
        resolve(null);
        return;
      }
      context.drawImage(image, 0, 0, ORB_PNG_SIDE, ORB_PNG_SIDE);
      canvas.toBlob((blob) => resolve(blob), 'image/png');
    };
    image.onerror = () => resolve(null);
    image.src = orbDataUri(params, idSeed);
  });
}

interface NewAiFlowOptions {
  onClose: () => void;
  onCreated: (created: PublicAi) => void;
}

function useNewAiFlow({ onClose, onCreated }: NewAiFlowOptions) {
  const toast = useToast();
  const [error, setError] = useState('');
  const flow = useNewAiFlowState(PORT, { orbName: (value) => value });
  const keys = flow.keys;

  const create = (): void => {
    setError('');
    void flow
      .create(async (created) => {
        const blob = await orbPngBlob(flow.orbParams, flow.name.trim());
        if (blob === null) return false;
        await uploadAvatar('ai', created.id, blob);
        return true;
      })
      .then((outcome) => {
        if (outcome === null || outcome.status !== 'created') return;
        if (outcome.partial) toast(PARTIAL_FAILURE);
        onCreated(outcome.ai);
      })
      .catch((cause: unknown) => {
        // A status of 0 means the create never reached the server; its ApiError text is not a
        // server answer, so show the same fixed sentence the old failure path showed.
        setError(
          cause instanceof ApiError && cause.status === 0
            ? CREATE_FAILED
            : describeAiError(cause, CREATE_FAILED).message,
        );
      });
  };

  const providerText = keys.providerText;
  const modelName =
    flow.modelOptions.find((option) => option.value === flow.model)?.label ?? flow.model;
  const modelLabel =
    providerText !== '' && modelName.startsWith(`${providerText} `)
      ? modelName.slice(providerText.length + 1)
      : modelName;

  return {
    ...flow,
    steps: [
      { label: 'Provider', value: providerText },
      { label: 'Key', value: 'Key' },
      { label: 'Model', value: modelLabel },
      { label: 'Setup' },
    ],
    step: STEP_INDEX[flow.step],
    goToStep: (index: number) => {
      const next = NEW_AI_STEPS[index];
      if (next !== undefined) flow.goToStep(next);
    },
    primary: (): void => {
      if (flow.step === 'key') keys.continueKey();
      else if (flow.step === 'setup') create();
      else if (flow.canContinue) flow.advance();
    },
    primaryLabel: keys.checkingKey ? 'Checking…' : flow.step === 'setup' ? 'Create AI' : 'Continue',
    primaryDisabled: flow.creating || keys.checkingKey || !flow.canContinue,
    busy: flow.creating,
    error,
    close: (): void => {
      keys.abandon();
      onClose();
    },
    cloudAvailable: flow.cloud,
    setOrbLight: (light: OrbLight) => flow.setOrbLight(light.angle, light.distance),
  };
}

type NewAiFlow = ReturnType<typeof useNewAiFlow>;

function OrbPicker({ flow }: { flow: NewAiFlow }) {
  const [open, setOpen] = useState(false);
  const dragging = useRef(false);
  const params = flow.orbParams;
  const seed = flow.name.trim() === '' ? 'ai' : flow.name;

  const place = (target: HTMLButtonElement, clientX: number, clientY: number): void => {
    const rect = target.getBoundingClientRect();
    const nx = ((clientX - rect.left) / rect.width) * 100 - 50;
    const ny = ((clientY - rect.top) / rect.height) * 100 - 50;
    const distance = Math.hypot(nx, ny);
    flow.setOrbLight(clampOrbLight(Math.atan2(ny, nx), distance / 100));
  };

  const lightX = 50 + Math.cos(params.angle) * params.distance * 100;
  const lightY = 50 + Math.sin(params.angle) * params.distance * 100;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        aria-label="Change the orb"
        className="relative size-16 shrink-0 rounded-full"
      >
        <img src={orbDataUri(params, seed)} alt="" className="size-16 rounded-full" />
        <span className="key-icon absolute -right-1 -bottom-1 flex size-5 items-center justify-center rounded-full">
          <Pencil className="size-2.5" aria-hidden="true" />
        </span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          side="bottom"
          align="start"
          sideOffset={8}
          collisionPadding={8}
          className="z-50"
        >
          <Popover.Popup className="w-[268px] rounded-[14px] border border-border-strong bg-surface p-3.5 shadow-[0_16px_40px_rgba(0,0,0,0.85)] outline-none">
            <div className="flex items-start gap-3">
              <button
                type="button"
                aria-label="Drag to move the light"
                onPointerDown={(event) => {
                  dragging.current = true;
                  event.currentTarget.setPointerCapture(event.pointerId);
                  place(event.currentTarget, event.clientX, event.clientY);
                }}
                onPointerMove={(event) => {
                  if (dragging.current) {
                    place(event.currentTarget, event.clientX, event.clientY);
                  }
                }}
                onPointerUp={() => {
                  dragging.current = false;
                }}
                onPointerCancel={() => {
                  dragging.current = false;
                }}
                className="relative size-28 shrink-0 touch-none rounded-full"
              >
                <img src={orbDataUri(params, seed)} alt="" className="size-28 rounded-full" />
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/90 shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"
                  style={{ left: `${lightX}%`, top: `${lightY}%` }}
                />
              </button>
              <div className="flex flex-1 flex-col items-end gap-2">
                <button
                  type="button"
                  aria-label="Shuffle"
                  title="Shuffle"
                  onClick={flow.shuffle}
                  className="key-icon flex size-8 items-center justify-center rounded-[10px]"
                >
                  <Shuffle className="size-3.5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label="Reset"
                  title="Reset"
                  onClick={flow.resetOrb}
                  className="key-icon flex size-8 items-center justify-center rounded-[10px]"
                >
                  <RefreshCcw className="size-3.5" aria-hidden="true" />
                </button>
              </div>
            </div>

            <div className="mt-3.5 flex flex-col gap-2">
              <span className="text-[13px] font-medium">Color</span>
              <div
                role="radiogroup"
                aria-label="Color"
                className="grid grid-cols-7 justify-items-center gap-2"
              >
                {ORB_HUES.map((hue) => {
                  const selected = Math.round(params.hue) === hue.value;
                  return (
                    <button
                      key={hue.value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      aria-label={hue.name}
                      onClick={() => flow.setOrbHue(hue.value)}
                      className={cn(
                        'size-[26px] rounded-full bg-cover',
                        selected && 'ring-2 ring-foreground',
                      )}
                      style={{
                        backgroundImage: `url("${orbDataUri({ ...params, hue: hue.value }, `${seed}-${hue.value}`)}")`,
                      }}
                    />
                  );
                })}
              </div>
            </div>

            <div className="mt-3.5 flex flex-col gap-2">
              <span className="text-[13px] font-medium">Light</span>
              <div
                role="radiogroup"
                aria-label="Light"
                className="grid grid-cols-7 justify-items-center gap-2"
              >
                {ORB_RIMS.map((rim) => {
                  const selected = Math.round(params.rim) === rim.value;
                  return (
                    <button
                      key={rim.value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      aria-label={rim.name}
                      onClick={() => flow.setOrbRim(rim.value)}
                      className={cn(
                        'size-[22px] rounded-full',
                        selected
                          ? 'ring-2 ring-foreground ring-offset-2 ring-offset-surface'
                          : 'ring-1 ring-white/20',
                      )}
                      style={{ background: `hsl(${rim.value} 90% 70%)` }}
                    />
                  );
                })}
              </div>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
