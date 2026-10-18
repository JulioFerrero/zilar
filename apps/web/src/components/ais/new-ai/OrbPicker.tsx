import { Popover } from '@base-ui/react/popover';
import { Pencil, RefreshCcw, Shuffle } from 'lucide-react';
import { useRef, useState } from 'react';
import { ORB_HUES, ORB_RIMS, clampOrbLight, orbDataUri } from '@zilar/chat-core';
import { cn } from '@/lib/utils';
import type { NewAiFlow } from './useNewAiFlow';

export function OrbPicker({ flow }: { flow: NewAiFlow }) {
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
