import Cropper from 'react-easy-crop';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import {
  AVATAR_CROP_VIEW_SIDE,
  AVATAR_MAX_ZOOM,
  AVATAR_MIN_ZOOM,
  type CropArea,
  type CropState,
} from '@/lib/avatar-crop';

interface CropDialogProps {
  crop: CropState;
  objectUrl: string;
  busy: boolean;
  imageRef: React.RefObject<HTMLImageElement | null>;
  onCropChange: React.Dispatch<React.SetStateAction<CropState>>;
  onSave: () => void;
  onClose: () => void;
}

function sameArea(current: CropArea | null, next: CropArea): boolean {
  return (
    current !== null &&
    current.x === next.x &&
    current.y === next.y &&
    current.width === next.width &&
    current.height === next.height
  );
}

export function CropDialog({
  crop,
  objectUrl,
  busy,
  imageRef,
  onCropChange,
  onSave,
  onClose,
}: CropDialogProps) {
  return (
    <Dialog
      open
      onClose={onClose}
      title="Crop your picture"
      size="sm"
      busy={busy}
      actions={
        <Button type="button" onClick={onSave} disabled={busy}>
          {busy ? 'Saving…' : 'Save picture'}
        </Button>
      }
    >
      <div className="flex flex-col items-center gap-3">
        <div
          className="relative overflow-hidden rounded-full bg-surface-raised"
          style={{
            width: AVATAR_CROP_VIEW_SIDE,
            height: AVATAR_CROP_VIEW_SIDE,
            maxWidth: '100%',
          }}
        >
          <Cropper
            image={objectUrl}
            crop={crop.crop}
            zoom={crop.zoom}
            aspect={1}
            cropShape="round"
            showGrid={false}
            minZoom={AVATAR_MIN_ZOOM}
            maxZoom={AVATAR_MAX_ZOOM}
            zoomWithScroll
            onCropChange={(point) => onCropChange((current) => ({ ...current, crop: point }))}
            onZoomChange={(zoom) => onCropChange((current) => ({ ...current, zoom }))}
            onCropComplete={(_area, areaPixels) =>
              onCropChange((current) =>
                sameArea(current.area, areaPixels) ? current : { ...current, area: areaPixels },
              )
            }
            setImageRef={(ref) => {
              imageRef.current = ref.current;
            }}
          />
        </div>
        <label className="flex w-full items-center gap-2 text-[14px]" htmlFor="avatar-zoom">
          Zoom
          <input
            id="avatar-zoom"
            type="range"
            min={AVATAR_MIN_ZOOM}
            max={AVATAR_MAX_ZOOM}
            step={0.05}
            value={crop.zoom}
            disabled={busy}
            onChange={(event) => {
              const zoom = Number(event.target.value);
              onCropChange((current) => ({ ...current, zoom }));
            }}
            className="w-full accent-white"
          />
        </label>
        <p className="text-[13px] text-muted-foreground">
          Drag to position · scroll or pinch to zoom · exports 256 × 256
        </p>
      </div>
    </Dialog>
  );
}
