import React from 'react';

const boxToPercent = (box, video, mirrored = false) => {
  if (!box || !video) return null;
  const source = box.boundingBox || box;
  const videoWidth = video.videoWidth || 640;
  const videoHeight = video.videoHeight || 480;
  const rawX = Number.isFinite(Number(source.x)) ? Number(source.x) : Number(source.left);
  const rawY = Number.isFinite(Number(source.y)) ? Number(source.y) : Number(source.top);
  const rawWidth = Number.isFinite(Number(source.width))
    ? Number(source.width)
    : Number(source.right) - rawX;
  const rawHeight = Number.isFinite(Number(source.height))
    ? Number(source.height)
    : Number(source.bottom) - rawY;

  if (![rawX, rawY, rawWidth, rawHeight].every(Number.isFinite) || rawWidth <= 0 || rawHeight <= 0) {
    return null;
  }

  const paddedWidth = rawWidth * 1.12;
  const paddedHeight = rawHeight * 1.16;
  const centerX = rawX + rawWidth / 2;
  const centerY = rawY + rawHeight / 2;
  const x = centerX - paddedWidth / 2;
  const y = centerY - paddedHeight / 2;
  const widthPercent = Math.max(12, Math.min(82, (paddedWidth / videoWidth) * 100));
  const heightPercent = Math.max(14, Math.min(82, (paddedHeight / videoHeight) * 100));
  const rawLeft = mirrored ? 100 - ((x + paddedWidth) / videoWidth) * 100 : (x / videoWidth) * 100;
  const left = Math.max(0, Math.min(100 - widthPercent, rawLeft));
  const top = Math.max(0, Math.min(100 - heightPercent, (y / videoHeight) * 100));

  return {
    left: `${left}%`,
    top: `${top}%`,
    width: `${widthPercent}%`,
    height: `${heightPercent}%`
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
