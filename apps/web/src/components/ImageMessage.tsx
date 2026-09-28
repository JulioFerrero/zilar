import type { UiImage } from '@galena/chat-core';

export function ImageMessage({ image, alt }: { image: UiImage; alt: string }) {
  return (
    <img
      src={image.url}
      alt={alt}
      width={image.width}
      height={image.height}
      className="max-h-[320px] w-full rounded-[12px] border border-edge object-cover shadow-[0_4px_10px_-3px_rgba(0,0,0,0.85)]"
    />
  );
}
