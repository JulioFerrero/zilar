import { ORB_HUES, ORB_RIMS } from '@zilar/chat-core';
import { forwardRef, useId, useImperativeHandle, useRef, type Ref } from 'react';
import { Pressable, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';

import { Text } from '@/components/ui/text';

import { captureOrbPng, ORB_EXPORT_SIZE } from './orb-upload';
import type { NewAiFlow, OrbParams } from './use-new-ai-flow';

const ORB_PREVIEW_SIZE = 36;
const ORB_BIG_SIZE = 148;
/** The board clamps the dragged light to 0.4 of the radius. */
const MAX_LIGHT = 0.4;

function lightPoint(params: OrbParams): { x: number; y: number } {
  return {
    x: 50 + Math.cos(params.angle) * params.distance * 100,
    y: 50 + Math.sin(params.angle) * params.distance * 100,
  };
}

function backPoint(params: OrbParams): { x: number; y: number } {
  return { x: 50 - Math.cos(params.angle) * 28, y: 50 - Math.sin(params.angle) * 28 };
}

/** The glossy orb, drawn with the same gradients as `ballSvg` in chat-core. */
function OrbSvg({ params, size, svgRef }: { params: OrbParams; size: number; svgRef?: Ref<Svg> }) {
  const id = useId().replace(/[^a-zA-Z0-9]/gu, '');
  const light = lightPoint(params);
  const back = backPoint(params);
  const hue = Math.round(params.hue);
  const rim = Math.round(params.rim);
  return (
    <Svg ref={svgRef} width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        <RadialGradient id={`${id}-body`} cx={`${light.x}%`} cy={`${light.y}%`} r="75%">
          <Stop offset="0" stopColor={`hsl(${hue}, 85%, 72%)`} />
          <Stop offset="0.55" stopColor={`hsl(${hue}, 75%, 46%)`} />
          <Stop offset="1" stopColor={`hsl(${hue}, 80%, 16%)`} />
        </RadialGradient>
        <RadialGradient id={`${id}-rim`} cx={`${back.x}%`} cy={`${back.y}%`} r="55%">
          <Stop offset="0.6" stopColor={`hsl(${rim}, 90%, 70%)`} stopOpacity="0" />
          <Stop offset="1" stopColor={`hsl(${rim}, 90%, 70%)`} stopOpacity="0.55" />
        </RadialGradient>
        <RadialGradient id={`${id}-gloss`} cx={`${light.x}%`} cy={`${light.y}%`} r="18%">
          <Stop offset="0" stopColor="#ffffff" stopOpacity="0.95" />
          <Stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </RadialGradient>
      </Defs>
      <Circle cx="50" cy="50" r="50" fill={`url(#${id}-body)`} />
      <Circle cx="50" cy="50" r="50" fill={`url(#${id}-rim)`} />
      <Circle cx="50" cy="50" r="50" fill={`url(#${id}-gloss)`} />
    </Svg>
  );
}

/** The orb for a box on a step (the model step's preview). */
export function OrbImage({
  params,
  size = ORB_PREVIEW_SIZE,
}: {
  params: OrbParams;
  size?: number;
}) {
  return <OrbSvg params={params} size={size} />;
}

export interface OrbCaptureHandle {
  /** The orb as a 256×256 base64 PNG, or null when the view is not mounted. */
  capture(): Promise<string | null>;
}

/**
 * The hidden orb used for the create upload: the same `OrbSvg` the flow shows,
 * off-screen, with `react-native-svg`'s `toDataURL` handing back the base64 PNG.
 */
export const OrbCapture = forwardRef<OrbCaptureHandle, { params: OrbParams }>(function OrbCapture(
  { params },
  handle,
) {
  const svg = useRef<Svg | null>(null);
  useImperativeHandle(
    handle,
    () => ({
      capture: () => captureOrbPng(svg.current),
    }),
    [],
  );
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: -1000, top: 0 }}>
      <OrbSvg params={params} size={ORB_EXPORT_SIZE} svgRef={svg} />
    </View>
  );
});

function Swatch({
  label,
  color,
  size,
  selected,
  onPress,
}: {
  label: string;
  color: string;
  size: number;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
        borderWidth: selected ? 2 : 0,
        borderColor: '#ededed',
      }}
    />
  );
}

/** The orb sub-view (PhoneOrb.dc.html): swatches and the draggable light. */
export function OrbView({ flow }: { flow: NewAiFlow }) {
  const size = ORB_BIG_SIZE;
  const place = (x: number, y: number): void => {
    const dx = x - size / 2;
    const dy = y - size / 2;
    flow.setOrbLight(Math.atan2(dy, dx), Math.min(MAX_LIGHT, Math.hypot(dx, dy) / (size / 2)));
  };
  // Rebuilt each render so the live callbacks always read the current orb.
  const pan = Gesture.Pan()
    .runOnJS(true)
    .onBegin((event) => place(event.x, event.y))
    .onUpdate((event) => place(event.x, event.y));

  const light = lightPoint(flow.orbParams);
  const selectedHue = Math.round(flow.orbParams.hue);
  const selectedRim = Math.round(flow.orbParams.rim);

  return (
    <View className="gap-4">
      <View className="items-center pt-1">
        <GestureDetector gesture={pan}>
          <View
            accessible
            accessibilityRole="adjustable"
            accessibilityLabel="Drag to move the light"
            style={{ width: size, height: size }}
          >
            <OrbImage params={flow.orbParams} size={size} />
            <View
              pointerEvents="none"
              style={{
                position: 'absolute',
                left: `${light.x}%`,
                top: `${light.y}%`,
                width: 18,
                height: 18,
                marginLeft: -10,
                marginTop: -10,
                borderRadius: 9,
                borderWidth: 1,
                borderColor: 'rgba(255, 255, 255, 0.9)',
              }}
            />
          </View>
        </GestureDetector>
      </View>

      <View className="gap-2.5">
        <Text className="text-[13px] font-medium text-foreground">Color</Text>
        <View className="flex-row flex-wrap gap-x-2 gap-y-3">
          {ORB_HUES.map((choice) => (
            <Swatch
              key={choice.value}
              label={choice.name}
              color={`hsl(${choice.value}, 85%, 72%)`}
              size={34}
              selected={selectedHue === choice.value}
              onPress={() => flow.setOrbHue(choice.value)}
            />
          ))}
        </View>
      </View>

      <View className="gap-2.5">
        <Text className="text-[13px] font-medium text-foreground">Light</Text>
        <View className="flex-row gap-x-2">
          {ORB_RIMS.map((choice) => (
            <Swatch
              key={choice.value}
              label={choice.name}
              color={`hsl(${choice.value}, 90%, 70%)`}
              size={30}
              selected={selectedRim === choice.value}
              onPress={() => flow.setOrbRim(choice.value)}
            />
          ))}
        </View>
      </View>
    </View>
  );
}
