export default async function getBestCameraStream(facingMode = "environment") {
    try {
      // Get list of available video devices (cameras)
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(device => device.kind === "videoinput");
      console.log("videoDevices", videoDevices);
      let bestStream = null;
      let maxFps = 0;
  
      // Try different resolutions to get the best FPS
      const resolutions = [
        { width: 640, height: 360 },  // Low resolution (fastest)
        { width: 1280, height: 720 }, // Medium resolution
        { width: 1920, height: 1080 } // High resolution (slower)
      ];
  
      for (let resolution of resolutions) {
        for (let device of videoDevices) {
          const constraints = {
            video: {
              deviceId: device.deviceId ? { exact: device.deviceId } : undefined,
              facingMode: { ideal: facingMode },
              width: { ideal: resolution.width },
              height: { ideal: resolution.height },
              frameRate: { ideal: 60, max: 120 } // Request highest FPS
            },
            audio: false,
          };
  
          try {
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            const settings = stream.getVideoTracks()[0].getSettings();
            
            // Check FPS of this stream
            if (settings.frameRate && settings.frameRate > maxFps) {
              maxFps = settings.frameRate;
              if (bestStream) {
                bestStream.getTracks().forEach(track => track.stop()); // Stop previous stream
              }
              bestStream = stream;
            } else {
              stream.getTracks().forEach(track => track.stop()); // Close unused streams
            }
          } catch (error) {
            console.warn("Failed to get stream with constraints:", constraints, error);
          }
        }
      }
  
      // Fallback for iOS devices if no stream was found
      if (!bestStream) {
        const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
        if (isIOS) {
          try {
            console.log("iOS fallback: trying simpler constraints");
            const fallbackConstraints = {
              video: {
                facingMode,
                width: { ideal: 640 },
                height: { ideal: 360 },
                frameRate: { ideal: 30 } // Lower frame rate for compatibility
              },
              audio: false,
            };
            bestStream = await navigator.mediaDevices.getUserMedia(fallbackConstraints);
          } catch (fallbackError) {
            console.warn("Fallback constraints failed:", fallbackError);
          }
        }
      }
  
      if (!bestStream) throw new Error("No suitable camera found.");
      return bestStream;
    
    } catch (error) {
      console.error("Error selecting best camera stream:", error);
      return null;
    }
  }
  