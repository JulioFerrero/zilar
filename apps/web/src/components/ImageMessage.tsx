import type { UiImage } from '@galena/chat-core';

export function ImageMessage({ image, alt }: { image: UiImage; alt: string }) {
  return (
    <img
      src={image.url}
      alt={alt}
      width={image.width}
      height={image.height}
      className="max-h-[320px] w-full rounded-xl object-cover"
    />
  );
}
