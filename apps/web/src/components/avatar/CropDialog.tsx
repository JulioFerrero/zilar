import { useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import {
  AVATAR_CROP_VIEW_SIDE,
  clampOffset,
  clampZoom,
  fitInView,
  type CropState,
} from '@/lib/avatar-crop';
import type { ImageSize } from './avatarImageCodec';

/** Clamps a crop state to the usable bounds for the given source image. */
export function applyCrop(source: ImageSize, state: CropState): CropState {
  const offset = clampOffset(source, state);
  return { zoom: clampZoom(state.zoom), offsetX: offset.offsetX, offsetY: offset.offsetY };
}

interface CropDialogProps {
  crop: CropState;
  natural: ImageSize;
  objectUrl: string;
  busy: boolean;
  imageRef: React.RefObject<HTMLImageElement | null>;
  onCropChange: React.Dispatch<React.SetStateAction<CropState>>;
  onSave: () => void;
  onClose: () => void;
}

/**
 * The crop dialog: the picked image under a circular mask, drag to position
 * and a zoom slider. The parent owns the phase, seed and crop state; this
 * renders the dialog and reports crop changes back through `onCropChange`.
 */
export function CropDialog({
  crop,
  natural,
  objectUrl,
  busy,
  imageRef,
  onCropChange,
  onSave,
  onClose,
}: CropDialogProps) {
  const dragRef = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
    dragRef.current = {
      x: event.clientX,
      y: event.clientY,
      offsetX: crop.offsetX,
      offsetY: crop.offsetY,
    };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const start = dragRef.current;
    if (start === null) {
      return;
    }
    onCropChange((current) => {
      const next = {
        ...current,
        offsetX: start.offsetX + (event.clientX - start.x),
        offsetY: start.offsetY + (event.clientY - start.y),
      };
      return applyCrop(natural, next);
    });
  };

  const onPointerUp = (): void => {
    dragRef.current = null;
  };

  const fitted = fitInView(natural);
  const zoomed = { width: fitted.width * crop.zoom, height: fitted.height * crop.zoom };

  return (
    <Dialog
      open
      onClose={onClose}
      title="Crop your picture"
      size="sm"
      dismissable={!busy}
      actions={
        <>
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" onClick={onSave} disabled={busy}>
            {busy ? 'Saving…' : 'Save picture'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col items-center gap-3">
        <div
          className="relative touch-none overflow-hidden rounded-full bg-surface-raised select-none"
          style={{
            width: AVATAR_CROP_VIEW_SIDE,
            height: AVATAR_CROP_VIEW_SIDE,
            maxWidth: '100%',
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {/* The fitted image, zoomed and dragged under the circular
              mask (the container clips to a circle). */}
          <img
            ref={imageRef}
            src={objectUrl}
            alt=""
            draggable={false}
            className="absolute top-1/2 left-1/2 max-w-none"
            style={{
              width: zoomed.width,
              height: zoomed.height,
              transform: `translate(calc(-50% + ${crop.offsetX}px), calc(-50% + ${crop.offsetY}px))`,
            }}
          />
        </div>
        <label className="flex w-full items-center gap-2 text-[14px]" htmlFor="avatar-zoom">
          Zoom
          <input
            id="avatar-zoom"
            type="range"
            min={1}
            max={4}
            step={0.05}
            value={crop.zoom}
            disabled={busy}
            onChange={(event) => {
              const zoom = clampZoom(Number(event.target.value));
              onCropChange((current) => applyCrop(natural, { ...current, zoom }));
            }}
            className="w-full accent-white"
          />
        </label>
        <p className="text-[13px] text-muted-foreground">Drag to position · exports 256 × 256</p>
      </div>
    </Dialog>
  );
}
