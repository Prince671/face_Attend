import React from 'react';

const boxToPercent = (box, video, mirrored = false) => {
  if (!box || !video) return null;
  const videoWidth = video.videoWidth || 640;
  const videoHeight = video.videoHeight || 480;
  const paddedWidth = box.width * 1.16;
  const paddedHeight = box.height * 1.18;
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  const x = centerX - paddedWidth / 2;
  const y = centerY - paddedHeight / 2;
  const left = mirrored ? 100 - ((x + paddedWidth) / videoWidth) * 100 : (x / videoWidth) * 100;
  return {
    left: `${Math.max(0, Math.min(100, left))}%`,
    top: `${Math.max(0, Math.min(100, (y / videoHeight) * 100))}%`,
    width: `${Math.max(10, Math.min(82, (paddedWidth / videoWidth) * 100))}%`,
    height: `${Math.max(12, Math.min(82, (paddedHeight / videoHeight) * 100))}%`
  };
};

export default function DynamicFaceGuide({ box, videoRef, ready = false, mirrored = false, scanning = true }) {
  const style = boxToPercent(box, videoRef?.current?.video || videoRef?.current, mirrored);
  const guideClass = ready ? 'face-scan-ready' : 'face-scan-active';

  return (
    <div className="face-scan-layer pointer-events-none absolute inset-0 overflow-hidden">
      {style && (
        <div
          className={`face-scan-box ${guideClass} absolute transition-all duration-75 ${
            ready
              ? 'face-scan-box-ready'
              : 'face-scan-box-detecting'
          }`}
          style={style}
        >
          {scanning && <span className={`face-scan-box-beam ${guideClass}`} />}
          <span className="face-scan-corner face-scan-corner-tl" />
          <span className="face-scan-corner face-scan-corner-tr" />
          <span className="face-scan-corner face-scan-corner-bl" />
          <span className="face-scan-corner face-scan-corner-br" />
        </div>
      )}
    </div>
  );
}
