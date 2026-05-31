import React from 'react';

const boxToPercent = (box, video, mirrored = false) => {
  if (!box || !video) return null;
  const videoWidth = video.videoWidth || 640;
  const videoHeight = video.videoHeight || 480;
  const size = Math.max(box.width, box.height);
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  const x = centerX - size / 2;
  const y = centerY - size / 2;
  const left = mirrored ? 100 - ((x + size) / videoWidth) * 100 : (x / videoWidth) * 100;
  return {
    left: `${Math.max(0, Math.min(100, left))}%`,
    top: `${Math.max(0, Math.min(100, (y / videoHeight) * 100))}%`,
    width: `${Math.max(12, Math.min(82, (size / videoWidth) * 100))}%`,
    height: `${Math.max(12, Math.min(82, (size / videoHeight) * 100))}%`
  };
};

export default function DynamicFaceGuide({ box, videoRef, ready = false, mirrored = false, scanning = true }) {
  const style = boxToPercent(box, videoRef?.current?.video || videoRef?.current, mirrored);
  const guideClass = ready ? 'face-scan-ready' : 'face-scan-active';

  return (
    <div className="face-scan-layer pointer-events-none absolute inset-0 overflow-hidden">
      {scanning && (
        <>
          <div className={`face-scan-focus ${guideClass}`} />
          <div className={`face-scan-beam ${guideClass}`} />
          <div className="face-scan-grid" />
        </>
      )}
      {style && (
        <div
          className={`face-scan-box ${guideClass} absolute rounded-xl border-2 transition-all duration-150 ${
            ready
              ? 'border-emerald-300 shadow-[0_0_26px_rgba(52,211,153,0.42)]'
              : 'border-primary-300 shadow-[0_0_22px_rgba(96,165,250,0.36)]'
          }`}
          style={style}
        >
          {scanning && <span className={`face-scan-box-beam ${guideClass}`} />}
          <span className="absolute -left-1 -top-1 h-4 w-4 rounded-tl-xl border-l-4 border-t-4 border-current" />
          <span className="absolute -right-1 -top-1 h-4 w-4 rounded-tr-xl border-r-4 border-t-4 border-current" />
          <span className="absolute -bottom-1 -left-1 h-4 w-4 rounded-bl-xl border-b-4 border-l-4 border-current" />
          <span className="absolute -bottom-1 -right-1 h-4 w-4 rounded-br-xl border-b-4 border-r-4 border-current" />
        </div>
      )}
    </div>
  );
}
