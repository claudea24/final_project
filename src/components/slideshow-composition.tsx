import {
  AbsoluteFill,
  Img,
  OffthreadVideo,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
  Html5Audio,
  interpolate,
} from "remotion";
import type { TimelineMedia } from "@/lib/media";

type SlideshowCompositionProps = {
  images: TimelineMedia[];
  soundtrackSrc: string;
  secondsPerImage: number;
};

export function SlideshowComposition({
  images,
  soundtrackSrc,
  secondsPerImage,
}: SlideshowCompositionProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const slots = images.reduce<
    {
      item: TimelineMedia;
      index: number;
      startFrame: number;
      frames: number;
    }[]
  >((acc, item, index) => {
    const seconds =
      item.kind === "video" && item.durationSeconds && item.durationSeconds > 0
        ? item.durationSeconds
        : secondsPerImage;
    const frames = Math.max(1, Math.round(seconds * fps));
    const startFrame = acc.length > 0
      ? acc[acc.length - 1].startFrame + acc[acc.length - 1].frames
      : 0;
    acc.push({ item, index, startFrame, frames });
    return acc;
  }, []);

  return (
    <AbsoluteFill
      style={{
        background:
          "linear-gradient(180deg, rgba(10, 25, 47, 1) 0%, rgba(18, 52, 86, 1) 100%)",
      }}
    >
      <AbsoluteFill
        style={{
          backgroundImage: `url(${staticFile("placeholder/film-grain.png")})`,
          backgroundSize: "cover",
          opacity: 0.16,
          mixBlendMode: "screen",
        }}
      />

      {slots.map(({ item, index, startFrame, frames }) => {
        const progress = frame - startFrame;
        const scale = interpolate(progress, [0, frames], [1, 1.08], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
        const opacity = interpolate(
          progress,
          [0, 8, frames - 8, frames],
          [0, 1, 1, 0],
          {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          },
        );

        return (
          <Sequence
            key={item.id}
            durationInFrames={frames}
            from={startFrame}
          >
            <AbsoluteFill
              style={{
                alignItems: "center",
                justifyContent: "center",
                opacity,
              }}
            >
              {item.kind === "video" ? (
                <OffthreadVideo
                  src={item.src}
                  muted
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    transform: `scale(${scale})`,
                  }}
                />
              ) : (
                <Img
                  src={item.src}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    transform: `scale(${scale})`,
                  }}
                />
              )}
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background:
                    "linear-gradient(180deg, rgba(15, 23, 42, 0.08) 0%, rgba(15, 23, 42, 0.36) 100%)",
                }}
              />
              <div
                style={{
                  position: "absolute",
                  left: 52,
                  right: 52,
                  bottom: 72,
                  display: "flex",
                  justifyContent: "space-between",
                  color: "white",
                  fontFamily: "Georgia, serif",
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                  fontSize: 24,
                }}
              >
                <span>Montaj</span>
                <span>{String(index + 1).padStart(2, "0")}</span>
              </div>
            </AbsoluteFill>
          </Sequence>
        );
      })}

      <Html5Audio src={soundtrackSrc} volume={0.55} />
    </AbsoluteFill>
  );
}
