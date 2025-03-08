export default async function getBestCameraStream(facingMode = "environment") {
  try {
    // Use minimal constraints to speed up camera initialization
    const constraints = {
      video: {
        facingMode: { ideal: facingMode },
        frameRate: { ideal: 30 }   // A reasonable frame rate that most devices support
      },
      audio: false,
    };

    // Request the camera stream once
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    return stream;
  } catch (error) {
    console.error("Error selecting best camera stream:", error);
    return null;
  }
}
